import type postgres from 'postgres';

type InvoiceIdentityIndexState = {
  tableExists: boolean;
  indexExists: boolean;
  indexIsValid: boolean;
  indexIsCanonical: boolean;
};

/** The first deployment migration pass runs while the previous API is live. */
export async function prepareInvoiceIdentityIndex(client: postgres.Sql): Promise<void> {
  const [state] = await client<InvoiceIdentityIndexState[]>`
    SELECT
      to_regclass('public.invoices') IS NOT NULL AS "tableExists",
      index_class.oid IS NOT NULL AS "indexExists",
      COALESCE(index_state.indisvalid, false) AS "indexIsValid",
      COALESCE(
        index_state.indrelid = to_regclass('public.invoices')
        AND index_state.indisunique
        AND index_state.indpred IS NULL
        AND index_state.indexprs IS NULL
        AND index_state.indnkeyatts = 3
        AND index_state.indnatts = 3
        AND access_method.amname = 'btree'
        AND (
          SELECT array_agg(attribute.attname::text ORDER BY indexed.ordinality)
          FROM unnest(index_state.indkey) WITH ORDINALITY AS indexed(attnum, ordinality)
          JOIN pg_attribute AS attribute ON attribute.attrelid = index_state.indrelid
            AND attribute.attnum = indexed.attnum
        ) = ARRAY['organization_id', 'vendor_id', 'invoice_number']::text[], false
      ) AS "indexIsCanonical"
    FROM (VALUES (1)) AS singleton(value)
    LEFT JOIN pg_class AS index_class
      ON index_class.oid = to_regclass('public.invoices_org_vendor_number_unique')
    LEFT JOIN pg_index AS index_state ON index_state.indexrelid = index_class.oid
    LEFT JOIN pg_am AS access_method ON access_method.oid = index_class.relam
  `;
  if (!state?.tableExists || (state.indexIsValid && state.indexIsCanonical)) return;
  if (state.indexExists && !state.indexIsCanonical) {
    throw new Error(
      'invoices_org_vendor_number_unique has an unexpected definition; reconcile it before migrating',
    );
  }

  await client`SET lock_timeout = '5s'`;
  await client`SET statement_timeout = '5min'`;
  try {
    // Preserve the existing exact, case-sensitive identity, including cancelled
    // invoices. Finance must reconcile historical duplicates before retrying.
    await client`DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM invoices GROUP BY organization_id, vendor_id, invoice_number HAVING count(*) > 1
      ) THEN
        RAISE EXCEPTION 'Duplicate vendor invoice identities prevent migration'
          USING HINT = 'Review SELECT organization_id, vendor_id, invoice_number, array_agg(id) FROM invoices GROUP BY organization_id, vendor_id, invoice_number HAVING count(*) > 1; reconcile historical records with finance before retrying. No invoices were changed.';
      END IF;
    END $$`;
    if (state.indexExists) {
      // Failed concurrent builds leave invalid indexes behind. Retry cleanly.
      await client`DROP INDEX CONCURRENTLY "invoices_org_vendor_number_unique"`;
    }
    await client`CREATE UNIQUE INDEX CONCURRENTLY "invoices_org_vendor_number_unique"
      ON "invoices" ("organization_id", "vendor_id", "invoice_number")`;
  } finally {
    await client`RESET statement_timeout`;
    await client`RESET lock_timeout`;
  }
}
