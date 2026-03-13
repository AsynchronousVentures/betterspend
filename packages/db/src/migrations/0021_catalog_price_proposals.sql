CREATE TABLE IF NOT EXISTS "catalog_price_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "vendor_id" uuid NOT NULL,
  "proposed_price" numeric(14, 2) NOT NULL,
  "current_price" numeric(14, 2) NOT NULL,
  "effective_date" timestamp with time zone,
  "note" text,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  "notified_vendor" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_price_proposals" ADD CONSTRAINT "catalog_price_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_price_proposals" ADD CONSTRAINT "catalog_price_proposals_item_id_catalog_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_price_proposals" ADD CONSTRAINT "catalog_price_proposals_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_price_proposals" ADD CONSTRAINT "catalog_price_proposals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_price_proposals_org_idx" ON "catalog_price_proposals" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_price_proposals_item_idx" ON "catalog_price_proposals" USING btree ("item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_price_proposals_status_idx" ON "catalog_price_proposals" USING btree ("status");
