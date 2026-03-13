ALTER TABLE "vendors"
  ADD COLUMN IF NOT EXISTS "onboarding_status" varchar(30) DEFAULT 'not_started' NOT NULL;
--> statement-breakpoint
ALTER TABLE "vendors"
  ADD COLUMN IF NOT EXISTS "onboarding_risk_score" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "vendors"
  ADD COLUMN IF NOT EXISTS "onboarding_risk_level" varchar(20) DEFAULT 'low' NOT NULL;
--> statement-breakpoint
ALTER TABLE "vendors"
  ADD COLUMN IF NOT EXISTS "onboarding_approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "vendors"
  ADD COLUMN IF NOT EXISTS "onboarding_last_submitted_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_questionnaires" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "scoring_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_onboarding_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "vendor_id" uuid NOT NULL,
  "questionnaire_id" uuid,
  "status" varchar(30) DEFAULT 'draft' NOT NULL,
  "company_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "document_links" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "banking_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "risk_score" varchar(20) DEFAULT '0' NOT NULL,
  "risk_level" varchar(20) DEFAULT 'low' NOT NULL,
  "review_note" text,
  "submitted_at" timestamp with time zone,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'onboarding_questionnaires_organization_id_organizations_id_fk'
  ) THEN
    ALTER TABLE "onboarding_questionnaires"
      ADD CONSTRAINT "onboarding_questionnaires_organization_id_organizations_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vendor_onboarding_submissions_org_fk'
  ) THEN
    ALTER TABLE "vendor_onboarding_submissions"
      ADD CONSTRAINT "vendor_onboarding_submissions_org_fk"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vendor_onboarding_submissions_vendor_fk'
  ) THEN
    ALTER TABLE "vendor_onboarding_submissions"
      ADD CONSTRAINT "vendor_onboarding_submissions_vendor_fk"
      FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE cascade;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vendor_onboarding_submissions_questionnaire_fk'
  ) THEN
    ALTER TABLE "vendor_onboarding_submissions"
      ADD CONSTRAINT "vendor_onboarding_submissions_questionnaire_fk"
      FOREIGN KEY ("questionnaire_id") REFERENCES "onboarding_questionnaires"("id");
  END IF;
END $$;
