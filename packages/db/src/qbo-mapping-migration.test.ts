import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const migrationTag = '20260830160215_qbo_mapping_local_identity_unique';
const migrationsDirectory = join(__dirname, 'migrations');
const migrationRunner = join(__dirname, 'migrate.ts');

test('QBO linked-local identity index is prepared after the migration transaction', async () => {
  const [migration, source] = await Promise.all([
    readFile(join(migrationsDirectory, `${migrationTag}.sql`), 'utf8'),
    readFile(migrationRunner, 'utf8'),
  ]);

  assert.match(migration, /^-- migrate\.ts builds .* concurrently/);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX/i);
  assert.match(source, /async function prepareLinkedLocalMappingIndex/);
  assert.match(source, /SET lock_timeout = '5s'/);
  assert.match(source, /SET statement_timeout = '5min'/);
  assert.match(source, /RESET statement_timeout/);
  assert.match(source, /RESET lock_timeout/);
  assert.match(
    source,
    /DROP INDEX CONCURRENTLY "external_entity_mappings_linked_local_identity_unique"/,
  );
  assert.match(
    source,
    /CREATE UNIQUE INDEX CONCURRENTLY "external_entity_mappings_linked_local_identity_unique"[\s\S]*?"organization_id"[\s\S]*?"provider"[\s\S]*?"direction"[\s\S]*?"local_entity"[\s\S]*?"local_id"[\s\S]*?WHERE "external_entity_mappings"\."local_id" is not null[\s\S]*?"external_entity_mappings"\."is_active" = true[\s\S]*?"external_entity_mappings"\."is_deleted" = false/,
  );
  assert.match(
    source,
    /GROUP BY "organization_id", "provider", "direction", "local_entity", "local_id"\s+HAVING count\(\*\) > 1/,
  );

  const migrationCall = source.indexOf(
    "await migrate(db, { migrationsFolder: path.resolve(__dirname, 'migrations') });",
  );
  const prepareCall = source.indexOf('await prepareLinkedLocalMappingIndex(client);');
  assert.ok(migrationCall >= 0, 'migration call must exist');
  assert.ok(prepareCall > migrationCall, 'index preparation must run after migrations commit');
});
