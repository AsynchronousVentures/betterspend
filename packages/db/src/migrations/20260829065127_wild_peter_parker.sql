SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
CREATE TABLE "artifact_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"operation_type" varchar(40) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"artifact_kind" varchar(30),
	"artifact_id" uuid,
	"artifact_number" varchar(100),
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_operations_operation_type_check" CHECK ("artifact_operations"."operation_type" IN ('software_license_renewal', 'message_post')),
	CONSTRAINT "artifact_operations_status_check" CHECK ("artifact_operations"."status" IN ('pending', 'artifact_created', 'completed', 'failed')),
	CONSTRAINT "artifact_operations_artifact_shape_check" CHECK (("artifact_operations"."artifact_id" IS NULL AND "artifact_operations"."artifact_kind" IS NULL) OR ("artifact_operations"."artifact_id" IS NOT NULL AND "artifact_operations"."artifact_kind" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "artifact_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"delivery_key" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_notification_deliveries_status_check" CHECK ("artifact_notification_deliveries"."status" IN ('pending', 'delivered', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "requisitions" ADD COLUMN "idempotency_key" varchar(255);--> statement-breakpoint
ALTER TABLE "rfq_requests" ADD COLUMN "idempotency_key" varchar(255);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "idempotency_key" varchar(255);--> statement-breakpoint
ALTER TABLE "artifact_operations" ADD CONSTRAINT "artifact_operations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_notification_deliveries" ADD CONSTRAINT "artifact_notification_deliveries_operation_id_artifact_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."artifact_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_operations_org_key_unique" ON "artifact_operations" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "artifact_operations_org_status_idx" ON "artifact_operations" USING btree ("organization_id","operation_type","status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_notification_deliveries_operation_key_unique" ON "artifact_notification_deliveries" USING btree ("operation_id","delivery_key");--> statement-breakpoint
CREATE INDEX "artifact_notification_deliveries_retry_idx" ON "artifact_notification_deliveries" USING btree ("status","lease_expires_at");--> statement-breakpoint
