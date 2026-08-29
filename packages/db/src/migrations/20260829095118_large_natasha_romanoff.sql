SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "artifact_notification_deliveries" DROP CONSTRAINT "artifact_notification_deliveries_operation_id_artifact_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "artifact_notification_deliveries" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "artifact_notification_deliveries" AS delivery
SET "organization_id" = operation."organization_id"
FROM "artifact_operations" AS operation
WHERE delivery."operation_id" = operation."id";--> statement-breakpoint
ALTER TABLE "artifact_notification_deliveries" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "artifact_notification_deliveries" ADD CONSTRAINT "artifact_notification_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_operations_id_organization_id_unique" ON "artifact_operations" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "artifact_notification_deliveries" ADD CONSTRAINT "artifact_notification_deliveries_operation_org_fk" FOREIGN KEY ("operation_id","organization_id") REFERENCES "public"."artifact_operations"("id","organization_id") ON DELETE cascade ON UPDATE no action;
