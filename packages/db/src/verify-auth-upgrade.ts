import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { migrateBetterAuthAccounts } from './better-auth-migration';

const migrationPath = path.resolve(__dirname, 'migrations/20260825042914_amazing_hydra.sql');

async function applyAuthMigration(client: postgres.Sql): Promise<void> {
  const migration = await readFile(migrationPath, 'utf8');
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.unsafe(statement);
  }
}

async function withLegacySchema(
  client: postgres.Sql,
  test: (schemaName: string) => Promise<void>,
): Promise<void> {
  const schemaName = `auth_upgrade_${randomUUID().replaceAll('-', '')}`;
  await client`CREATE SCHEMA ${client(schemaName)}`;
  try {
    await client`SELECT set_config('search_path', ${schemaName}, false)`;
    await client.unsafe(`
      CREATE TABLE auth_accounts (
        id text PRIMARY KEY NOT NULL,
        user_id uuid NOT NULL,
        account_id text NOT NULL,
        provider_id text NOT NULL,
        access_token text,
        refresh_token text,
        id_token text,
        expires_at timestamp with time zone,
        password text,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
      )
    `);
    await test(schemaName);
  } finally {
    await client`SELECT set_config('search_path', 'public', false)`;
    await client`DROP SCHEMA ${client(schemaName)} CASCADE`;
  }
}

async function verifyCredentialBackfill(client: postgres.Sql): Promise<void> {
  await withLegacySchema(client, async (schemaName) => {
    const expiry = new Date('2026-01-02T03:04:05.000Z');
    const userId = randomUUID();
    await client`
      INSERT INTO auth_accounts (
        id, user_id, account_id, provider_id, expires_at, password
      ) VALUES (
        'legacy-account', ${userId}, ${userId}, 'credential', ${expiry}, 'legacy-hash'
      )
    `;
    await client.unsafe(`
      INSERT INTO auth_accounts (
        id, user_id, account_id, provider_id, expires_at, password
      )
      SELECT
        'bulk-' || item,
        ('00000000-0000-0000-0000-' || lpad(item::text, 12, '0'))::uuid,
        'bulk-' || item,
        'credential',
        '2026-01-02T03:04:05.000Z',
        'legacy-hash'
      FROM generate_series(1, 1001) AS item
    `);

    await applyAuthMigration(client);
    await migrateBetterAuthAccounts(client);

    const [account] = await client<
      Array<{
        issuer: string;
        accountId: string;
        accessTokenExpiresAt: Date;
        legacyExpiresAt: Date;
      }>
    >`
      SELECT
        issuer,
        account_id AS "accountId",
        access_token_expires_at AS "accessTokenExpiresAt",
        expires_at AS "legacyExpiresAt"
      FROM auth_accounts
      WHERE id = 'legacy-account'
    `;
    assert.equal(account?.issuer, 'local:credential');
    assert.equal(account?.accountId, userId);
    assert.equal(account?.accessTokenExpiresAt.toISOString(), expiry.toISOString());
    assert.equal(account?.legacyExpiresAt.toISOString(), expiry.toISOString());

    const [remaining] = await client<{ count: number }[]>`
      SELECT COUNT(*)::integer AS count
      FROM auth_accounts
      WHERE issuer IS NULL
        OR access_token_expires_at IS DISTINCT FROM expires_at
    `;
    assert.equal(remaining?.count, 0);

    const [issuerColumn] = await client<{ nullable: string }[]>`
      SELECT is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
        AND table_name = 'auth_accounts'
        AND column_name = 'issuer'
    `;
    assert.equal(issuerColumn?.nullable, 'NO');

    const indexes = await client<Array<{ name: string }>>`
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = ${schemaName}
        AND indexname IN (
          'auth_accounts_user_id_idx',
          'auth_accounts_issuer_account_id_unique'
        )
    `;
    assert.deepEqual(indexes.map((index) => index.name).sort(), [
      'auth_accounts_issuer_account_id_unique',
      'auth_accounts_user_id_idx',
    ]);
  });
}

async function verifyUnknownProviderRefusal(client: postgres.Sql): Promise<void> {
  await withLegacySchema(client, async () => {
    await client`
      INSERT INTO auth_accounts (id, user_id, account_id, provider_id)
      VALUES ('unknown-account', ${randomUUID()}, 'subject', 'unknown-provider')
    `;
    await applyAuthMigration(client);
    await assert.rejects(
      migrateBetterAuthAccounts(client),
      /Add an explicit issuer mapping and rerun migrations/,
    );
  });
}

async function verifyCollisionRefusal(client: postgres.Sql): Promise<void> {
  await withLegacySchema(client, async () => {
    await client`
      INSERT INTO auth_accounts (id, user_id, account_id, provider_id)
      VALUES
        ('duplicate-one', ${randomUUID()}, 'duplicate-subject', 'credential'),
        ('duplicate-two', ${randomUUID()}, 'duplicate-subject', 'credential')
    `;
    await applyAuthMigration(client);
    await assert.rejects(
      migrateBetterAuthAccounts(client),
      /requires manual resolution before migration/,
    );
  });
}

async function main(): Promise<void> {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await verifyCredentialBackfill(client);
    await verifyUnknownProviderRefusal(client);
    await verifyCollisionRefusal(client);
    console.log('Better Auth upgrade verification passed.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
