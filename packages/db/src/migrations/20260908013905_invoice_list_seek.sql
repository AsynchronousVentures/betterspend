-- migrate.ts builds invoices_organization_created_id_idx concurrently after the
-- migration transaction, with canonical-definition checks and invalid-index retry.
-- The schema snapshot records the index; this marker preserves migration history.
SELECT 1;
