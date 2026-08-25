import postgres from 'postgres';

const BACKFILL_BATCH_SIZE = 1_000;
const ISSUER_CHECK = 'auth_accounts_issuer_not_null_check';
const NORMALIZED_EMAIL_INDEX = 'users_email_normalized_unique';

type IndexState = {
  exists: boolean;
  isValid: boolean;
  isUnique: boolean;
  tableName: string | null;
  keyCount: number;
  keys: string[];
  hasPredicate: boolean;
};

async function indexState(client: postgres.Sql, name: string): Promise<IndexState> {
  const [state] = await client<IndexState[]>`
    SELECT
      index_class.oid IS NOT NULL AS "exists",
      COALESCE(index_data.indisvalid, false) AS "isValid",
      COALESCE(index_data.indisunique, false) AS "isUnique",
      table_class.relname AS "tableName",
      COALESCE(index_data.indnkeyatts, 0)::integer AS "keyCount",
      COALESCE(ARRAY(
        SELECT pg_get_indexdef(index_class.oid, position, true)
        FROM generate_series(1, index_data.indnkeyatts) AS position
        ORDER BY position
      ), ARRAY[]::text[]) AS keys,
      index_data.indpred IS NOT NULL AS "hasPredicate"
    FROM (VALUES (1)) AS singleton(value)
    LEFT JOIN pg_class AS index_class ON index_class.oid = to_regclass(${name})
    LEFT JOIN pg_index AS index_data ON index_data.indexrelid = index_class.oid
    LEFT JOIN pg_class AS table_class ON table_class.oid = index_data.indrelid
  `;
  return state;
}

async function ensureUserIdIndex(client: postgres.Sql): Promise<void> {
  const state = await indexState(client, 'auth_accounts_user_id_idx');
  if (state.exists && state.isValid) {
    if (
      state.isUnique ||
      state.tableName !== 'auth_accounts' ||
      state.keyCount !== 1 ||
      state.keys[0] !== 'user_id' ||
      state.hasPredicate
    ) {
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
    if (
      !state.isUnique ||
      state.tableName !== 'auth_accounts' ||
      state.keyCount !== 2 ||
      state.keys[0] !== 'issuer' ||
      state.keys[1] !== 'account_id' ||
      state.hasPredicate
    ) {
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

async function ensureNormalizedUserEmailIndex(client: postgres.Sql): Promise<void> {
  const [table] = await client<{ exists: boolean }[]>`
    SELECT to_regclass('users') IS NOT NULL AS "exists"
  `;
  if (!table.exists) return;

  const state = await indexState(client, NORMALIZED_EMAIL_INDEX);
  if (state.exists && state.isValid) {
    if (
      !state.isUnique ||
      state.tableName !== 'users' ||
      state.keyCount !== 1 ||
      state.keys[0] !== 'lower(email::text)' ||
      state.hasPredicate
    ) {
      throw new Error(`${NORMALIZED_EMAIL_INDEX} exists with an unexpected definition`);
    }
    return;
  }

  const [duplicate] = await client<{ email: string }[]>`
    SELECT lower(email) AS email
    FROM users
    GROUP BY lower(email)
    HAVING COUNT(*) > 1
    LIMIT 1
  `;
  if (duplicate) {
    throw new Error(
      `Duplicate normalized user email "${duplicate.email}" requires manual resolution before migration.`,
    );
  }

  if (state.exists) await client`DROP INDEX CONCURRENTLY ${client(NORMALIZED_EMAIL_INDEX)}`;
  await client`
    CREATE UNIQUE INDEX CONCURRENTLY ${client(NORMALIZED_EMAIL_INDEX)}
    ON users (lower(email))
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
  await ensureNormalizedUserEmailIndex(client);

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
