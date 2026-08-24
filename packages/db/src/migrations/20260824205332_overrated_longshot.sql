SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
CREATE TABLE "budget_commitment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"requisition_id" uuid,
	"purchase_order_id" uuid,
	"invoice_id" uuid,
	"event_key" varchar(255) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"base_reserved_delta" numeric(14, 2) DEFAULT '0' NOT NULL,
	"base_committed_delta" numeric(14, 2) DEFAULT '0' NOT NULL,
	"base_expended_delta" numeric(14, 2) DEFAULT '0' NOT NULL,
	"reason" varchar(255) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_commitment_events" ADD CONSTRAINT "budget_commitment_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitment_events" ADD CONSTRAINT "budget_commitment_events_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitment_events" ADD CONSTRAINT "budget_commitment_events_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitment_events" ADD CONSTRAINT "budget_commitment_events_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitment_events" ADD CONSTRAINT "budget_commitment_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_commitment_events_org_key_uniq" ON "budget_commitment_events" USING btree ("organization_id","event_key");--> statement-breakpoint
CREATE INDEX "budget_commitment_events_budget_created_idx" ON "budget_commitment_events" USING btree ("budget_id","created_at");--> statement-breakpoint
CREATE INDEX "budget_commitment_events_requisition_idx" ON "budget_commitment_events" USING btree ("requisition_id");--> statement-breakpoint
CREATE INDEX "budget_commitment_events_purchase_order_idx" ON "budget_commitment_events" USING btree ("purchase_order_id");--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "purchase_orders" po
		JOIN "requisitions" r ON r."id" = po."requisition_id"
		JOIN LATERAL (
			SELECT candidate."base_currency"
			FROM "budgets" candidate
			WHERE candidate."organization_id" = r."organization_id"
				AND candidate."budget_type" = 'department'
				AND candidate."scope_id" = r."department_id"
				AND candidate."fiscal_year" = EXTRACT(YEAR FROM (r."created_at" AT TIME ZONE 'UTC'))::int
			ORDER BY (candidate."entity_id" IS NULL) DESC, candidate."created_at", candidate."id"
			LIMIT 1
		) b ON true
		LEFT JOIN "exchange_rates" er
			ON er."org_id" = r."organization_id"
			AND er."from_currency" = po."base_currency"
			AND er."to_currency" = b."base_currency"
		WHERE po."status" IN ('issued', 'received', 'invoiced', 'closed')
			AND po."base_currency" <> b."base_currency"
			AND er."rate" IS NULL
	) THEN
		RAISE EXCEPTION 'Cannot backfill budget commitments: a purchase order exchange rate is missing';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "invoices" i
		JOIN "purchase_orders" po ON po."id" = i."purchase_order_id"
		JOIN "requisitions" r ON r."id" = po."requisition_id"
		JOIN LATERAL (
			SELECT candidate."base_currency"
			FROM "budgets" candidate
			WHERE candidate."organization_id" = r."organization_id"
				AND candidate."budget_type" = 'department'
				AND candidate."scope_id" = r."department_id"
				AND candidate."fiscal_year" = EXTRACT(YEAR FROM (r."created_at" AT TIME ZONE 'UTC'))::int
			ORDER BY (candidate."entity_id" IS NULL) DESC, candidate."created_at", candidate."id"
			LIMIT 1
		) b ON true
		LEFT JOIN "exchange_rates" er
			ON er."org_id" = r."organization_id"
			AND er."from_currency" = i."base_currency"
			AND er."to_currency" = b."base_currency"
		WHERE po."status" IN ('issued', 'received', 'invoiced', 'closed')
			AND i."status" IN ('approved', 'paid')
			AND i."base_currency" <> b."base_currency"
			AND er."rate" IS NULL
	) THEN
		RAISE EXCEPTION 'Cannot backfill budget commitments: an invoice exchange rate is missing';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "requisitions" r
		JOIN LATERAL (
			SELECT candidate."base_currency"
			FROM "budgets" candidate
			WHERE candidate."organization_id" = r."organization_id"
				AND candidate."budget_type" = 'department'
				AND candidate."scope_id" = r."department_id"
				AND candidate."fiscal_year" = EXTRACT(YEAR FROM (r."created_at" AT TIME ZONE 'UTC'))::int
			ORDER BY (candidate."entity_id" IS NULL) DESC, candidate."created_at", candidate."id"
			LIMIT 1
		) b ON true
		LEFT JOIN "exchange_rates" er
			ON er."org_id" = r."organization_id"
			AND er."from_currency" = r."currency"
			AND er."to_currency" = b."base_currency"
		LEFT JOIN LATERAL (
			SELECT COUNT(*) FILTER (WHERE candidate."status" <> 'cancelled') AS "active_count"
			FROM "purchase_orders" candidate
			WHERE candidate."requisition_id" = r."id"
		) po ON true
		WHERE (r."status" = 'approved' OR (r."status" = 'converted' AND po."active_count" > 0))
			AND r."currency" <> b."base_currency"
			AND er."rate" IS NULL
	) THEN
		RAISE EXCEPTION 'Cannot backfill budget commitments: a requisition exchange rate is missing';
	END IF;
END $$;
--> statement-breakpoint
WITH converted AS (
	SELECT
		r."organization_id",
		r."id" AS "requisition_id",
		b."id" AS "budget_id",
		po."id" AS "purchase_order_id",
		round(po."base_total_amount" * CASE
			WHEN po."base_currency" = b."base_currency" THEN 1
			ELSE po_er."rate"
		END, 2) AS "base_total_amount",
		COALESCE((
			SELECT SUM(round(i."base_total_amount" * CASE
				WHEN i."base_currency" = b."base_currency" THEN 1
				ELSE invoice_er."rate"
			END, 2))
			FROM "invoices" i
			LEFT JOIN "exchange_rates" invoice_er
				ON invoice_er."org_id" = r."organization_id"
				AND invoice_er."from_currency" = i."base_currency"
				AND invoice_er."to_currency" = b."base_currency"
			WHERE i."purchase_order_id" = po."id"
				AND i."status" IN ('approved', 'paid')
		), 0) AS "expended"
	FROM "purchase_orders" po
	JOIN "requisitions" r ON r."id" = po."requisition_id"
	JOIN LATERAL (
		SELECT candidate."id", candidate."base_currency"
		FROM "budgets" candidate
		WHERE candidate."organization_id" = r."organization_id"
			AND candidate."budget_type" = 'department'
			AND candidate."scope_id" = r."department_id"
			AND candidate."fiscal_year" = EXTRACT(YEAR FROM (r."created_at" AT TIME ZONE 'UTC'))::int
		ORDER BY (candidate."entity_id" IS NULL) DESC, candidate."created_at", candidate."id"
		LIMIT 1
	) b ON true
	LEFT JOIN "exchange_rates" po_er
		ON po_er."org_id" = r."organization_id"
		AND po_er."from_currency" = po."base_currency"
		AND po_er."to_currency" = b."base_currency"
	WHERE po."status" IN ('issued', 'received', 'invoiced', 'closed')
)
INSERT INTO "budget_commitment_events" (
	"organization_id",
	"budget_id",
	"requisition_id",
	"purchase_order_id",
	"event_key",
	"event_type",
	"base_committed_delta",
	"base_expended_delta",
	"reason",
	"metadata"
)
SELECT
	"organization_id",
	"budget_id",
	"requisition_id",
	"purchase_order_id",
	'legacy:purchase_order:' || "purchase_order_id"::text,
	'legacy_commitment_backfill',
	GREATEST("base_total_amount" - "expended", 0),
	"expended",
	'Backfilled issued purchase order commitment and approved invoice spend',
	jsonb_build_object('backfilled', true)
FROM converted
ON CONFLICT DO NOTHING;--> statement-breakpoint
WITH reservations AS (
	SELECT
		r."organization_id",
		r."id" AS "requisition_id",
		r."status" AS "requisition_status",
		b."id" AS "budget_id",
		GREATEST(
			round(r."total_amount" * CASE
				WHEN r."currency" = b."base_currency" THEN 1
				ELSE requisition_er."rate"
			END, 2) - COALESCE(po."issued_total", 0),
			0
		) AS "reserved"
	FROM "requisitions" r
	JOIN LATERAL (
		SELECT candidate."id", candidate."base_currency"
		FROM "budgets" candidate
		WHERE candidate."organization_id" = r."organization_id"
			AND candidate."budget_type" = 'department'
			AND candidate."scope_id" = r."department_id"
			AND candidate."fiscal_year" = EXTRACT(YEAR FROM (r."created_at" AT TIME ZONE 'UTC'))::int
		ORDER BY (candidate."entity_id" IS NULL) DESC, candidate."created_at", candidate."id"
		LIMIT 1
	) b ON true
	LEFT JOIN "exchange_rates" requisition_er
		ON requisition_er."org_id" = r."organization_id"
		AND requisition_er."from_currency" = r."currency"
		AND requisition_er."to_currency" = b."base_currency"
	LEFT JOIN LATERAL (
		SELECT
			COUNT(*) FILTER (WHERE candidate."status" <> 'cancelled') AS "active_count",
			COALESCE(SUM(round(candidate."base_total_amount" * CASE
				WHEN candidate."base_currency" = b."base_currency" THEN 1
				ELSE purchase_order_er."rate"
			END, 2)) FILTER (
				WHERE candidate."status" IN ('issued', 'received', 'invoiced', 'closed')
			), 0) AS "issued_total"
		FROM "purchase_orders" candidate
		LEFT JOIN "exchange_rates" purchase_order_er
			ON purchase_order_er."org_id" = r."organization_id"
			AND purchase_order_er."from_currency" = candidate."base_currency"
			AND purchase_order_er."to_currency" = b."base_currency"
		WHERE candidate."requisition_id" = r."id"
	) po ON true
	WHERE (
		r."status" = 'approved'
		OR (r."status" = 'converted' AND po."active_count" > 0)
	)
)
INSERT INTO "budget_commitment_events" (
	"organization_id",
	"budget_id",
	"requisition_id",
	"event_key",
	"event_type",
	"base_reserved_delta",
	"reason",
	"metadata"
)
SELECT
	"organization_id",
	"budget_id",
	"requisition_id",
	'legacy:requisition:' || "requisition_id"::text,
	'legacy_reservation_backfill',
	"reserved",
	'Backfilled active requisition reservation',
	jsonb_build_object('legacy_status', "requisition_status")
FROM reservations
WHERE "reserved" > 0
ON CONFLICT DO NOTHING;
