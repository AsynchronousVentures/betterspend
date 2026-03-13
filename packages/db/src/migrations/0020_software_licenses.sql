CREATE TABLE IF NOT EXISTS "software_licenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "vendor_id" uuid NOT NULL,
  "contract_id" uuid,
  "product_name" varchar(255) NOT NULL,
  "status" varchar(30) DEFAULT 'active' NOT NULL,
  "seat_count" integer DEFAULT 1 NOT NULL,
  "seats_used" integer DEFAULT 0 NOT NULL,
  "price_per_seat" numeric(14, 2) DEFAULT '0' NOT NULL,
  "currency" varchar(3) DEFAULT 'USD' NOT NULL,
  "billing_cycle" varchar(20) DEFAULT 'annual' NOT NULL,
  "renewal_date" timestamp with time zone,
  "auto_renews" boolean DEFAULT true NOT NULL,
  "renewal_lead_days" integer DEFAULT 30 NOT NULL,
  "owner_user_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "software_licenses_org_idx" ON "software_licenses" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "software_licenses_vendor_idx" ON "software_licenses" USING btree ("vendor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "software_licenses_renewal_idx" ON "software_licenses" USING btree ("renewal_date");
