import postgres from 'postgres';

const BACKFILL_BATCH_SIZE = 1_000;
const ISSUER_CHECK = 'auth_accounts_issuer_not_null_check';

type IndexState = {
  exists: boolean;
  isValid: boolean;
  isUnique: boolean;
  definition: string | null;
};

async function indexState(client: postgres.Sql, name: string): Promise<IndexState> {
  const [state] = await client<IndexState[]>`
    SELECT
      index_class.oid IS NOT NULL AS "exists",
      COALESCE(index_data.indisvalid, false) AS "isValid",
      COALESCE(index_data.indisunique, false) AS "isUnique",
      pg_get_indexdef(index_class.oid) AS definition
    FROM (VALUES (1)) AS singleton(value)
    LEFT JOIN pg_class AS index_class ON index_class.oid = to_regclass(${name})
    LEFT JOIN pg_index AS index_data ON index_data.indexrelid = index_class.oid
  `;
  return state;
}

async function ensureUserIdIndex(client: postgres.Sql): Promise<void> {
  const state = await indexState(client, 'auth_accounts_user_id_idx');
  if (state.exists && state.isValid) {
    if (state.isUnique || !state.definition?.includes('(user_id)')) {
      throw new Error('auth_accounts_user_id_idx exists with an unexpected definition');
    }
    return;
  }
  if (state.exists) await client`DROP INDEX CONCURRENTLY ${client('auth_accounts_user_id_idx')}`;
  await client`
    CREATE INDEX CONCURRENTLY ${client('auth_accounts_user_id_idx')}
    ON auth_accounts (user_id)
  `;
}

async function ensureAccountIdentityIndex(client: postgres.Sql): Promise<void> {
  const state = await indexState(client, 'auth_accounts_issuer_account_id_unique');
  if (state.exists && state.isValid) {
    if (!state.isUnique || !state.definition?.includes('(issuer, account_id)')) {
      throw new Error(
        'auth_accounts_issuer_account_id_unique exists with an unexpected definition',
      );
    }
    return;
  }
  if (state.exists) {
    await client`DROP INDEX CONCURRENTLY ${client('auth_accounts_issuer_account_id_unique')}`;
  }
  await client`
    CREATE UNIQUE INDEX CONCURRENTLY ${client('auth_accounts_issuer_account_id_unique')}
    ON auth_accounts (issuer, account_id)
  `;
}

async function addIssuerWriteFence(client: postgres.Sql): Promise<void> {
  const [constraint] = await client<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'auth_accounts'::regclass
        AND conname = ${ISSUER_CHECK}
    ) AS "exists"
  `;
  if (!constraint.exists) {
    await client`
      ALTER TABLE auth_accounts
      ADD CONSTRAINT ${client(ISSUER_CHECK)} CHECK (issuer IS NOT NULL) NOT VALID
    `;
  }
}

async function backfillAccounts(client: postgres.Sql): Promise<void> {
  while (true) {
    const rows = await client<{ id: string }[]>`
      WITH batch AS (
        SELECT id
        FROM auth_accounts
        WHERE (provider_id = 'credential' AND issuer IS NULL)
          OR (access_token_expires_at IS NULL AND expires_at IS NOT NULL)
        ORDER BY id
        LIMIT ${BACKFILL_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE auth_accounts AS account
      SET
        issuer = COALESCE(account.issuer, 'local:credential'),
        access_token_expires_at = COALESCE(
          account.access_token_expires_at,
          account.expires_at
        )
      FROM batch
      WHERE account.id = batch.id
      RETURNING account.id
    `;
    if (rows.length < BACKFILL_BATCH_SIZE) return;
  }
}

/** Completes the online Better Auth 1.7 account rollout after additive Drizzle migrations. */
export async function migrateBetterAuthAccounts(client: postgres.Sql): Promise<void> {
  const [tableState] = await client<
    Array<{ exists: boolean; hasIssuer: boolean; issuerNullable: boolean }>
  >`
    SELECT
      to_regclass('auth_accounts') IS NOT NULL AS "exists",
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'auth_accounts'
          AND column_name = 'issuer'
      ) AS "hasIssuer",
      COALESCE((
        SELECT is_nullable = 'YES'
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'auth_accounts'
          AND column_name = 'issuer'
      ), false) AS "issuerNullable"
  `;
  if (!tableState.exists || !tableState.hasIssuer) return;
  if (!tableState.issuerNullable) {
    await ensureUserIdIndex(client);
    await ensureAccountIdentityIndex(client);
    return;
  }

  const [unmappedAccount] = await client<{ providerId: string }[]>`
    SELECT provider_id AS "providerId"
    FROM auth_accounts
    WHERE issuer IS NULL AND provider_id <> 'credential'
    LIMIT 1
  `;
  if (unmappedAccount) {
    throw new Error(
      `Cannot backfill auth account issuer for provider "${unmappedAccount.providerId}". Add an explicit issuer mapping and rerun migrations.`,
    );
  }

  const [mismatchedCredential] = await client<{ issuer: string }[]>`
    SELECT issuer
    FROM auth_accounts
    WHERE provider_id = 'credential'
      AND issuer IS NOT NULL
      AND issuer <> 'local:credential'
    LIMIT 1
  `;
  if (mismatchedCredential) {
    throw new Error(
      `Credential account has unexpected issuer "${mismatchedCredential.issuer}". Resolve it and rerun migrations.`,
    );
  }

  const [collision] = await client<{ issuer: string; accountId: string }[]>`
    SELECT
      COALESCE(issuer, 'local:credential') AS issuer,
      account_id AS "accountId"
    FROM auth_accounts
    GROUP BY COALESCE(issuer, 'local:credential'), account_id
    HAVING COUNT(*) > 1
    LIMIT 1
  `;
  if (collision) {
    throw new Error(
      `Duplicate auth identity (${collision.issuer}, ${collision.accountId}) requires manual resolution before migration.`,
    );
  }

  await addIssuerWriteFence(client);
  await backfillAccounts(client);
  await client`ALTER TABLE auth_accounts VALIDATE CONSTRAINT ${client(ISSUER_CHECK)}`;
  await ensureUserIdIndex(client);
  await ensureAccountIdentityIndex(client);
  await client`ALTER TABLE auth_accounts ALTER COLUMN issuer SET NOT NULL`;
  await client`ALTER TABLE auth_accounts DROP CONSTRAINT ${client(ISSUER_CHECK)}`;
}
