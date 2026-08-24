import path from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { encryptCredential } from './credential-crypto';

const LEGACY_KEYS = [
  'qbo_access_token',
  'qbo_refresh_token',
  'qbo_realm_id',
  'qbo_token_expires_at',
  'qbo_connected',
  'xero_access_token',
  'xero_refresh_token',
  'xero_tenant_id',
  'xero_token_expires_at',
  'xero_connected',
] as const;

// Session-level lock namespace for every BetterSpend migration runner.
const MIGRATION_LOCK_NAMESPACE = 0x42535044;
const MIGRATION_LOCK_ID = 1;

type LegacyRow = {
  organization_id: string;
  key: string;
  value: string | null;
};

function expiryDate(value: string | undefined): Date | null {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds) : null;
}

async function migrateLegacyConnections(client: postgres.Sql): Promise<void> {
  await client`BEGIN`;
  try {
    const rows = await client<LegacyRow[]>`
      SELECT organization_id, key, value
      FROM system_settings
      WHERE key IN ${client(LEGACY_KEYS)}
      FOR UPDATE
    `;

    const byOrganization = new Map<string, Record<string, string>>();
    const migratedProviders = new Set<string>();
    for (const row of rows) {
      const settings = byOrganization.get(row.organization_id) ?? {};
      settings[row.key] = row.value ?? '';
      byOrganization.set(row.organization_id, settings);
    }

    for (const [organizationId, settings] of byOrganization) {
      for (const provider of ['qbo', 'xero'] as const) {
        const accessToken = settings[`${provider}_access_token`];
        const refreshToken = settings[`${provider}_refresh_token`];
        const hasLegacySettings = Object.keys(settings).some((key) =>
          key.startsWith(`${provider}_`),
        );
        if (!hasLegacySettings) continue;

        const realmKey = provider === 'qbo' ? 'qbo_realm_id' : 'xero_tenant_id';
        const resolvedRealmId = settings[realmKey];
        const realmId = resolvedRealmId || 'legacy-unresolved';
        const wasConnected = settings[`${provider}_connected`] === 'true';
        const status = !wasConnected
          ? 'revoked'
          : resolvedRealmId && (accessToken || refreshToken)
            ? 'active'
            : 'reconnect_required';
        const accessTokenEncrypted =
          status === 'active' && accessToken ? encryptCredential(accessToken) : null;
        const refreshTokenEncrypted =
          status === 'active' && refreshToken ? encryptCredential(refreshToken) : null;
        const accessExpiresAt = expiryDate(settings[`${provider}_token_expires_at`]);

        await client`
          INSERT INTO integration_connections (
            organization_id, provider, realm_id, access_token_enc, refresh_token_enc,
            access_expires_at, status, scopes
          ) VALUES (
            ${organizationId}, ${provider}, ${realmId}, ${accessTokenEncrypted}, ${refreshTokenEncrypted},
            ${accessExpiresAt}, ${status}, ${
              provider === 'qbo'
                ? 'com.intuit.quickbooks.accounting'
                : 'accounting.transactions accounting.contacts accounting.settings offline_access'
            }
          )
          ON CONFLICT (organization_id, provider) DO NOTHING
        `;
        migratedProviders.add(`${organizationId}:${provider}`);
      }
    }

    for (const row of rows) {
      const provider = row.key.startsWith('qbo_') ? 'qbo' : 'xero';
      if (!migratedProviders.has(`${row.organization_id}:${provider}`)) continue;
      await client`
        DELETE FROM system_settings
        WHERE organization_id = ${row.organization_id}
          AND key = ${row.key}
          AND value IS NOT DISTINCT FROM ${row.value}
      `;
    }

    if (rows.length > 0) {
      await client`
        UPDATE sync_records AS record
        SET connection_id = (
          SELECT connection.id
          FROM integration_connections AS connection
          WHERE connection.organization_id = record.organization_id
            AND connection.provider = record.provider
          ORDER BY connection.updated_at DESC
          LIMIT 1
        )
        WHERE record.connection_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM integration_connections AS connection
            WHERE connection.organization_id = record.organization_id
              AND connection.provider = record.provider
          )
      `;
    }
    await client`COMMIT`;
  } catch (error) {
    await client`ROLLBACK`;
    throw error;
  }
}

async function main(): Promise<void> {
  const client = postgres(process.env.DATABASE_URL!);
  let connection: postgres.ReservedSql | undefined;
  let migrationLockAcquired = false;
  try {
    // Advisory locks are session-scoped, so all migration work must use this connection.
    connection = await client.reserve();
    await connection`SELECT pg_advisory_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_ID})`;
    migrationLockAcquired = true;
    const migrationClient = Object.assign(connection, { options: client.options });
    const db = drizzle(migrationClient);
    await migrate(db, { migrationsFolder: path.resolve(__dirname, 'migrations') });
    await migrateLegacyConnections(migrationClient);
  } finally {
    if (migrationLockAcquired && connection) {
      await connection`SELECT pg_advisory_unlock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_ID})`;
    }
    connection?.release();
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
