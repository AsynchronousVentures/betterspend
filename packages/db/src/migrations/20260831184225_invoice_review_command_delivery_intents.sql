CREATE TABLE "invoice_review_notification_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_review_notification_intents_status_check" CHECK ("invoice_review_notification_intents"."status" IN ('pending', 'delivered'))
);
--> statement-breakpoint
ALTER TABLE "invoice_review_notification_intents" ADD CONSTRAINT "invoice_review_notification_intents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_notification_intents" ADD CONSTRAINT "invoice_review_notification_intents_case_org_fk" FOREIGN KEY ("case_id","organization_id") REFERENCES "public"."invoice_review_cases"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_review_notification_intents" ADD CONSTRAINT "invoice_review_notification_intents_recipient_org_fk" FOREIGN KEY ("recipient_user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_review_notification_intents_idempotency_unique" ON "invoice_review_notification_intents" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "invoice_review_notification_intents_pending_idx" ON "invoice_review_notification_intents" USING btree ("status","created_at");