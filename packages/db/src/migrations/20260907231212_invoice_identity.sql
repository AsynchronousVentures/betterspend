-- migrate.ts builds invoices_org_vendor_number_unique concurrently after the
-- migration transaction, with duplicate reconciliation and invalid-index retry.
-- The schema snapshot records the index; this marker preserves migration history.
SELECT 1;
