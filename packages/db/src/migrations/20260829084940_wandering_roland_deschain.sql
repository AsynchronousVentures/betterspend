SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "workflow_definition_versions" ADD COLUMN "notes_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
