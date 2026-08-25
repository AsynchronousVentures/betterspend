SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_definition_version_fk";
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "manager_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_actions" ADD COLUMN "node_id" varchar(100);
--> statement-breakpoint
ALTER TABLE "approval_actions" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "organization_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "initiated_by" uuid;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "workflow_context" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "approval_requests" AS request
SET "organization_id" = COALESCE(
  (SELECT version."organization_id" FROM "workflow_definition_versions" AS version WHERE version."id" = request."definition_version_id"),
  (SELECT rule."organization_id" FROM "approval_rules" AS rule WHERE rule."id" = request."approval_rule_id"),
  (SELECT requisition."organization_id" FROM "requisitions" AS requisition WHERE request."approvable_type" = 'requisition' AND requisition."id" = request."approvable_id"),
  (SELECT purchase_order."organization_id" FROM "purchase_orders" AS purchase_order WHERE request."approvable_type" = 'purchase_order' AND purchase_order."id" = request."approvable_id"),
  (SELECT invoice."organization_id" FROM "invoices" AS invoice WHERE request."approvable_type" = 'invoice' AND invoice."id" = request."approvable_id")
);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "approval_requests" WHERE "organization_id" IS NULL) THEN
    RAISE EXCEPTION 'Cannot infer organization_id for every approval request';
  END IF;
END
$$;
--> statement-breakpoint
UPDATE "approval_requests" AS request
SET "initiated_by" = COALESCE(
  (SELECT requisition."requester_id" FROM "requisitions" AS requisition JOIN "users" AS actor ON actor."id" = requisition."requester_id" AND actor."organization_id" = request."organization_id" WHERE request."approvable_type" = 'requisition' AND requisition."id" = request."approvable_id"),
  (SELECT purchase_order."issued_by" FROM "purchase_orders" AS purchase_order JOIN "users" AS actor ON actor."id" = purchase_order."issued_by" AND actor."organization_id" = request."organization_id" WHERE request."approvable_type" = 'purchase_order' AND purchase_order."id" = request."approvable_id"),
  (SELECT invoice."created_by" FROM "invoices" AS invoice JOIN "users" AS actor ON actor."id" = invoice."created_by" AND actor."organization_id" = request."organization_id" WHERE request."approvable_type" = 'invoice' AND invoice."id" = request."approvable_id"),
  (SELECT action."approver_id" FROM "approval_actions" AS action JOIN "users" AS actor ON actor."id" = action."approver_id" AND actor."organization_id" = request."organization_id" WHERE action."approval_request_id" = request."id" ORDER BY action."acted_at", action."id" LIMIT 1)
)
WHERE request."initiated_by" IS NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_id_organization_id_unique" ON "approval_requests" USING btree ("id", "organization_id");
--> statement-breakpoint
CREATE INDEX "approval_requests_org_status_idx" ON "approval_requests" USING btree ("organization_id", "status");
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_definition_version_org_fk" FOREIGN KEY ("definition_version_id", "organization_id") REFERENCES "public"."workflow_definition_versions"("id", "organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_initiated_by_org_fk" FOREIGN KEY ("initiated_by", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_manager_org_fk" FOREIGN KEY ("manager_id", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "workflow_approval_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"node_id" varchar(100) NOT NULL,
	"sequence" integer NOT NULL,
	"resolver" jsonb NOT NULL,
	"resolved_approver_id" uuid NOT NULL,
	"assigned_approver_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"acted_by" uuid,
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_approval_assignments" ADD CONSTRAINT "workflow_approval_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_approval_assignments" ADD CONSTRAINT "workflow_approval_assignments_request_org_fk" FOREIGN KEY ("approval_request_id", "organization_id") REFERENCES "public"."approval_requests"("id", "organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_approval_assignments" ADD CONSTRAINT "workflow_approval_assignments_resolved_approver_org_fk" FOREIGN KEY ("resolved_approver_id", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_approval_assignments" ADD CONSTRAINT "workflow_approval_assignments_assigned_approver_org_fk" FOREIGN KEY ("assigned_approver_id", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_approval_assignments" ADD CONSTRAINT "workflow_approval_assignments_acted_by_org_fk" FOREIGN KEY ("acted_by", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_approval_assignments_request_node_sequence_unique" ON "workflow_approval_assignments" USING btree ("approval_request_id", "node_id", "sequence");
--> statement-breakpoint
CREATE INDEX "workflow_approval_assignments_assignee_status_idx" ON "workflow_approval_assignments" USING btree ("organization_id", "assigned_approver_id", "status");
