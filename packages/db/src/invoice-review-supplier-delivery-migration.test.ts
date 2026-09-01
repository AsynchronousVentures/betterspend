import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationsDirectory = join(__dirname, 'migrations');
const migrationRunnerPath = join(__dirname, 'migrate.ts');
const migrationVerifierPath = join(__dirname, 'verify-migrations.ts');
const migrationSnapshotPath = join(migrationsDirectory, 'meta', '20260831232735_snapshot.json');
const invoiceReviewSchemaPath = join(__dirname, 'schema', 'invoice-reviews.ts');

async function supplierDeliveryMigrationPath(): Promise<string> {
  const migration = (await readdir(migrationsDirectory)).find((file) =>
    file.includes('invoice_review_supplier_delivery'),
  );
  if (!migration) throw new Error('invoice review supplier delivery migration is missing');
  return join(migrationsDirectory, migration);
}

test('supplier message parent key is prepared concurrently before transactional migrations', async () => {
  const [migration, migrationRunner] = await Promise.all([
    readFile(await supplierDeliveryMigrationPath(), 'utf8'),
    readFile(migrationRunnerPath, 'utf8'),
  ]);

  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "messages_id_organization_id_unique"/);
  assert.match(migrationRunner, /async function prepareInvoiceReviewMessageParentIndex/);
  assert.match(migrationRunner, /SET lock_timeout = '5s'/);
  assert.match(migrationRunner, /SET statement_timeout = '5min'/);
  assert.match(migrationRunner, /RESET statement_timeout/);
  assert.match(migrationRunner, /RESET lock_timeout/);
  assert.match(migrationRunner, /DROP INDEX CONCURRENTLY "messages_id_organization_id_unique"/);
  assert.match(
    migrationRunner,
    /CREATE UNIQUE INDEX CONCURRENTLY "messages_id_organization_id_unique"[\s\S]*?ON "messages" \("id", "organization_id"\)/,
  );
  assert.match(
    migrationRunner,
    /ARRAY\['id', 'organization_id'\]::text\[\]/,
    'the helper must reject a valid but noncanonical same-name index',
  );

  const preparePosition = migrationRunner.indexOf(
    'await prepareInvoiceReviewMessageParentIndex(client)',
  );
  const migratePosition = migrationRunner.indexOf('await migrate(db');
  assert.ok(preparePosition >= 0, 'message parent-key preparation must run');
  assert.ok(
    preparePosition < migratePosition,
    'message parent-key preparation must finish before transactional migrations',
  );
});

test('supplier delivery migration bounds transactional locks and statements', async () => {
  const migration = await readFile(await supplierDeliveryMigrationPath(), 'utf8');

  assert.match(
    migration,
    /^SET LOCAL lock_timeout = '5s';--> statement-breakpoint\nSET LOCAL statement_timeout = '30s';--> statement-breakpoint/,
  );
});

test('supplier delivery omits the unused recovery index from every schema contract', async () => {
  const [migration, migrationRunner, migrationVerifier, migrationSnapshot, invoiceReviewSchema] =
    await Promise.all([
      readFile(await supplierDeliveryMigrationPath(), 'utf8'),
      readFile(migrationRunnerPath, 'utf8'),
      readFile(migrationVerifierPath, 'utf8'),
      readFile(migrationSnapshotPath, 'utf8'),
      readFile(invoiceReviewSchemaPath, 'utf8'),
    ]);

  for (const source of [
    migration,
    migrationRunner,
    migrationVerifier,
    migrationSnapshot,
    invoiceReviewSchema,
  ]) {
    assert.doesNotMatch(source, /invoice_review_notification_intents_recovery_idx/);
  }
});

test('supplier delivery index repair rejects non-btree same-name indexes', async () => {
  const migrationRunner = await readFile(migrationRunnerPath, 'utf8');
  const btreeShapeChecks = migrationRunner.match(/index_method\.amname = 'btree'/g) ?? [];

  assert.equal(btreeShapeChecks.length, 1);
});

test('supplier delivery migration gives invoice review intents a valid delivery shape and recovery lease', async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE organizations (id uuid PRIMARY KEY);
      CREATE TABLE users (id uuid PRIMARY KEY, organization_id uuid NOT NULL, UNIQUE (id, organization_id));
      CREATE TABLE invoice_review_cases (id uuid PRIMARY KEY, organization_id uuid NOT NULL, UNIQUE (id, organization_id));
      CREATE TABLE messages (id uuid PRIMARY KEY, organization_id uuid NOT NULL, idempotency_key varchar(255));
      CREATE TABLE invoice_review_notification_intents (
        id uuid PRIMARY KEY,
        organization_id uuid NOT NULL,
        case_id uuid NOT NULL,
        recipient_user_id uuid NOT NULL,
        action varchar(50) NOT NULL,
        idempotency_key varchar(255) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        delivered_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO organizations VALUES ('00000000-0000-4000-8000-000000000002');
      INSERT INTO users VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002');
      INSERT INTO invoice_review_cases VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002');
      INSERT INTO invoice_review_notification_intents (
        id, organization_id, case_id, recipient_user_id, action, idempotency_key
      ) VALUES (
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000004',
        'claim', 'preexisting-internal-intent'
      );
    `);
    await database.exec(await readFile(await supplierDeliveryMigrationPath(), 'utf8'));

    const constraints = await database.query<{ name: string }>(`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conname IN (
        'invoice_review_notification_intents_kind_check',
        'invoice_review_notification_intents_delivery_shape_check',
        'invoice_review_notification_intents_message_org_fk'
      )
      ORDER BY conname
    `);
    assert.deepEqual(constraints.rows, [
      { name: 'invoice_review_notification_intents_delivery_shape_check' },
      { name: 'invoice_review_notification_intents_kind_check' },
      { name: 'invoice_review_notification_intents_message_org_fk' },
    ]);

    const columns = await database.query<{ name: string; nullable: string }>(`
      SELECT column_name AS name, is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_name = 'invoice_review_notification_intents'
        AND column_name IN ('intent_kind', 'recipient_user_id', 'message_id', 'lease_token', 'lease_expires_at')
      ORDER BY column_name
    `);
    assert.deepEqual(columns.rows, [
      { name: 'intent_kind', nullable: 'NO' },
      { name: 'lease_expires_at', nullable: 'YES' },
      { name: 'lease_token', nullable: 'YES' },
      { name: 'message_id', nullable: 'YES' },
      { name: 'recipient_user_id', nullable: 'YES' },
    ]);

    const migratedIntent = await database.query<{ kind: string }>(`
      SELECT intent_kind AS kind
      FROM invoice_review_notification_intents
      WHERE id = '00000000-0000-4000-8000-000000000001'
    `);
    assert.deepEqual(migratedIntent.rows, [{ kind: 'internal_notification' }]);

    await database.exec(`
      INSERT INTO invoice_review_notification_intents (
        id, organization_id, case_id, recipient_user_id, action, idempotency_key
      ) VALUES (
        '00000000-0000-4000-8000-000000000005',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000004',
        'claim', 'legacy-container-intent'
      )
    `);
    const legacyIntent = await database.query<{ kind: string }>(`
      SELECT intent_kind AS kind
      FROM invoice_review_notification_intents
      WHERE id = '00000000-0000-4000-8000-000000000005'
    `);
    assert.deepEqual(legacyIntent.rows, [{ kind: 'internal_notification' }]);

    for (const [id, kind, recipientUserId, messageId, key] of [
      [
        '00000000-0000-4000-8000-000000000006',
        'supplier_message_email',
        null,
        null,
        'invalid-supplier-shape',
      ],
      [
        '00000000-0000-4000-8000-000000000007',
        'internal_notification',
        null,
        null,
        'invalid-internal-missing-recipient',
      ],
      [
        '00000000-0000-4000-8000-000000000008',
        'internal_notification',
        '00000000-0000-4000-8000-000000000004',
        '00000000-0000-4000-8000-000000000005',
        'invalid-internal-message',
      ],
      [
        '00000000-0000-4000-8000-000000000009',
        'invalid_kind',
        '00000000-0000-4000-8000-000000000004',
        null,
        'invalid-kind',
      ],
    ] as const) {
      await assert.rejects(
        database.exec(`
        INSERT INTO invoice_review_notification_intents (
          id, organization_id, case_id, intent_kind, recipient_user_id, message_id, action, idempotency_key
        ) VALUES (
          '${id}',
          '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000003',
          '${kind}', ${recipientUserId ? `'${recipientUserId}'` : 'NULL'}, ${messageId ? `'${messageId}'` : 'NULL'},
          'request_supplier_info', '${key}'
        )
      `),
      );
    }

    const indexes = await database.query<{ name: string; definition: string }>(`
      SELECT indexname AS name, indexdef AS definition
      FROM pg_indexes
      WHERE indexname IN (
        'messages_id_organization_id_unique',
        'invoice_review_notification_intents_recovery_idx'
      )
      ORDER BY indexname
    `);
    assert.equal(indexes.rows.length, 1);
    assert.equal(indexes.rows[0]?.name, 'messages_id_organization_id_unique');
    assert.match(indexes.rows[0]?.definition ?? '', /UNIQUE.*\(id, organization_id\)/);
  } finally {
    await database.close();
  }
});

test('supplier delivery migration metadata retains the legacy intent kind default', async () => {
  const snapshot = JSON.parse(await readFile(migrationSnapshotPath, 'utf8')) as {
    tables: {
      'public.invoice_review_notification_intents': {
        columns: { intent_kind: { default?: string } };
      };
    };
  };

  assert.equal(
    snapshot.tables['public.invoice_review_notification_intents'].columns.intent_kind.default,
    "'internal_notification'",
  );
});

test('migration verification covers supplier delivery columns, constraints, parent index, and message ownership', async () => {
  const verifier = await readFile(migrationVerifierPath, 'utf8');

  for (const column of ['intent_kind', 'message_id', 'lease_token', 'lease_expires_at']) {
    assert.match(
      verifier,
      new RegExp(`table: 'invoice_review_notification_intents', column: '${column}'`),
    );
  }
  for (const constraint of [
    'invoice_review_notification_intents_kind_check',
    'invoice_review_notification_intents_delivery_shape_check',
  ]) {
    assert.match(verifier, new RegExp(`name: '${constraint}'`));
  }
  for (const constraint of [
    'invoice_review_notification_intents_organization_id_organizations_id_fk',
    'invoice_review_notification_intents_case_org_fk',
    'invoice_review_notification_intents_recipient_org_fk',
  ]) {
    assert.match(verifier, new RegExp(`name: '${constraint}'`));
  }
  assert.match(
    verifier,
    /name: 'messages_id_organization_id_unique',[\s\S]*?table: 'messages',[\s\S]*?columns: \['id', 'organization_id'\],[\s\S]*?unique: true/,
  );
  assert.match(
    verifier,
    /name: 'invoice_review_notification_intents_message_org_fk',[\s\S]*?child: 'invoice_review_notification_intents',[\s\S]*?parent: 'messages',[\s\S]*?childColumns: \['message_id', 'organization_id'\],[\s\S]*?parentColumns: \['id', 'organization_id'\]/,
  );
});
