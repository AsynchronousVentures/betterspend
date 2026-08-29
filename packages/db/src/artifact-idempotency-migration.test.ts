import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const migrationTag = '20260829095118_large_natasha_romanoff';
const artifactKindMigrationTag = '20260829102117_broad_magma';
const migrationsDirectory = join(__dirname, 'migrations');

test('artifact idempotency migrations are guarded and recorded in migration history', async () => {
  const [migration, artifactKindMigration, journalText] = await Promise.all([
    readFile(join(migrationsDirectory, `${migrationTag}.sql`), 'utf8'),
    readFile(join(migrationsDirectory, `${artifactKindMigrationTag}.sql`), 'utf8'),
    readFile(join(migrationsDirectory, 'meta', '_journal.json'), 'utf8'),
  ]);
  const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };

  assert.match(migration, /^SET LOCAL lock_timeout = '5s';/);
  assert.match(migration, /SET LOCAL statement_timeout = '30s';/);
  assert.match(migration, /UPDATE "artifact_notification_deliveries"/);
  assert.match(
    artifactKindMigration,
    /ADD CONSTRAINT "artifact_operations_artifact_kind_check" CHECK .*'requisition'.*'rfq'.*'message'/s,
  );
  const migrationEntry = journal.entries.find(({ tag }) => tag === migrationTag);
  assert.ok(migrationEntry, `migration ${migrationTag} is not recorded in the journal`);
  assert.equal(migrationEntry.idx, 55);
  const artifactKindMigrationEntry = journal.entries.find(
    ({ tag }) => tag === artifactKindMigrationTag,
  );
  assert.ok(
    artifactKindMigrationEntry,
    `migration ${artifactKindMigrationTag} is not recorded in the journal`,
  );
  assert.equal(artifactKindMigrationEntry.idx, 56);
});
