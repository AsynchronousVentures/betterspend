import type postgres from 'postgres';

type InvoiceLineForeignKeyState = {
  provenanceTableExists: boolean;
  invoiceLinesTableExists: boolean;
  provenanceColumnsReady: boolean;
  invoiceLineColumnsReady: boolean;
  parentIndexReady: boolean;
  newExists: boolean;
  newValidated: boolean;
  oldExists: boolean;
};

/** Install the tenant-safe invoice-line foreign key after the parent key is ready. */
export async function ensureInvoiceLineInvoiceForeignKey(client: postgres.Sql): Promise<void> {
  const [state] = await client<InvoiceLineForeignKeyState[]>`
    SELECT
      to_regclass('public.invoice_field_provenance') IS NOT NULL AS "provenanceTableExists",
      to_regclass('public.invoice_lines') IS NOT NULL AS "invoiceLinesTableExists",
      (
        SELECT count(*) = 2
        FROM pg_attribute
        WHERE attrelid = to_regclass('public.invoice_field_provenance')
          AND attname IN ('invoice_id', 'invoice_line_id')
          AND NOT attisdropped
      ) AS "provenanceColumnsReady",
      (
        SELECT count(*) = 2
        FROM pg_attribute
        WHERE attrelid = to_regclass('public.invoice_lines')
          AND attname IN ('id', 'invoice_id')
          AND NOT attisdropped
      ) AS "invoiceLineColumnsReady",
      COALESCE((
        SELECT index_state.indisvalid AND index_state.indisunique
        FROM pg_index AS index_state
        WHERE index_state.indexrelid =
          to_regclass('public.invoice_lines_id_invoice_id_unique')
          AND index_state.indrelid = to_regclass('public.invoice_lines')
      ), false) AS "parentIndexReady",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = to_regclass('public.invoice_field_provenance')
          AND conname = 'invoice_field_provenance_invoice_line_invoice_fk'
      ) AS "newExists",
      COALESCE((
        SELECT convalidated
        FROM pg_constraint
        WHERE conrelid = to_regclass('public.invoice_field_provenance')
          AND conname = 'invoice_field_provenance_invoice_line_invoice_fk'
      ), false) AS "newValidated",
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = to_regclass('public.invoice_field_provenance')
          AND conname = 'invoice_field_provenance_invoice_line_id_invoice_lines_id_fk'
      ) AS "oldExists"
  `;

  if (
    !state ||
    !state.provenanceTableExists ||
    !state.invoiceLinesTableExists ||
    !state.provenanceColumnsReady ||
    !state.invoiceLineColumnsReady ||
    !state.parentIndexReady ||
    (state.newExists && state.newValidated && !state.oldExists)
  ) {
    return;
  }

  await client.begin(async (transaction) => {
    await transaction`SET LOCAL lock_timeout = '5s'`;
    await transaction`SET LOCAL statement_timeout = '5min'`;

    if (!state.newExists) {
      await transaction`
        ALTER TABLE "invoice_field_provenance"
        ADD CONSTRAINT "invoice_field_provenance_invoice_line_invoice_fk"
        FOREIGN KEY ("invoice_line_id", "invoice_id")
        REFERENCES "public"."invoice_lines"("id", "invoice_id")
        NOT VALID
      `;
    }
    if (!state.newValidated) {
      await transaction`
        ALTER TABLE "invoice_field_provenance"
        VALIDATE CONSTRAINT "invoice_field_provenance_invoice_line_invoice_fk"
      `;
    }
    if (state.oldExists) {
      await transaction`
        ALTER TABLE "invoice_field_provenance"
        DROP CONSTRAINT "invoice_field_provenance_invoice_line_id_invoice_lines_id_fk"
      `;
    }
  });
}
