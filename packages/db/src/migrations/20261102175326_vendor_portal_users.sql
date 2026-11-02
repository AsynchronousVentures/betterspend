CREATE TABLE "vendor_portal_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"password_hash" text NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendor_portal_sessions" ADD COLUMN "portal_user_id" uuid;--> statement-breakpoint
ALTER TABLE "vendor_portal_users" ADD CONSTRAINT "vendor_portal_users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_portal_users" ADD CONSTRAINT "vendor_portal_users_vendor_org_fk" FOREIGN KEY ("vendor_id","organization_id") REFERENCES "public"."vendors"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_portal_users_org_email_unique" ON "vendor_portal_users" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "vendor_portal_users_vendor_idx" ON "vendor_portal_users" USING btree ("vendor_id");--> statement-breakpoint
ALTER TABLE "vendor_portal_sessions" ADD CONSTRAINT "vendor_portal_sessions_portal_user_id_vendor_portal_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."vendor_portal_users"("id") ON DELETE cascade ON UPDATE no action;