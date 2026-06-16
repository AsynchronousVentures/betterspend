CREATE TABLE IF NOT EXISTS "contract_extractions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "contract_id" uuid NOT NULL,
  "document_id" uuid,
  "source_type" varchar(30) DEFAULT 'terms' NOT NULL,
  "source_name" varchar(255),
  "extracted_text" text NOT NULL,
  "extracted_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "confidence" numeric(5, 4) DEFAULT '0' NOT NULL,
  "status" varchar(30) DEFAULT 'pending_review' NOT NULL,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_clauses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "contract_id" uuid NOT NULL,
  "extraction_id" uuid,
  "clause_type" varchar(60) NOT NULL,
  "title" varchar(255) NOT NULL,
  "extracted_text" text NOT NULL,
  "normalized_summary" text NOT NULL,
  "risk_level" varchar(20) DEFAULT 'low' NOT NULL,
  "risk_reason" text,
  "confidence" numeric(5, 4) DEFAULT '0' NOT NULL,
  "source_reference" varchar(255),
  "status" varchar(30) DEFAULT 'pending_review' NOT NULL,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_obligations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "contract_id" uuid NOT NULL,
  "clause_id" uuid,
  "owner_id" uuid,
  "obligation_type" varchar(60) NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text,
  "due_date" timestamp with time zone,
  "recurrence" varchar(30),
  "status" varchar(30) DEFAULT 'open' NOT NULL,
  "notification_lead_days" integer DEFAULT 30 NOT NULL,
  "source_reference" varchar(255),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_extractions_contract_status_idx"
  ON "contract_extractions" ("contract_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_clauses_contract_risk_idx"
  ON "contract_clauses" ("contract_id", "risk_level", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_obligations_contract_status_idx"
  ON "contract_obligations" ("contract_id", "status", "due_date");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_extractions_org_fk') THEN
    ALTER TABLE "contract_extractions" ADD CONSTRAINT "contract_extractions_org_fk"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_extractions_contract_fk') THEN
    ALTER TABLE "contract_extractions" ADD CONSTRAINT "contract_extractions_contract_fk"
      FOREIGN KEY ("contract_id") REFERENCES "contracts"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_extractions_document_fk') THEN
    ALTER TABLE "contract_extractions" ADD CONSTRAINT "contract_extractions_document_fk"
      FOREIGN KEY ("document_id") REFERENCES "documents"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_extractions_created_by_fk') THEN
    ALTER TABLE "contract_extractions" ADD CONSTRAINT "contract_extractions_created_by_fk"
      FOREIGN KEY ("created_by") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_extractions_reviewed_by_fk') THEN
    ALTER TABLE "contract_extractions" ADD CONSTRAINT "contract_extractions_reviewed_by_fk"
      FOREIGN KEY ("reviewed_by") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_clauses_org_fk') THEN
    ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_org_fk"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_clauses_contract_fk') THEN
    ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_contract_fk"
      FOREIGN KEY ("contract_id") REFERENCES "contracts"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_clauses_extraction_fk') THEN
    ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_extraction_fk"
      FOREIGN KEY ("extraction_id") REFERENCES "contract_extractions"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_clauses_reviewed_by_fk') THEN
    ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_reviewed_by_fk"
      FOREIGN KEY ("reviewed_by") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_obligations_org_fk') THEN
    ALTER TABLE "contract_obligations" ADD CONSTRAINT "contract_obligations_org_fk"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_obligations_contract_fk') THEN
    ALTER TABLE "contract_obligations" ADD CONSTRAINT "contract_obligations_contract_fk"
      FOREIGN KEY ("contract_id") REFERENCES "contracts"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_obligations_clause_fk') THEN
    ALTER TABLE "contract_obligations" ADD CONSTRAINT "contract_obligations_clause_fk"
      FOREIGN KEY ("clause_id") REFERENCES "contract_clauses"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_obligations_owner_fk') THEN
    ALTER TABLE "contract_obligations" ADD CONSTRAINT "contract_obligations_owner_fk"
      FOREIGN KEY ("owner_id") REFERENCES "users"("id");
  END IF;
END $$;
