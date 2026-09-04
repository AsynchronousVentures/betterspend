import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type postgres from 'postgres';
import { prepareInvoiceReviewHistoryIndex } from './invoice-review-history-migration';

const migrationTag = '20260901011132_lovely_skreet';
const migrationsDirectory = join(__dirname, 'migrations');
const migrationPath = join(migrationsDirectory, `${migrationTag}.sql`);
const migrationRunnerPath = join(__dirname, 'migrate.ts');
const historyMigrationPath = join(__dirname, 'invoice-review-history-migration.ts');
const schemaPath = join(__dirname, 'schema', 'audit.ts');
const verifierPath = join(__dirname, 'verify-migrations.ts');

function pgliteSql(database: PGlite): postgres.Sql {
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    assert.equal(values.length, 0, 'migration helper test adapter requires static SQL');
    const query = strings.join('').replace(/\bCONCURRENTLY\b/gi, '');
    const result = await database.query(query);
    return result.rows;
  };
  return tagged as unknown as postgres.Sql;
}

test('invoice review history index is canonical, concurrent, and verifier-backed', async () => {
  const [migration, migrationRunner, historyMigration, schema, verifier] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(migrationRunnerPath, 'utf8'),
    readFile(historyMigrationPath, 'utf8'),
    readFile(schemaPath, 'utf8'),
    readFile(verifierPath, 'utf8'),
  ]);

  assert.match(migration, /^-- migrate\.ts builds .* concurrently/);
  assert.match(migration, /SELECT 1/);
  assert.doesNotMatch(migration, /CREATE INDEX/i);
  assert.match(schema, /audit_log_invoice_review_history_idx/);
  assert.match(
    historyMigration,
    /async function prepareInvoiceReviewHistoryIndex\(client: postgres\.Sql\)/,
  );
  assert.match(historyMigration, /SET lock_timeout = '5s'/);
  assert.match(historyMigration, /SET statement_timeout = '5min'/);
  assert.match(historyMigration, /RESET statement_timeout/);
  assert.match(historyMigration, /RESET lock_timeout/);
  assert.match(historyMigration, /DROP INDEX CONCURRENTLY "audit_log_invoice_review_history_idx"/);
  assert.match(historyMigration, /index_state\.indpred IS NULL/);
  assert.match(
    historyMigration,
    /CREATE INDEX CONCURRENTLY "audit_log_invoice_review_history_idx"[\s\S]*?"organization_id"[\s\S]*?"entity_type"[\s\S]*?"entity_id"[\s\S]*?"created_at" DESC[\s\S]*?"id" DESC/,
  );
  assert.match(verifier, /audit_log_invoice_review_history_idx/);
  assert.match(verifier, /'entity_type'/);
  assert.match(verifier, /'entity_id'/);
  assert.match(verifier, /'created_at DESC NULLS LAST'/);
  assert.match(verifier, /'id DESC NULLS LAST'/);
  assert.match(verifier, /index_data\.indpred IS NULL/);

  const migrationCall = migrationRunner.indexOf(
    "await migrate(db, { migrationsFolder: path.resolve(__dirname, 'migrations') });",
  );
  const prepareCall = migrationRunner.indexOf('await prepareInvoiceReviewHistoryIndex(client);');
  const postMigratePrepareCall = migrationRunner.lastIndexOf(
    'await prepareInvoiceReviewHistoryIndex(client);',
  );
  assert.ok(migrationCall >= 0, 'migration call must exist');
  assert.ok(prepareCall >= 0, 'history index preparation must run');
  assert.ok(prepareCall < migrationCall, 'history index must be prepared before migrations');
  assert.ok(
    postMigratePrepareCall > migrationCall,
    'history index must be prepared after fresh-schema migrations too',
  );
});

test('repairs a same-name partial history index before verifier acceptance', async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE audit_log (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        entity_type varchar(50) NOT NULL,
        entity_id uuid NOT NULL,
        action varchar(50) NOT NULL,
        created_at timestamptz NOT NULL
      );
    `);
    await database.query(`
      CREATE INDEX "audit_log_invoice_review_history_idx"
      ON audit_log (
        organization_id,
        entity_type,
        entity_id,
        created_at DESC NULLS LAST,
        id DESC NULLS LAST
      )
      WHERE action = 'invoice_review.claim'
    `);

    const partialIndex = await database.query<{ predicate: string | null }>(`
      SELECT pg_get_expr(index_data.indpred, index_data.indrelid) AS predicate
      FROM pg_index AS index_data
      WHERE index_data.indexrelid = 'public.audit_log_invoice_review_history_idx'::regclass
    `);
    assert.match(partialIndex.rows[0]?.predicate ?? '', /action/);

    const verifierCandidatesBeforeRepair = await database.query<{ name: string }>(`
      SELECT index_class.relname AS name
      FROM pg_index AS index_data
      JOIN pg_class AS index_class ON index_class.oid = index_data.indexrelid
      JOIN pg_class AS table_class ON table_class.oid = index_data.indrelid
      JOIN pg_namespace AS table_namespace ON table_namespace.oid = table_class.relnamespace
      WHERE table_namespace.nspname = 'public'
        AND index_data.indisvalid
        AND index_data.indpred IS NULL
        AND index_class.relname = 'audit_log_invoice_review_history_idx'
    `);
    assert.deepEqual(verifierCandidatesBeforeRepair.rows, []);

    await prepareInvoiceReviewHistoryIndex(pgliteSql(database));

    const repairedIndex = await database.query<{
      definition: string;
      predicate: string | null;
    }>(`
      SELECT
        pg_get_indexdef(index_data.indexrelid) AS definition,
        pg_get_expr(index_data.indpred, index_data.indrelid) AS predicate
      FROM pg_index AS index_data
      WHERE index_data.indexrelid = 'public.audit_log_invoice_review_history_idx'::regclass
    `);
    assert.equal(repairedIndex.rows[0]?.predicate, null);
    assert.match(
      repairedIndex.rows[0]?.definition ?? '',
      /organization_id, entity_type, entity_id, created_at DESC NULLS LAST, id DESC NULLS LAST/,
    );

    const verifierCandidatesAfterRepair = await database.query<{ name: string }>(`
      SELECT index_class.relname AS name
      FROM pg_index AS index_data
      JOIN pg_class AS index_class ON index_class.oid = index_data.indexrelid
      JOIN pg_class AS table_class ON table_class.oid = index_data.indrelid
      JOIN pg_namespace AS table_namespace ON table_namespace.oid = table_class.relnamespace
      WHERE table_namespace.nspname = 'public'
        AND index_data.indisvalid
        AND index_data.indpred IS NULL
        AND index_class.relname = 'audit_log_invoice_review_history_idx'
    `);
    assert.deepEqual(verifierCandidatesAfterRepair.rows, [
      { name: 'audit_log_invoice_review_history_idx' },
    ]);
  } finally {
    await database.close();
  }
});
