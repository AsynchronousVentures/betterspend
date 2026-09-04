import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import type postgres from 'postgres';
import { ensureInvoiceLineInvoiceForeignKey } from './invoice-line-provenance-migration';

const migrationTag = '20260831054304_invoice_review_signals';
const verifierPath = join(__dirname, 'verify-migrations.ts');
const migrationRunnerPath = join(__dirname, 'migrate.ts');

function pgliteSql(database: PGlite): postgres.Sql {
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    assert.equal(values.length, 0, 'migration helper test adapter requires static SQL');
    const result = await database.query(strings.join(''));
    return result.rows;
  };
  Object.assign(tagged, {
    begin: async (callback: (transaction: postgres.Sql) => Promise<unknown>) =>
      database.transaction((transaction) => callback(pgliteSql(transaction as unknown as PGlite))),
  });
  return tagged as unknown as postgres.Sql;
}

test('invoice field provenance migration contains the runtime provenance shape', async () => {
  const migration = await readFile(join(__dirname, 'migrations', `${migrationTag}.sql`), 'utf8');

  assert.match(migration, /"superseded_at" timestamp with time zone/);
  assert.match(migration, /field_path.*~ '\^lines\\\.[^']+\\\./s);
  assert.match(migration, /invoice_field_provenance_invoice_org_fk/);
  assert.match(migration, /invoice_field_provenance_actor_org_fk/);
  assert.match(migration, /invoice_field_provenance_invoice_current_idx/);
  assert.match(migration, /invoice_field_provenance_source_type_check/);
  assert.match(migration, /invoice_field_provenance_field_path_check/);
  assert.match(migration, /invoice_field_provenance_confidence_check/);
});

test('invoice field provenance keeps line references on the same invoice', async () => {
  const migrationFiles = (await readdir(join(__dirname, 'migrations')))
    .filter((file) => file.endsWith('.sql') && file >= `${migrationTag}.sql`)
    .sort();
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE organizations (id uuid PRIMARY KEY);
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        UNIQUE (id, organization_id)
      );
      CREATE TABLE invoices (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        UNIQUE (id, organization_id)
      );
      CREATE TABLE invoice_lines (
        id uuid PRIMARY KEY,
        invoice_id uuid NOT NULL
      );
      -- Supplier delivery later links review intents to the durable message
      -- artifact created by the earlier messages migration.
      CREATE TABLE messages (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL
      );
      -- This fixture starts at the provenance migration rather than replaying
      -- the earlier review-signal migration. Later forward migrations may
      -- legitimately reference the durable review aggregate.
      CREATE TABLE invoice_review_cases (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        invoice_id uuid NOT NULL,
        UNIQUE (id, organization_id)
      );
      CREATE TABLE ocr_jobs (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        uploaded_by uuid NOT NULL,
        filename varchar(255) NOT NULL,
        content_type varchar(100) NOT NULL,
        storage_key varchar(500) NOT NULL,
        status varchar(20) NOT NULL,
        extracted_data jsonb,
        confidence jsonb,
        error_message text,
        invoice_id uuid,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      INSERT INTO organizations (id) VALUES ('00000000-0000-4000-8000-000000000001');
      INSERT INTO invoices (id, organization_id) VALUES
        ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001'),
        ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001');
      INSERT INTO invoice_lines (id, invoice_id) VALUES
        ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002'),
        ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003');
    `);
    await database.exec(
      'CREATE UNIQUE INDEX "invoice_lines_id_invoice_id_unique" ON "invoice_lines" ("id", "invoice_id");',
    );
    for (const file of migrationFiles) {
      await database.exec(await readFile(join(__dirname, 'migrations', file), 'utf8'));
    }
    await ensureInvoiceLineInvoiceForeignKey(pgliteSql(database));
    await ensureInvoiceLineInvoiceForeignKey(pgliteSql(database));
    const installedForeignKey = await database.query<{
      validated: boolean;
      definition: string;
    }>(`
      SELECT
        convalidated AS validated,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'invoice_field_provenance'::regclass
        AND conname = 'invoice_field_provenance_invoice_line_invoice_fk'
    `);
    assert.equal(installedForeignKey.rows[0]?.validated, true);
    assert.match(
      installedForeignKey.rows[0]?.definition ?? '',
      /FOREIGN KEY \(invoice_line_id, invoice_id\) REFERENCES invoice_lines\(id, invoice_id\)/,
    );

    await database.exec(`
      INSERT INTO invoice_field_provenance (
        organization_id, invoice_id, invoice_line_id, field_path,
        source_type, source_record_id, identity_key
      ) VALUES (
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000004',
        'lines.00000000-0000-4000-8000-000000000004.description',
        'manual', 'manual:valid', 'valid'
      );
    `);
    await database.exec(`
      INSERT INTO invoice_field_provenance (
        organization_id, invoice_id, invoice_line_id, field_path,
        source_type, source_record_id, identity_key
      ) VALUES (
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000004',
        'lines.00000000-0000-4000-8000-000000000004.taxInclusive',
        'manual', 'manual:tax-inclusive', 'tax-inclusive'
      );
    `);

    await assert.rejects(
      database.exec(`
        INSERT INTO invoice_field_provenance (
          organization_id, invoice_id, field_path,
          source_type, source_record_id, identity_key
        ) VALUES (
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
          'lines.00000000-0000-4000-8000-000000000004.description',
          'manual', 'manual:missing-line', 'missing-line'
        );
      `),
    );
    await assert.rejects(
      database.exec(`
        INSERT INTO invoice_field_provenance (
          organization_id, invoice_id, invoice_line_id, field_path,
          source_type, source_record_id, identity_key
        ) VALUES (
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000004',
          'totalAmount',
          'manual', 'manual:line-on-header', 'line-on-header'
        );
      `),
    );

    await assert.rejects(
      database.exec(`
        INSERT INTO invoice_field_provenance (
          organization_id, invoice_id, invoice_line_id, field_path,
          source_type, source_record_id, identity_key
        ) VALUES (
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000004',
          'lines.00000000-0000-4000-8000-000000000005.description',
          'manual', 'manual:path-line-mismatch', 'path-line-mismatch'
        );
      `),
    );

    await assert.rejects(
      database.exec(`
        INSERT INTO invoice_field_provenance (
          organization_id, invoice_id, invoice_line_id, field_path,
          source_type, source_record_id, identity_key
        ) VALUES (
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000005',
          'lines.00000000-0000-4000-8000-000000000005.description',
          'manual', 'manual:cross-invoice', 'cross-invoice'
        );
      `),
    );
  } finally {
    await database.close();
  }
});

test('invoice line foreign key helper waits for complete parent-key prerequisites', async () => {
  const database = new PGlite();
  try {
    await ensureInvoiceLineInvoiceForeignKey(pgliteSql(database));

    await database.exec(`
      CREATE TABLE invoice_lines (
        id uuid PRIMARY KEY,
        invoice_id uuid NOT NULL
      );
      CREATE TABLE invoice_field_provenance (
        invoice_id uuid NOT NULL,
        invoice_line_id uuid
      );
    `);
    await ensureInvoiceLineInvoiceForeignKey(pgliteSql(database));

    const constraint = await database.query(`
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'invoice_field_provenance'::regclass
        AND conname = 'invoice_field_provenance_invoice_line_invoice_fk'
    `);
    assert.equal(constraint.rows.length, 0);
  } finally {
    await database.close();
  }
});

test('invoice line parent key uses a concurrent migration-runner rollout', async () => {
  const [migration, migrationRunner, foreignKeyHelper] = await Promise.all([
    readFile(
      join(__dirname, 'migrations', '20260831131610_invoice_provenance_line_fk.sql'),
      'utf8',
    ),
    readFile(migrationRunnerPath, 'utf8'),
    readFile(join(__dirname, 'invoice-line-provenance-migration.ts'), 'utf8'),
  ]);

  assert.match(migration, /SELECT 1/);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX/);
  assert.doesNotMatch(migration, /ALTER TABLE "invoice_lines"/);
  assert.match(
    migrationRunner,
    /CREATE UNIQUE INDEX CONCURRENTLY "invoice_lines_id_invoice_id_unique"[\s\S]*?ON "invoice_lines" \("id", "invoice_id"\)/,
  );
  assert.match(migrationRunner, /import \{ ensureInvoiceLineInvoiceForeignKey \}/);
  assert.match(foreignKeyHelper, /export async function ensureInvoiceLineInvoiceForeignKey/);
  const preparePosition = migrationRunner.indexOf('await prepareInvoiceLineInvoiceIndex(client)');
  const migratePosition = migrationRunner.indexOf('await migrate(db');
  const postMigratePreparePosition = migrationRunner.lastIndexOf(
    'await prepareInvoiceLineInvoiceIndex(client)',
  );
  const foreignKeyPosition = migrationRunner.indexOf(
    'await ensureInvoiceLineInvoiceForeignKey(client)',
  );
  assert.ok(preparePosition >= 0, 'invoice line index preparation must run');
  assert.ok(
    preparePosition < migratePosition,
    'invoice line index preparation must run before transactional migrations',
  );
  assert.ok(
    postMigratePreparePosition > migratePosition,
    'invoice line index preparation must run after fresh-schema migrations too',
  );
  assert.ok(
    foreignKeyPosition > postMigratePreparePosition,
    'invoice line foreign key must run after the parent index is ready',
  );
});

test('migration verification scopes provenance checks to their table', async () => {
  const verifier = await readFile(verifierPath, 'utf8');

  assert.match(verifier, /table_name AS table/);
  assert.match(verifier, /\$\{row\.table\}\.\$\{row\.name\}/);
  assert.match(verifier, /pg_get_constraintdef/);
  assert.match(verifier, /expectedDefinition/);
  assert.match(verifier, /normalizeConstraintDefinition\(row\.definition\)/);
  assert.match(verifier, /normalizeConstraintDefinition\(row\.definition\)[\s\S]*===/);
  assert.doesNotMatch(verifier, /requiredDefinitionFragments/);
});

test('migration verification preserves case-sensitive provenance literals', async () => {
  const verifier = await readFile(verifierPath, 'utf8');

  assert.doesNotMatch(verifier, /return definition\.replace\([^\n]+\)\.toLowerCase\(\)/);
});
