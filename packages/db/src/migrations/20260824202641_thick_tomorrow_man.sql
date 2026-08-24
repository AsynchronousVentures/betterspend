SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "submission_source" varchar(30) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_organization_fk" FOREIGN KEY ("created_by","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action NOT VALID;
