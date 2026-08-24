ALTER TABLE "budgets" ADD COLUMN "enforcement_mode" varchar(30);
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "pending_requisition_policy" varchar(30);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "required_approver_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "required_approval_step" integer;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "required_approval_reason" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_required_approver_id_users_id_fk" FOREIGN KEY ("required_approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_enforcement_mode_check" CHECK ("enforcement_mode" IS NULL OR "enforcement_mode" IN ('hard_stop', 'owner_approval', 'visibility_only'));
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_pending_requisition_policy_check" CHECK ("pending_requisition_policy" IS NULL OR "pending_requisition_policy" IN ('approved_only', 'include_pending'));
