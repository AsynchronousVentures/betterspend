CREATE TABLE "requisition_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "public"."organizations"("id") ON DELETE cascade,
  "created_by_id" uuid NOT NULL REFERENCES "public"."users"("id"),
  "name" varchar(255) NOT NULL,
  "description" text,
  "is_org_wide" boolean NOT NULL DEFAULT false,
  "template_data" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
