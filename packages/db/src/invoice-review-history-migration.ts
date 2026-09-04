import type postgres from 'postgres';

type AuditHistoryIndexState = {
  auditLogTableExists: boolean;
  indexExists: boolean;
  indexIsValid: boolean;
  indexIsCanonical: boolean;
};

/** Build the invoice-review history lookup without blocking audit appends. */
export async function prepareInvoiceReviewHistoryIndex(client: postgres.Sql): Promise<void> {
  const [state] = await client<AuditHistoryIndexState[]>`
    SELECT
      to_regclass('public.audit_log') IS NOT NULL AS "auditLogTableExists",
      index_class.oid IS NOT NULL AS "indexExists",
      COALESCE(index_state.indisvalid, false) AS "indexIsValid",
      COALESCE(
          index_state.indrelid = to_regclass('public.audit_log')
          AND NOT index_state.indisunique
          AND index_state.indpred IS NULL
          AND COALESCE(index_state.indnkeyatts, 0) = 5
          AND COALESCE(index_state.indnatts, 0) = 5
          AND access_method.amname = 'btree'
          AND COALESCE((
            SELECT array_agg(attribute.attname::text ORDER BY indexed.ordinality)
            FROM unnest(index_state.indkey) WITH ORDINALITY AS indexed(attnum, ordinality)
            JOIN pg_attribute AS attribute
              ON attribute.attrelid = index_state.indrelid
              AND attribute.attnum = indexed.attnum
          ) = ARRAY[
            'organization_id',
            'entity_type',
            'entity_id',
            'created_at',
            'id'
          ]::text[], false)
          AND COALESCE((
            SELECT array_agg(indexed.option::integer ORDER BY indexed.ordinality)
            FROM unnest(index_state.indoption) WITH ORDINALITY AS indexed(option, ordinality)
          ) = ARRAY[0, 0, 0, 1, 1]::integer[], false),
        false
      ) AS "indexIsCanonical"
    FROM (VALUES (1)) AS singleton(value)
    LEFT JOIN pg_class AS index_class
      ON index_class.oid = to_regclass('public.audit_log_invoice_review_history_idx')
    LEFT JOIN pg_index AS index_state ON index_state.indexrelid = index_class.oid
    LEFT JOIN pg_am AS access_method ON access_method.oid = index_class.relam
  `;

  if (!state?.auditLogTableExists || (state.indexIsValid && state.indexIsCanonical)) return;

  await client`SET lock_timeout = '5s'`;
  await client`SET statement_timeout = '5min'`;
  try {
    if (state.indexExists) {
      await client`DROP INDEX CONCURRENTLY "audit_log_invoice_review_history_idx"`;
    }
    await client`
      CREATE INDEX CONCURRENTLY "audit_log_invoice_review_history_idx"
      ON "audit_log" (
        "organization_id",
        "entity_type",
        "entity_id",
        "created_at" DESC NULLS LAST,
        "id" DESC NULLS LAST
      )
    `;
  } finally {
    await client`RESET statement_timeout`;
    await client`RESET lock_timeout`;
  }
}
