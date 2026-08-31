-- The migration runner prepares the parent key outside the migration transaction,
-- then installs and validates the invoice-line foreign key after migrations finish.
-- Keeping this history entry transactional and side-effect free makes both paths safe.
SELECT 1;
