CREATE TABLE IF NOT EXISTS "email_intake_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "source_email" varchar(255) NOT NULL,
  "subject" varchar(500) NOT NULL,
  "body" text NOT NULL,
  "detected_type" varchar(30) DEFAULT 'triage' NOT NULL,
  "status" varchar(30) DEFAULT 'pending_review' NOT NULL,
  "extracted_vendor_name" varchar(255),
  "extracted_total" varchar(30),
  "extracted_currency" varchar(3),
  "raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_draft_type" varchar(30),
  "created_draft_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_intake_items_organization_id_organizations_id_fk'
  ) THEN
    ALTER TABLE "email_intake_items"
      ADD CONSTRAINT "email_intake_items_organization_id_organizations_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
