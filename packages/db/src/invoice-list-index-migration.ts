import type postgres from 'postgres';

type InvoiceListIndexState = {
  tableExists: boolean;
  indexExists: boolean;
  indexIsValid: boolean;
  indexIsCanonical: boolean;
};

/** The first deployment migration pass runs while the previous API is live. */
export async function prepareInvoiceListIndex(client: postgres.Sql): Promise<void> {
  const [state] = await client<InvoiceListIndexState[]>`
    SELECT
      to_regclass('public.invoices') IS NOT NULL AS "tableExists",
      index_class.oid IS NOT NULL AS "indexExists",
      COALESCE(index_state.indisvalid, false) AS "indexIsValid",
      COALESCE(
        index_state.indrelid = to_regclass('public.invoices')
        AND NOT index_state.indisunique
        AND index_state.indpred IS NULL
        AND index_state.indexprs IS NULL
        AND index_state.indnkeyatts = 3
        AND index_state.indnatts = 3
        AND index_state.indoption::text = '0 0 0'
        AND access_method.amname = 'btree'
        AND (
          SELECT array_agg(attribute.attname::text ORDER BY indexed.ordinality)
          FROM unnest(index_state.indkey) WITH ORDINALITY AS indexed(attnum, ordinality)
          JOIN pg_attribute AS attribute ON attribute.attrelid = index_state.indrelid
            AND attribute.attnum = indexed.attnum
        ) = ARRAY['organization_id', 'created_at', 'id']::text[], false
      ) AS "indexIsCanonical"
    FROM (VALUES (1)) AS singleton(value)
    LEFT JOIN pg_class AS index_class
      ON index_class.oid = to_regclass('public.invoices_organization_created_id_idx')
    LEFT JOIN pg_index AS index_state ON index_state.indexrelid = index_class.oid
    LEFT JOIN pg_am AS access_method ON access_method.oid = index_class.relam
  `;
  if (!state?.tableExists || (state.indexIsValid && state.indexIsCanonical)) return;
  if (state.indexExists && !state.indexIsCanonical) {
    throw new Error(
      'invoices_organization_created_id_idx has an unexpected definition; reconcile it before migrating',
    );
  }

  await client`SET lock_timeout = '5s'`;
  await client`SET statement_timeout = '5min'`;
  try {
    if (state.indexExists) {
      // Failed concurrent builds leave invalid indexes behind. Retry cleanly.
      await client`DROP INDEX CONCURRENTLY "invoices_organization_created_id_idx"`;
    }
    await client`CREATE INDEX CONCURRENTLY "invoices_organization_created_id_idx"
      ON "invoices" ("organization_id", "created_at", "id")`;
  } finally {
    await client`RESET statement_timeout`;
    await client`RESET lock_timeout`;
  }
}
