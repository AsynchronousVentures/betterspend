CREATE TABLE "vendor_portal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_portal_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
-- Existing databases build this concurrently in migrate.ts before transactional migrations run.
-- This fallback creates it only while bootstrapping an empty database.
DO $$
BEGIN
	IF to_regclass('public.vendors_id_organization_id_unique') IS NULL THEN
		EXECUTE 'CREATE UNIQUE INDEX "vendors_id_organization_id_unique" ON "vendors" USING btree ("id","organization_id")';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "vendor_portal_sessions" ADD CONSTRAINT "vendor_portal_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_portal_sessions" ADD CONSTRAINT "vendor_portal_sessions_vendor_org_fk" FOREIGN KEY ("vendor_id","organization_id") REFERENCES "public"."vendors"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_portal_sessions_org_vendor_idx" ON "vendor_portal_sessions" USING btree ("organization_id","vendor_id");
