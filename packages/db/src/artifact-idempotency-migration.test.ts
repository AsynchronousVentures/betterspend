import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const migrationTag = '20260829155943_artifact_idempotency_after_workflow_merge';
const migrationsDirectory = join(__dirname, 'migrations');
const migrationRunner = join(__dirname, 'migrate.ts');

test('artifact idempotency migration is recorded in migration history', async () => {
  const [migration, journalText] = await Promise.all([
    readFile(join(migrationsDirectory, `${migrationTag}.sql`), 'utf8'),
    readFile(join(migrationsDirectory, 'meta', '_journal.json'), 'utf8'),
  ]);
  const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };

  assert.match(migration, /^SET LOCAL lock_timeout = '5s';/);
  assert.match(migration, /SET LOCAL statement_timeout = '30s';/);
  assert.match(migration, /CREATE TABLE "artifact_operations"/);
  assert.match(migration, /ADD COLUMN "idempotency_key" varchar\(255\)/);
  assert.match(
    migration,
    /artifact_operations_artifact_kind_check.*'requisition'.*'rfq'.*'message'/s,
  );
  const migrationEntry = journal.entries.find(({ tag }) => tag === migrationTag);
  assert.ok(migrationEntry, `migration ${migrationTag} is not recorded in the journal`);

  const parentIndexPosition = migration.indexOf(
    'CREATE UNIQUE INDEX "artifact_operations_id_organization_id_unique"',
  );
  const deliveryForeignKeyPosition = migration.indexOf(
    'ADD CONSTRAINT "artifact_notification_deliveries_operation_org_fk"',
  );
  assert.ok(parentIndexPosition >= 0, 'parent composite index must exist');
  assert.ok(deliveryForeignKeyPosition >= 0, 'delivery composite foreign key must exist');
  assert.ok(
    parentIndexPosition < deliveryForeignKeyPosition,
    'parent composite index must be created before the delivery foreign key',
  );
});

test('artifact index inspection compares catalog names as text', async () => {
  const source = await readFile(migrationRunner, 'utf8');

  assert.match(
    source,
    /array_agg\(attribute\.attname::text ORDER BY indexed\.ordinality\).*?= ARRAY\['organization_id', 'idempotency_key'\]::text\[\]/s,
  );
});
