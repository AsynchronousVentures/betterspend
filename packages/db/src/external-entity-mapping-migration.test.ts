import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationTag = '20260830164343_qbo_mapping_export_safety';
const migrationPath = join(__dirname, 'migrations', `${migrationTag}.sql`);
const migrationRunnerPath = join(__dirname, 'migrate.ts');

test('adds local keys without rewriting legacy mappings or requiring cleanup', async () => {
  const [migration, migrationRunner] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(migrationRunnerPath, 'utf8'),
  ]);
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE gl_mappings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL,
        gl_account varchar(100) NOT NULL,
        gl_account_name varchar(255),
        target_system varchar(20) NOT NULL,
        external_account_code varchar(100) NOT NULL,
        external_account_name varchar(255),
        is_active boolean NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE external_entity_mappings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL,
        connection_id uuid,
        realm_id varchar(255) NOT NULL DEFAULT 'realm-1',
        provider varchar(20) NOT NULL,
        external_entity varchar(40) NOT NULL,
        external_id varchar(255) NOT NULL,
        display_name varchar(255),
        sync_token varchar(100),
        local_entity varchar(40) NOT NULL,
        local_id uuid,
        direction varchar(10) NOT NULL DEFAULT 'inbound',
        auto_created boolean NOT NULL DEFAULT false,
        is_active boolean NOT NULL DEFAULT true,
        is_deleted boolean NOT NULL DEFAULT false,
        merged_into_external_id varchar(255),
        payload jsonb,
        synced_at timestamptz,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      INSERT INTO external_entity_mappings (
        id, organization_id, provider, external_entity, external_id,
        local_entity, local_id, direction, created_at, updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000100',
        '00000000-0000-0000-0000-000000000010',
        'qbo', 'Account', 'qbo-account-1', 'gl_account',
        '00000000-0000-0000-0000-000000000101', 'inbound',
        timestamptz '2026-08-03T00:00:00Z', timestamptz '2026-08-03T00:00:00Z'
      ), (
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-000000000010',
        'qbo', 'Account', 'qbo-account-duplicate', 'gl_account',
        '00000000-0000-0000-0000-000000000101', 'inbound',
        timestamptz '2026-08-02T00:00:00Z', timestamptz '2026-08-02T00:00:00Z'
      ), (
        '00000000-0000-0000-0000-000000000200',
        '00000000-0000-0000-0000-000000000010',
        'qbo', 'Account', 'qbo-account-tie-a', 'gl_account',
        '00000000-0000-0000-0000-000000000102', 'inbound',
        timestamptz '2026-08-04T00:00:00Z', timestamptz '2026-08-04T00:00:00Z'
      ), (
        '00000000-0000-0000-0000-000000000201',
        '00000000-0000-0000-0000-000000000010',
        'qbo', 'Account', 'qbo-account-tie-b', 'gl_account',
        '00000000-0000-0000-0000-000000000102', 'inbound',
        timestamptz '2026-08-04T00:00:00Z', timestamptz '2026-08-04T00:00:00Z'
      );
      INSERT INTO gl_mappings (
        id, organization_id, gl_account, target_system, external_account_code,
        external_account_name, is_active, created_at, updated_at
      ) VALUES
        ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '6100', 'qbo', 'legacy-code', 'Travel', true, now(), now()),
        ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010', '6200', 'xero', '200', 'Travel', true, now(), now());
    `);

    assert.match(migration, /ADD COLUMN "local_key" varchar\(255\)/);
    assert.doesNotMatch(migration, /ALTER COLUMN/);
    assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE)\b/);
    assert.doesNotMatch(migration, /CREATE (?:UNIQUE )?INDEX/);
    assert.match(migration, /NOT VALID/);
    assert.match(migrationRunner, /async function prepareExternalEntityMappingsLocalKeyIndex/);
    assert.match(migrationRunner, /index_class\.oid IS NOT NULL AS "indexExists"/);
    assert.match(migrationRunner, /index_state\.indisvalid/);
    assert.match(migrationRunner, /indexIsValid && state\.indexIsCanonical/);
    assert.match(migrationRunner, /DROP INDEX CONCURRENTLY/);
    assert.match(migrationRunner, /SET lock_timeout = '5s'/);
    assert.match(migrationRunner, /SET statement_timeout = '5min'/);
    assert.match(
      migrationRunner,
      /CREATE INDEX CONCURRENTLY.*?external_entity_mappings.*?local_key/s,
    );
    assert.match(
      migrationRunner,
      /ARRAY\[.*?'organization_id'.*?'provider'.*?'direction'.*?'external_entity'.*?'local_entity'.*?'local_key'.*?\]::text\[\]/s,
    );
    assert.match(
      migrationRunner,
      /await migrate\(db,.*?prepareExternalEntityMappingsLocalKeyIndex\(client\)/s,
    );

    await database.exec(migration);

    const columns = await database.query<{
      columnName: string;
      dataType: string;
      isNullable: string;
    }>(`
      SELECT column_name AS "columnName", data_type AS "dataType", is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_name = 'external_entity_mappings'
        AND column_name IN ('external_id', 'local_id', 'local_key', 'is_default')
      ORDER BY column_name
    `);
    assert.deepEqual(columns.rows, [
      { columnName: 'external_id', dataType: 'character varying', isNullable: 'NO' },
      { columnName: 'is_default', dataType: 'boolean', isNullable: 'NO' },
      { columnName: 'local_id', dataType: 'uuid', isNullable: 'YES' },
      { columnName: 'local_key', dataType: 'character varying', isNullable: 'YES' },
    ]);

    const existing = await database.query<{
      id: string;
      externalId: string | null;
      localId: string | null;
      localKey: string | null;
      isDefault: boolean;
    }>(`
      SELECT
        id,
        external_id AS "externalId",
        local_id AS "localId",
        local_key AS "localKey",
        is_default AS "isDefault"
      FROM external_entity_mappings
      ORDER BY id
    `);
    assert.deepEqual(existing.rows, [
      {
        id: '00000000-0000-0000-0000-000000000100',
        externalId: 'qbo-account-1',
        localId: '00000000-0000-0000-0000-000000000101',
        localKey: null,
        isDefault: false,
      },
      {
        id: '00000000-0000-0000-0000-000000000101',
        externalId: 'qbo-account-duplicate',
        localId: '00000000-0000-0000-0000-000000000101',
        localKey: null,
        isDefault: false,
      },
      {
        id: '00000000-0000-0000-0000-000000000200',
        externalId: 'qbo-account-tie-a',
        localId: '00000000-0000-0000-0000-000000000102',
        localKey: null,
        isDefault: false,
      },
      {
        id: '00000000-0000-0000-0000-000000000201',
        externalId: 'qbo-account-tie-b',
        localId: '00000000-0000-0000-0000-000000000102',
        localKey: null,
        isDefault: false,
      },
    ]);

    const legacyRows = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM gl_mappings',
    );
    assert.equal(legacyRows.rows[0]?.count, '2');

    await database.exec(`
      INSERT INTO external_entity_mappings (
        organization_id, provider, external_entity, external_id, local_entity,
        local_id, local_key, direction, created_at, updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000010', 'qbo', 'Account', 'qbo-account-code',
        'gl_account', null, '6100', 'inbound', now(), now()
      );
    `);

    const glCode = await database.query<{ localId: string | null; localKey: string | null }>(`
      SELECT local_id AS "localId", local_key AS "localKey"
      FROM external_entity_mappings
      WHERE external_id = 'qbo-account-code'
    `);
    assert.deepEqual(glCode.rows, [{ localId: null, localKey: '6100' }]);

    await assert.rejects(
      database.exec(`
        UPDATE external_entity_mappings
        SET local_key = '6100'
        WHERE id = '00000000-0000-0000-0000-000000000100'
      `),
    );
  } finally {
    await database.close();
  }
});
