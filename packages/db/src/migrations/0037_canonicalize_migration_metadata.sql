-- Metadata-only recovery migration.
--
-- Migrations 0008 through 0036 were authored as SQL and journal entries without
-- matching Drizzle snapshots. Their schema changes are already applied by those
-- migrations. This no-op migration records a canonical snapshot of that schema
-- so future migrations are generated from the complete history.
SELECT 1;
