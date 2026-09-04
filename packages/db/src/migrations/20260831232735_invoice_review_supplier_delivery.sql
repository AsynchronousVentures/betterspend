SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "invoice_review_notification_intents" ALTER COLUMN "recipient_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_review_notification_intents" ADD COLUMN "intent_kind" varchar(50) DEFAULT 'internal_notification' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_review_notification_intents" ADD COLUMN "message_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_review_notification_intents" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "invoice_review_notification_intents" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_id_organization_id_unique" ON "messages" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "invoice_review_notification_intents" ADD CONSTRAINT "invoice_review_notification_intents_message_org_fk" FOREIGN KEY ("message_id","organization_id") REFERENCES "public"."messages"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_notification_intents" ADD CONSTRAINT "invoice_review_notification_intents_kind_check" CHECK ("invoice_review_notification_intents"."intent_kind" IN ('internal_notification', 'supplier_message_email'));--> statement-breakpoint
ALTER TABLE "invoice_review_notification_intents" ADD CONSTRAINT "invoice_review_notification_intents_delivery_shape_check" CHECK ((
        ("invoice_review_notification_intents"."intent_kind" = 'internal_notification' AND "invoice_review_notification_intents"."recipient_user_id" IS NOT NULL AND "invoice_review_notification_intents"."message_id" IS NULL)
        OR
        ("invoice_review_notification_intents"."intent_kind" = 'supplier_message_email' AND "invoice_review_notification_intents"."recipient_user_id" IS NULL AND "invoice_review_notification_intents"."message_id" IS NOT NULL)
      ));
