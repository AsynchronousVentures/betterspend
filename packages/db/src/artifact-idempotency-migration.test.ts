import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const migrationTag = '20260829095118_large_natasha_romanoff';
const migrationsDirectory = join(__dirname, 'migrations');

test('the delivery tenant upgrade is guarded and recorded in migration history', async () => {
  const [migration, journalText] = await Promise.all([
    readFile(join(migrationsDirectory, `${migrationTag}.sql`), 'utf8'),
    readFile(join(migrationsDirectory, 'meta', '_journal.json'), 'utf8'),
  ]);
  const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };

  assert.match(migration, /^SET LOCAL lock_timeout = '5s';/);
  assert.match(migration, /SET LOCAL statement_timeout = '30s';/);
  assert.match(migration, /UPDATE "artifact_notification_deliveries"/);
  assert.equal(journal.entries.at(-1)?.tag, migrationTag);
  assert.equal(journal.entries.at(-1)?.idx, 55);
});
