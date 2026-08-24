CREATE TABLE IF NOT EXISTS "sanctions_registry_state" (
	"source" varchar(50) PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sanctions_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" varchar(50) NOT NULL,
  "external_id" varchar(120),
  "entity_name" varchar(500) NOT NULL,
  "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "country" varchar(100),
  "list_date" varchar(40),
  "entry_type" varchar(40),
  "raw" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sanctions_entries_source_idx" ON "sanctions_entries" USING btree ("source","entity_name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sanctions_screenings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "vendor_id" uuid NOT NULL,
  "result" varchar(20) NOT NULL,
  "match_count" jsonb,
  "screened_by" uuid,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sanctions_screenings" ADD CONSTRAINT "sanctions_screenings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sanctions_screenings" ADD CONSTRAINT "sanctions_screenings_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sanctions_screenings" ADD CONSTRAINT "sanctions_screenings_screened_by_users_id_fk" FOREIGN KEY ("screened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sanctions_screenings_vendor_idx" ON "sanctions_screenings" USING btree ("vendor_id","created_at");
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "sanctions_status" varchar(20) DEFAULT 'untested' NOT NULL;
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "sanctions_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "sanctions_note" text;
