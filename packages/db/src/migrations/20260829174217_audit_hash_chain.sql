-- Expand only. The migrator backfills existing rows in bounded tenant batches;
-- a later deployment owns the nullable-to-NOT-NULL contract.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "prev_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "entry_hash" varchar(64);

-- migrate.ts builds audit_log_organization_created_at_id_idx concurrently
-- after Drizzle commits this transactional migration.
