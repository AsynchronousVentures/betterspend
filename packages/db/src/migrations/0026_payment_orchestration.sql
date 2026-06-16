ALTER TABLE "payment_runs"
  ADD COLUMN IF NOT EXISTS "entity_id" uuid;
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ADD COLUMN IF NOT EXISTS "status" varchar(30);
--> statement-breakpoint
UPDATE "payment_runs"
  SET "status" = 'completed'
  WHERE "status" IS NULL;
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ALTER COLUMN "status" SET DEFAULT 'draft',
  ALTER COLUMN "status" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ADD COLUMN IF NOT EXISTS "scheduled_date" date;
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ADD COLUMN IF NOT EXISTS "approved_by" uuid;
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ADD COLUMN IF NOT EXISTS "payment_provider" varchar(50);
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ADD COLUMN IF NOT EXISTS "provider_batch_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ADD COLUMN IF NOT EXISTS "currency" varchar(3) DEFAULT 'USD' NOT NULL;
--> statement-breakpoint
UPDATE "payment_runs"
  SET "total_amount" = '0'
  WHERE "total_amount" IS NULL;
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ALTER COLUMN "total_amount" SET DEFAULT '0',
  ALTER COLUMN "total_amount" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ADD COLUMN IF NOT EXISTS "invoice_count" numeric(10,0) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ADD COLUMN IF NOT EXISTS "failure_count" numeric(10,0) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_runs"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_run_invoices"
  ADD COLUMN IF NOT EXISTS "payment_method" varchar(30) DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_run_invoices"
  ADD COLUMN IF NOT EXISTS "amount" numeric(15,4) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_run_invoices"
  ADD COLUMN IF NOT EXISTS "currency" varchar(3) DEFAULT 'USD' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_run_invoices"
  ADD COLUMN IF NOT EXISTS "status" varchar(30) DEFAULT 'scheduled' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_run_invoices"
  ADD COLUMN IF NOT EXISTS "payment_reference" varchar(255);
--> statement-breakpoint
ALTER TABLE "payment_run_invoices"
  ADD COLUMN IF NOT EXISTS "provider_payment_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "payment_run_invoices"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_run_invoices"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_run_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payment_run_id" uuid NOT NULL,
  "event_type" varchar(50) NOT NULL,
  "message" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_payment_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "vendor_id" uuid NOT NULL,
  "account_name" varchar(255) NOT NULL,
  "payment_method" varchar(30) DEFAULT 'ach' NOT NULL,
  "country" varchar(2),
  "currency" varchar(3) DEFAULT 'USD' NOT NULL,
  "masked_account" varchar(100) NOT NULL,
  "provider" varchar(50),
  "provider_account_id" varchar(255),
  "verification_status" varchar(30) DEFAULT 'pending' NOT NULL,
  "verified_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_virtual_cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "vendor_id" uuid NOT NULL,
  "payment_run_id" uuid,
  "invoice_id" uuid,
  "status" varchar(30) DEFAULT 'requested' NOT NULL,
  "provider" varchar(50),
  "provider_card_id" varchar(255),
  "masked_card" varchar(30),
  "limit_amount" numeric(15,4) NOT NULL,
  "currency" varchar(3) DEFAULT 'USD' NOT NULL,
  "valid_through" date,
  "controls" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_runs_entity_id_legal_entities_id_fk'
  ) THEN
    ALTER TABLE "payment_runs"
      ADD CONSTRAINT "payment_runs_entity_id_legal_entities_id_fk"
      FOREIGN KEY ("entity_id") REFERENCES "legal_entities"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_runs_approved_by_users_id_fk'
  ) THEN
    ALTER TABLE "payment_runs"
      ADD CONSTRAINT "payment_runs_approved_by_users_id_fk"
      FOREIGN KEY ("approved_by") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_run_events_payment_run_id_payment_runs_id_fk'
  ) THEN
    ALTER TABLE "payment_run_events"
      ADD CONSTRAINT "payment_run_events_payment_run_id_payment_runs_id_fk"
      FOREIGN KEY ("payment_run_id") REFERENCES "payment_runs"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_run_events_created_by_users_id_fk'
  ) THEN
    ALTER TABLE "payment_run_events"
      ADD CONSTRAINT "payment_run_events_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_payment_accounts_org_id_organizations_id_fk'
  ) THEN
    ALTER TABLE "vendor_payment_accounts"
      ADD CONSTRAINT "vendor_payment_accounts_org_id_organizations_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "organizations"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_payment_accounts_vendor_id_vendors_id_fk'
  ) THEN
    ALTER TABLE "vendor_payment_accounts"
      ADD CONSTRAINT "vendor_payment_accounts_vendor_id_vendors_id_fk"
      FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_virtual_cards_org_id_organizations_id_fk'
  ) THEN
    ALTER TABLE "vendor_virtual_cards"
      ADD CONSTRAINT "vendor_virtual_cards_org_id_organizations_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "organizations"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_virtual_cards_vendor_id_vendors_id_fk'
  ) THEN
    ALTER TABLE "vendor_virtual_cards"
      ADD CONSTRAINT "vendor_virtual_cards_vendor_id_vendors_id_fk"
      FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_virtual_cards_payment_run_id_payment_runs_id_fk'
  ) THEN
    ALTER TABLE "vendor_virtual_cards"
      ADD CONSTRAINT "vendor_virtual_cards_payment_run_id_payment_runs_id_fk"
      FOREIGN KEY ("payment_run_id") REFERENCES "payment_runs"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_virtual_cards_invoice_id_invoices_id_fk'
  ) THEN
    ALTER TABLE "vendor_virtual_cards"
      ADD CONSTRAINT "vendor_virtual_cards_invoice_id_invoices_id_fk"
      FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_virtual_cards_created_by_users_id_fk'
  ) THEN
    ALTER TABLE "vendor_virtual_cards"
      ADD CONSTRAINT "vendor_virtual_cards_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "users"("id");
  END IF;
END $$;
