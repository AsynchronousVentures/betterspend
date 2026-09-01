-- migrate.ts builds audit_log_invoice_review_history_idx concurrently
-- after Drizzle commits this transactional migration, keeping audit appends writable.
SELECT 1;
