CREATE TABLE IF NOT EXISTS "procurement_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "title" varchar(255) NOT NULL,
  "policy_type" varchar(50) DEFAULT 'general' NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "body" text NOT NULL,
  "rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intake_concierge_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "requester_id" uuid,
  "status" varchar(30) DEFAULT 'draft' NOT NULL,
  "source_text" text NOT NULL,
  "transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "accepted_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "converted_draft_type" varchar(30),
  "converted_draft_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procurement_policies_org_status_idx"
  ON "procurement_policies" ("organization_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_concierge_sessions_org_created_idx"
  ON "intake_concierge_sessions" ("organization_id", "created_at");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'procurement_policies_organization_id_organizations_id_fk'
  ) THEN
    ALTER TABLE "procurement_policies"
      ADD CONSTRAINT "procurement_policies_organization_id_organizations_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'procurement_policies_created_by_users_id_fk'
  ) THEN
    ALTER TABLE "procurement_policies"
      ADD CONSTRAINT "procurement_policies_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "users"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'intake_concierge_sessions_organization_id_organizations_id_fk'
  ) THEN
    ALTER TABLE "intake_concierge_sessions"
      ADD CONSTRAINT "intake_concierge_sessions_organization_id_organizations_id_fk"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'intake_concierge_sessions_requester_id_users_id_fk'
  ) THEN
    ALTER TABLE "intake_concierge_sessions"
      ADD CONSTRAINT "intake_concierge_sessions_requester_id_users_id_fk"
      FOREIGN KEY ("requester_id") REFERENCES "users"("id");
  END IF;
END $$;
