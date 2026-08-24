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

type IndexState = {
  vendorsTableExists: boolean;
  indexExists: boolean;
  indexIsValid: boolean;
};

type LegalEntityIndexState = {
  legalEntitiesTableExists: boolean;
  indexExists: boolean;
  indexIsValid: boolean;
};

/** Build the parent key without blocking writes before transactional migrations add its FK. */
async function prepareVendorOrganizationIndex(client: postgres.Sql): Promise<void> {
  const [state] = await client<IndexState[]>`
    SELECT
      to_regclass('public.vendors') IS NOT NULL AS "vendorsTableExists",
      to_regclass('public.vendors_id_organization_id_unique') IS NOT NULL AS "indexExists",
      COALESCE(index_state.indisvalid, false) AS "indexIsValid"
    FROM (VALUES (1)) AS singleton(value)
    LEFT JOIN pg_class AS index_class
      ON index_class.oid = to_regclass('public.vendors_id_organization_id_unique')
    LEFT JOIN pg_index AS index_state ON index_state.indexrelid = index_class.oid
  `;

  if (!state?.vendorsTableExists || state.indexIsValid) return;

  if (state.indexExists) {
    await client`DROP INDEX CONCURRENTLY "vendors_id_organization_id_unique"`;
  }
  await client`
    CREATE UNIQUE INDEX CONCURRENTLY "vendors_id_organization_id_unique"
    ON "vendors" ("id", "organization_id")
  `;
}

/** Build the legal-entity parent key without blocking writes before the workflow migration. */
async function prepareLegalEntityOrganizationIndex(client: postgres.Sql): Promise<void> {
  const [state] = await client<LegalEntityIndexState[]>`
    SELECT
      to_regclass('public.legal_entities') IS NOT NULL AS "legalEntitiesTableExists",
      to_regclass('public.legal_entities_id_organization_id_unique') IS NOT NULL AS "indexExists",
      COALESCE(index_state.indisvalid, false) AS "indexIsValid"
    FROM (VALUES (1)) AS singleton(value)
    LEFT JOIN pg_class AS index_class
      ON index_class.oid = to_regclass('public.legal_entities_id_organization_id_unique')
    LEFT JOIN pg_index AS index_state ON index_state.indexrelid = index_class.oid
  `;

  if (!state?.legalEntitiesTableExists || state.indexIsValid) return;

  if (state.indexExists) {
    await client`DROP INDEX CONCURRENTLY "legal_entities_id_organization_id_unique"`;
  }
  await client`
    CREATE UNIQUE INDEX CONCURRENTLY "legal_entities_id_organization_id_unique"
    ON "legal_entities" ("id", "organization_id")
  `;
}

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
          ON CONFLICT (organization_id, provider) DO NOTHING
        `;
        migratedProviders.add(`${organizationId}:${provider}`);
      }
    }

    for (const row of rows) {
      const provider = row.key.startsWith('qbo_') ? 'qbo' : 'xero';
      if (!migratedProviders.has(`${row.organization_id}:${provider}`)) continue;
      await transaction`
        DELETE FROM system_settings
        WHERE organization_id = ${row.organization_id}
          AND key = ${row.key}
          AND value IS NOT DISTINCT FROM ${row.value}
      `;
    }

    if (rows.length > 0) {
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
  // Advisory locks are session-scoped, so the migration runner uses one database session.
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  let migrationLockAcquired = false;
  try {
    await client`SELECT pg_advisory_lock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_ID})`;
    migrationLockAcquired = true;
    await prepareVendorOrganizationIndex(client);
    await prepareLegalEntityOrganizationIndex(client);
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: path.resolve(__dirname, 'migrations') });
    await migrateLegacyConnections(client);
  } finally {
    try {
      if (migrationLockAcquired) {
        await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK_NAMESPACE}, ${MIGRATION_LOCK_ID})`;
      }
    } finally {
      await client.end();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
