CREATE TABLE "invoice_review_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"state" varchar(30) DEFAULT 'open' NOT NULL,
	"owner_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_review_cases_state_check" CHECK ("invoice_review_cases"."state" IN ('open', 'in_review', 'waiting_on_supplier', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "invoice_review_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"signal_type" varchar(50) NOT NULL,
	"source_module" varchar(50) NOT NULL,
	"source_record_id" varchar(255) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolution_actor_id" uuid,
	"resolution_command" varchar(50),
	"resolution_reason" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_review_signals_type_check" CHECK ("invoice_review_signals"."signal_type" IN ('low_extraction_confidence', 'duplicate_risk', 'sender_risk', 'match_exception', 'bank_detail_change_risk', 'manual_review')),
	CONSTRAINT "invoice_review_signals_severity_check" CHECK ("invoice_review_signals"."severity" IN ('informational', 'review_required', 'blocking')),
	CONSTRAINT "invoice_review_signals_status_check" CHECK ("invoice_review_signals"."status" IN ('open', 'resolved', 'waived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_review_cases_id_organization_id_unique" ON "invoice_review_cases" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "invoice_review_cases" ADD CONSTRAINT "invoice_review_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_cases" ADD CONSTRAINT "invoice_review_cases_invoice_org_fk" FOREIGN KEY ("invoice_id","organization_id") REFERENCES "public"."invoices"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_cases" ADD CONSTRAINT "invoice_review_cases_owner_org_fk" FOREIGN KEY ("owner_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_signals" ADD CONSTRAINT "invoice_review_signals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_signals" ADD CONSTRAINT "invoice_review_signals_case_org_fk" FOREIGN KEY ("case_id","organization_id") REFERENCES "public"."invoice_review_cases"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_signals" ADD CONSTRAINT "invoice_review_signals_resolution_actor_org_fk" FOREIGN KEY ("resolution_actor_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_review_cases_org_invoice_unique" ON "invoice_review_cases" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_review_cases_org_state_opened_idx" ON "invoice_review_cases" USING btree ("organization_id","state","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_review_signals_identity_unique" ON "invoice_review_signals" USING btree ("case_id","signal_type","source_module","source_record_id");--> statement-breakpoint
CREATE INDEX "invoice_review_signals_case_status_severity_idx" ON "invoice_review_signals" USING btree ("case_id","status","severity");--> statement-breakpoint
CREATE INDEX "invoice_review_signals_org_source_idx" ON "invoice_review_signals" USING btree ("organization_id","source_module","source_record_id");
--> statement-breakpoint
-- Seed only active unpaid exception sources. The normalized rows make the first read projection useful
-- without changing the authoritative invoice lifecycle or copying uncertain historical audit text.
INSERT INTO "invoice_review_cases" (
	"organization_id",
	"invoice_id",
	"state",
	"opened_at",
	"created_at",
	"updated_at"
)
SELECT
	i."organization_id",
	i."id",
	'open',
	LEAST(i."created_at", COALESCE(i."updated_at", i."created_at")),
	now(),
	now()
FROM "invoices" AS i
WHERE i."paid_at" IS NULL
	AND i."status" NOT IN ('paid', 'cancelled')
	AND (
		i."match_status" = 'exception'
		OR EXISTS (
			SELECT 1
			FROM "spend_guard_alerts" AS alert
			WHERE alert."org_id" = i."organization_id"
				AND alert."record_type" = 'invoice'
				AND alert."record_id" = i."id"
				AND alert."status" = 'open'
		)
		OR EXISTS (
			SELECT 1
			FROM "email_intake_items" AS intake
			WHERE intake."organization_id" = i."organization_id"
				AND intake."created_draft_id" = i."id"
				AND intake."created_draft_type" = 'invoice'
				AND intake."status" NOT IN ('discarded', 'converted')
		)
		OR EXISTS (
			SELECT 1
			FROM "ocr_jobs" AS ocr
			WHERE ocr."organization_id" = i."organization_id"
				AND ocr."invoice_id" = i."id"
				AND ocr."status" IN ('pending', 'processing')
		)
	)
ON CONFLICT ("organization_id", "invoice_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "invoice_review_signals" (
	"organization_id",
	"case_id",
	"signal_type",
	"source_module",
	"source_record_id",
	"severity",
	"status",
	"summary",
	"details"
)
SELECT
	i."organization_id",
	c."id",
	'match_exception',
	'matching',
	i."id"::text,
	'blocking',
	'open',
	'Invoice has an active match exception.',
	jsonb_build_object('matchStatus', i."match_status")
FROM "invoices" AS i
JOIN "invoice_review_cases" AS c
	ON c."organization_id" = i."organization_id" AND c."invoice_id" = i."id"
WHERE i."paid_at" IS NULL
	AND i."status" NOT IN ('paid', 'cancelled')
	AND i."match_status" = 'exception'
ON CONFLICT ("case_id", "signal_type", "source_module", "source_record_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "invoice_review_signals" (
	"organization_id",
	"case_id",
	"signal_type",
	"source_module",
	"source_record_id",
	"severity",
	"status",
	"summary",
	"details"
)
SELECT
	alert."org_id",
	c."id",
	CASE WHEN alert."alert_type" LIKE '%duplicate%' THEN 'duplicate_risk' ELSE 'manual_review' END,
	'spend_guard',
	alert."id"::text,
	CASE alert."severity" WHEN 'high' THEN 'blocking' WHEN 'medium' THEN 'review_required' ELSE 'informational' END,
	'open',
	'Invoice has an active spend-risk alert.',
	jsonb_build_object('alertType', alert."alert_type", 'severity', alert."severity")
FROM "spend_guard_alerts" AS alert
JOIN "invoice_review_cases" AS c
	ON c."organization_id" = alert."org_id" AND c."invoice_id" = alert."record_id"
JOIN "invoices" AS i
	ON i."organization_id" = alert."org_id" AND i."id" = alert."record_id"
WHERE alert."record_type" = 'invoice'
	AND alert."status" = 'open'
	AND i."paid_at" IS NULL
	AND i."status" NOT IN ('paid', 'cancelled')
ON CONFLICT ("case_id", "signal_type", "source_module", "source_record_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "invoice_review_signals" (
	"organization_id",
	"case_id",
	"signal_type",
	"source_module",
	"source_record_id",
	"severity",
	"status",
	"summary",
	"details"
)
SELECT
	ocr."organization_id",
	c."id",
	'low_extraction_confidence',
	'ocr',
	ocr."id"::text,
	'blocking',
	'open',
	'OCR review is unfinished for this invoice.',
	jsonb_build_object('ocrStatus', ocr."status")
FROM "ocr_jobs" AS ocr
JOIN "invoice_review_cases" AS c
	ON c."organization_id" = ocr."organization_id" AND c."invoice_id" = ocr."invoice_id"
JOIN "invoices" AS i
	ON i."organization_id" = ocr."organization_id" AND i."id" = ocr."invoice_id"
WHERE ocr."invoice_id" IS NOT NULL
	AND ocr."status" IN ('pending', 'processing')
	AND i."paid_at" IS NULL
	AND i."status" NOT IN ('paid', 'cancelled')
ON CONFLICT ("case_id", "signal_type", "source_module", "source_record_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "invoice_review_signals" (
	"organization_id",
	"case_id",
	"signal_type",
	"source_module",
	"source_record_id",
	"severity",
	"status",
	"summary",
	"details"
)
SELECT
	intake."organization_id",
	c."id",
	'manual_review',
	'email_intake',
	intake."id"::text,
	'blocking',
	'open',
	'Inbound invoice intake still requires review.',
	jsonb_build_object('intakeStatus', intake."status")
FROM "email_intake_items" AS intake
JOIN "invoice_review_cases" AS c
	ON c."organization_id" = intake."organization_id" AND c."invoice_id" = intake."created_draft_id"
JOIN "invoices" AS i
	ON i."organization_id" = intake."organization_id" AND i."id" = intake."created_draft_id"
WHERE intake."created_draft_id" IS NOT NULL
	AND intake."created_draft_type" = 'invoice'
	AND intake."status" NOT IN ('discarded', 'converted')
	AND i."paid_at" IS NULL
	AND i."status" NOT IN ('paid', 'cancelled')
ON CONFLICT ("case_id", "signal_type", "source_module", "source_record_id") DO NOTHING;
--> statement-breakpoint
WITH desired_states AS (
	SELECT
		c."id",
		c."organization_id",
		CASE WHEN EXISTS (
			SELECT 1
			FROM "invoice_review_signals" AS signal
			WHERE signal."case_id" = c."id"
				AND signal."organization_id" = c."organization_id"
				AND signal."status" = 'open'
				AND signal."severity" = 'blocking'
		) THEN 'open' ELSE 'resolved' END AS "state"
	FROM "invoice_review_cases" AS c
	WHERE c."state" IN ('open', 'resolved')
		AND EXISTS (
			SELECT 1
			FROM "invoice_review_signals" AS signal
			WHERE signal."case_id" = c."id"
				AND signal."organization_id" = c."organization_id"
		)
)
UPDATE "invoice_review_cases" AS c
SET
	"state" = desired."state",
	"resolved_at" = CASE WHEN desired."state" = 'resolved' THEN now() ELSE NULL END,
	"updated_at" = now()
FROM desired_states AS desired
WHERE c."id" = desired."id"
	AND c."organization_id" = desired."organization_id"
	AND c."state" <> desired."state";
