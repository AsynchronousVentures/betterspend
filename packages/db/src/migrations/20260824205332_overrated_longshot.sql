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
INSERT INTO "budget_commitment_events" (
	"organization_id",
	"budget_id",
	"requisition_id",
	"purchase_order_id",
	"event_key",
	"event_type",
	"base_reserved_delta",
	"reason",
	"metadata"
)
SELECT
	r."organization_id",
	b."id",
	r."id",
	po."id",
	'legacy:requisition:' || r."id"::text,
	'legacy_reservation_backfill',
	round(r."total_amount" * CASE
		WHEN r."currency" = b."base_currency" THEN 1
		ELSE er."rate"
	END, 2),
	'Backfilled active requisition reservation',
	jsonb_build_object('legacy_status', r."status")
FROM "requisitions" r
JOIN "budgets" b
	ON b."organization_id" = r."organization_id"
	AND b."budget_type" = 'department'
	AND b."scope_id" = r."department_id"
	AND b."fiscal_year" = EXTRACT(YEAR FROM r."created_at")::int
LEFT JOIN LATERAL (
	SELECT candidate."id", candidate."status"
	FROM "purchase_orders" candidate
	WHERE candidate."requisition_id" = r."id"
	ORDER BY candidate."created_at" DESC
	LIMIT 1
) po ON true
LEFT JOIN "exchange_rates" er
	ON er."org_id" = r."organization_id"
	AND er."from_currency" = r."currency"
	AND er."to_currency" = b."base_currency"
WHERE (
	r."status" = 'approved'
	OR (r."status" = 'converted' AND po."status" IN ('draft', 'pending_approval', 'approved'))
)
	AND (r."currency" = b."base_currency" OR er."rate" IS NOT NULL)
ON CONFLICT DO NOTHING;--> statement-breakpoint
WITH converted AS (
	SELECT
		r."organization_id",
		r."id" AS "requisition_id",
		b."id" AS "budget_id",
		po."id" AS "purchase_order_id",
		po."base_total_amount",
		COALESCE(SUM(i."base_total_amount") FILTER (WHERE i."status" IN ('approved', 'paid')), 0) AS "expended"
	FROM "requisitions" r
	JOIN "budgets" b
		ON b."organization_id" = r."organization_id"
		AND b."budget_type" = 'department'
		AND b."scope_id" = r."department_id"
		AND b."fiscal_year" = EXTRACT(YEAR FROM r."created_at")::int
	JOIN LATERAL (
		SELECT candidate."id", candidate."status", candidate."base_total_amount"
		FROM "purchase_orders" candidate
		WHERE candidate."requisition_id" = r."id"
		ORDER BY candidate."created_at" DESC
		LIMIT 1
	) po ON po."status" IN ('issued', 'received', 'invoiced', 'closed')
	LEFT JOIN "invoices" i ON i."purchase_order_id" = po."id"
	WHERE r."status" = 'converted'
	GROUP BY r."organization_id", r."id", b."id", po."id", po."base_total_amount"
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
ON CONFLICT DO NOTHING;
