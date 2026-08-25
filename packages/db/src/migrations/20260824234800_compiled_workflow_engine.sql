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
ALTER TABLE "approval_actions" ALTER COLUMN "approver_id" DROP NOT NULL;
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
WITH first_action_actor AS (
  SELECT DISTINCT ON (action."approval_request_id")
    action."approval_request_id",
    action."approver_id"
  FROM "approval_actions" AS action
  ORDER BY action."approval_request_id", action."acted_at", action."id"
), initiator_candidates AS (
  SELECT
    request."id",
    COALESCE(
      requisition_actor."id",
      purchase_order_actor."id",
      invoice_actor."id",
      action_actor."id"
    ) AS "initiated_by"
  FROM "approval_requests" AS request
  LEFT JOIN "requisitions" AS requisition
    ON request."approvable_type" = 'requisition'
    AND requisition."id" = request."approvable_id"
  LEFT JOIN "users" AS requisition_actor
    ON requisition_actor."id" = requisition."requester_id"
    AND requisition_actor."organization_id" = request."organization_id"
  LEFT JOIN "purchase_orders" AS purchase_order
    ON request."approvable_type" = 'purchase_order'
    AND purchase_order."id" = request."approvable_id"
  LEFT JOIN "users" AS purchase_order_actor
    ON purchase_order_actor."id" = purchase_order."issued_by"
    AND purchase_order_actor."organization_id" = request."organization_id"
  LEFT JOIN "invoices" AS invoice
    ON request."approvable_type" = 'invoice'
    AND invoice."id" = request."approvable_id"
  LEFT JOIN "users" AS invoice_actor
    ON invoice_actor."id" = invoice."created_by"
    AND invoice_actor."organization_id" = request."organization_id"
  LEFT JOIN first_action_actor AS first_action
    ON first_action."approval_request_id" = request."id"
  LEFT JOIN "users" AS action_actor
    ON action_actor."id" = first_action."approver_id"
    AND action_actor."organization_id" = request."organization_id"
  WHERE request."initiated_by" IS NULL
)
UPDATE "approval_requests" AS request
SET "initiated_by" = candidate."initiated_by"
FROM initiator_candidates AS candidate
WHERE request."id" = candidate."id";
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_approval_assignments_status_check" CHECK ("workflow_approval_assignments"."status" in ('waiting', 'pending', 'approved', 'rejected', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "workflow_approval_assignments" ADD CONSTRAINT "workflow_approval_assignments_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
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
