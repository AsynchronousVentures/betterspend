import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

const migrationTag = '20260831054304_invoice_review_signals';
const verifierPath = join(__dirname, 'verify-migrations.ts');
const migrationRunnerPath = join(__dirname, 'migrate.ts');

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
    await database.exec(`
      ALTER TABLE invoice_field_provenance
        DROP CONSTRAINT invoice_field_provenance_invoice_line_id_invoice_lines_id_fk;
      ALTER TABLE invoice_field_provenance
        ADD CONSTRAINT invoice_field_provenance_invoice_line_invoice_fk
        FOREIGN KEY (invoice_line_id, invoice_id)
        REFERENCES invoice_lines (id, invoice_id);
    `);

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

test('invoice line parent key uses a concurrent migration-runner rollout', async () => {
  const [migration, migrationRunner] = await Promise.all([
    readFile(
      join(__dirname, 'migrations', '20260831131610_invoice_provenance_line_fk.sql'),
      'utf8',
    ),
    readFile(migrationRunnerPath, 'utf8'),
  ]);

  assert.match(migration, /SELECT 1/);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX/);
  assert.doesNotMatch(migration, /ALTER TABLE "invoice_lines"/);
  assert.match(
    migrationRunner,
    /CREATE UNIQUE INDEX CONCURRENTLY "invoice_lines_id_invoice_id_unique"[\s\S]*?ON "invoice_lines" \("id", "invoice_id"\)/,
  );
  assert.match(migrationRunner, /async function ensureInvoiceLineInvoiceForeignKey/);
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
});
