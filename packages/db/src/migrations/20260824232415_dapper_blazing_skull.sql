CREATE TABLE "email_intake_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"token" varchar(48) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_intake_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"email_intake_item_id" uuid,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"storage_key" varchar(500),
	"status" varchar(20) NOT NULL,
	"rejection_reason" varchar(80),
	"invoice_number_hint" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_intake_attachments_status_check" CHECK ("email_intake_attachments"."status" IN ('pending', 'accepted', 'duplicate', 'rejected')),
	CONSTRAINT "email_intake_attachments_outcome_check" CHECK (("email_intake_attachments"."status" IN ('pending', 'accepted') AND "email_intake_attachments"."storage_key" IS NOT NULL AND "email_intake_attachments"."rejection_reason" IS NULL) OR ("email_intake_attachments"."status" IN ('duplicate', 'rejected') AND "email_intake_attachments"."storage_key" IS NULL AND "email_intake_attachments"."rejection_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "email_intake_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ses_message_id" varchar(255) NOT NULL,
	"raw_storage_key" varchar(500) NOT NULL,
	"source_email" varchar(255) NOT NULL,
	"envelope_source" varchar(255) NOT NULL,
	"recipients" jsonb NOT NULL,
	"subject" varchar(500) DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"auth_verdicts" jsonb NOT NULL,
	"sender_classification" varchar(30) NOT NULL,
	"vendor_id" uuid,
	"risk_score" integer NOT NULL,
	"risk_signals" jsonb NOT NULL,
	"status" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_intake_messages_sender_classification_check" CHECK ("email_intake_messages"."sender_classification" IN ('known_vendor', 'employee', 'unknown')),
	CONSTRAINT "email_intake_messages_status_check" CHECK ("email_intake_messages"."status" IN ('accepted', 'partial', 'rejected', 'duplicate')),
	CONSTRAINT "email_intake_messages_risk_score_check" CHECK ("email_intake_messages"."risk_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_intake_messages_id_org_unique" ON "email_intake_messages" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_intake_items_id_org_unique" ON "email_intake_items" USING btree ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "email_intake_addresses" ADD CONSTRAINT "email_intake_addresses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_intake_attachments" ADD CONSTRAINT "email_intake_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_intake_attachments" ADD CONSTRAINT "email_intake_attachments_message_org_fk" FOREIGN KEY ("message_id","organization_id") REFERENCES "public"."email_intake_messages"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_intake_attachments" ADD CONSTRAINT "email_intake_attachments_item_org_fk" FOREIGN KEY ("email_intake_item_id","organization_id") REFERENCES "public"."email_intake_items"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_intake_messages" ADD CONSTRAINT "email_intake_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_intake_messages" ADD CONSTRAINT "email_intake_messages_vendor_org_fk" FOREIGN KEY ("vendor_id","organization_id") REFERENCES "public"."vendors"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_intake_addresses_org_unique" ON "email_intake_addresses" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_intake_addresses_token_unique" ON "email_intake_addresses" USING btree ("token");--> statement-breakpoint
CREATE INDEX "email_intake_attachments_message_idx" ON "email_intake_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "email_intake_attachments_org_hash_idx" ON "email_intake_attachments" USING btree ("organization_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "email_intake_messages_org_ses_id_unique" ON "email_intake_messages" USING btree ("organization_id","ses_message_id");--> statement-breakpoint
CREATE INDEX "email_intake_messages_org_received_idx" ON "email_intake_messages" USING btree ("organization_id","received_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_email_intake_message_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'email_intake_messages is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_intake_messages_append_only
BEFORE UPDATE OR DELETE ON "email_intake_messages"
FOR EACH ROW EXECUTE FUNCTION reject_email_intake_message_mutation();
