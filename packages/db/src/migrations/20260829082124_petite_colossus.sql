SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD COLUMN "draft_fence" integer DEFAULT 0 NOT NULL;
