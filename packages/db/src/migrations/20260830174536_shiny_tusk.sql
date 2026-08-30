ALTER TABLE "invoices" ADD COLUMN "released_by" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action NOT VALID;
