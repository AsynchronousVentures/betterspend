-- Expand only. Existing application versions can continue inserting role rows while
-- the migrator backfills organization_id in bounded batches and contracts the shape
-- after the migration transaction commits.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_custom_role_id_custom_roles_id_fk";--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "organization_id" uuid;
