-- Expand first. The migrator backfills existing rows in tenant-scoped batches
-- before it contracts entry_hash to NOT NULL.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "prev_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "entry_hash" varchar(64);--> statement-breakpoint
CREATE INDEX "audit_log_organization_created_at_id_idx" ON "audit_log" USING btree ("organization_id","created_at","id");
