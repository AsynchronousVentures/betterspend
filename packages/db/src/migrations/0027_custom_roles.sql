CREATE TABLE IF NOT EXISTS "custom_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" varchar(120) NOT NULL,
  "description" text,
  "permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "user_roles"
  ADD COLUMN IF NOT EXISTS "custom_role_id" uuid;

DO $$ BEGIN
  ALTER TABLE "custom_roles"
    ADD CONSTRAINT "custom_roles_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "user_roles"
    ADD CONSTRAINT "user_roles_custom_role_id_custom_roles_id_fk"
    FOREIGN KEY ("custom_role_id") REFERENCES "custom_roles"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "custom_roles_org_name_idx"
  ON "custom_roles" ("organization_id", lower("name"));
