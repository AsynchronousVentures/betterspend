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
  await client.begin(async (transaction) => {
    const rows = await transaction<LegacyRow[]>`
      SELECT organization_id, key, value
      FROM system_settings
      WHERE key IN ${transaction(LEGACY_KEYS)}
      FOR UPDATE
    `;

    const byOrganization = new Map<string, Record<string, string>>();
    for (const row of rows) {
      const settings = byOrganization.get(row.organization_id) ?? {};
      settings[row.key] = row.value ?? '';
      byOrganization.set(row.organization_id, settings);
    }

    for (const [organizationId, settings] of byOrganization) {
      for (const provider of ['qbo', 'xero'] as const) {
        const accessToken = settings[`${provider}_access_token`];
        const refreshToken = settings[`${provider}_refresh_token`];
        if (!accessToken && !refreshToken) continue;

        const realmKey = provider === 'qbo' ? 'qbo_realm_id' : 'xero_tenant_id';
        const realmId = settings[realmKey] || 'legacy-unresolved';
        const accessTokenEncrypted = accessToken ? encryptCredential(accessToken) : null;
        const refreshTokenEncrypted = refreshToken ? encryptCredential(refreshToken) : null;
        const accessExpiresAt = expiryDate(settings[`${provider}_token_expires_at`]);
        const status = settings[`${provider}_connected`] === 'true' ? 'active' : 'revoked';

        await transaction`
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
          ON CONFLICT (organization_id, provider, realm_id) DO UPDATE SET
            access_token_enc = EXCLUDED.access_token_enc,
            refresh_token_enc = EXCLUDED.refresh_token_enc,
            access_expires_at = EXCLUDED.access_expires_at,
            status = EXCLUDED.status,
            updated_at = now()
        `;
      }
    }

    if (rows.length > 0) {
      await transaction`
        DELETE FROM system_settings
        WHERE key IN ${transaction(LEGACY_KEYS)}
      `;
      await transaction`
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
  });
}

async function main(): Promise<void> {
  const client = postgres(process.env.DATABASE_URL!);
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: path.resolve(__dirname, 'migrations') });
    await migrateLegacyConnections(client);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
