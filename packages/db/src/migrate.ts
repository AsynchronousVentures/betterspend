import path from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { encryptCredential } from './credential-crypto';
import { migrateBetterAuthAccounts } from './better-auth-migration';

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

type BudgetEventConstraintState = {
  tableExists: boolean;
  canonicalReady: boolean;
  replacementExists: boolean;
  replacementValidated: boolean;
};

const BUDGET_EVENT_TYPES = [
  'requisition_reserved',
  'requisition_released',
  'purchase_order_committed',
  'purchase_order_reduced',
  'purchase_order_released',
  'invoice_expended',
  'invoice_reopened',
  'legacy_commitment_backfill',
  'legacy_reservation_backfill',
] as const;

type EmailIntakeIndexState = {
  emailIntakeItemsTableExists: boolean;
  indexExists: boolean;
  indexIsValid: boolean;
};

type UserRoleAssignmentIndexState = {
  userRolesTableExists: boolean;
  indexExists: boolean;
  indexIsValid: boolean;
};

type CustomRoleOrganizationIndexState = {
  customRolesTableExists: boolean;
  indexExists: boolean;
  indexIsValid: boolean;
};

type ArtifactOwnerIdempotencyIndexState = {
  tableExists: boolean;
  columnsExist: boolean;
  indexExists: boolean;
  indexIsValid: boolean;
  indexIsCanonical: boolean;
};

type UserRoleOrganizationContractState = {
  columnIsNotNull: boolean;
  userOrganizationForeignKeyExists: boolean;
  customRoleOrganizationForeignKeyExists: boolean;
};

const USER_ROLE_BACKFILL_BATCH_SIZE = 500;

const ARTIFACT_OWNER_IDEMPOTENCY_INDEXES = [
  { table: 'requisitions', index: 'requisitions_org_idempotency_key_unique' },
  { table: 'rfq_requests', index: 'rfq_requests_org_idempotency_key_unique' },
  { table: 'messages', index: 'messages_org_idempotency_key_unique' },
  { table: 'notifications', index: 'notifications_org_idempotency_key_unique' },
] as const;

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

/** Validate the expanded event-type constraint without holding an exclusive lock during the scan. */
async function prepareBudgetEventTypeConstraint(client: postgres.Sql): Promise<void> {
  const [state] = await client<BudgetEventConstraintState[]>`
    SELECT
      to_regclass('public.budget_commitment_events') IS NOT NULL AS "tableExists",
      EXISTS (
        SELECT 1
        FROM pg_constraint AS canonical
        WHERE canonical.conrelid = to_regclass('public.budget_commitment_events')
          AND canonical.conname = 'budget_commitment_events_event_type_check'
          AND canonical.convalidated
          AND pg_get_constraintdef(canonical.oid) LIKE '%invoice_reopened%'
      ) AS "canonicalReady",
      replacement.oid IS NOT NULL AS "replacementExists",
      COALESCE(replacement.convalidated, false) AS "replacementValidated"
    FROM (VALUES (1)) AS singleton(value)
    LEFT JOIN pg_constraint AS replacement
      ON replacement.conrelid = to_regclass('public.budget_commitment_events')
      AND replacement.conname = 'budget_commitment_events_event_type_check_v2'
  `;

  if (!state?.tableExists || state.canonicalReady || state.replacementValidated) return;

  await client`SET lock_timeout = '5s'`;
  await client`SET statement_timeout = '5min'`;
  try {
    if (!state.replacementExists) {
      await client.unsafe(`
        ALTER TABLE "budget_commitment_events"
        ADD CONSTRAINT "budget_commitment_events_event_type_check_v2"
        CHECK ("event_type" in (${BUDGET_EVENT_TYPES.map((type) => `'${type}'`).join(', ')}))
        NOT VALID
      `);
    }
    await client`
      ALTER TABLE "budget_commitment_events"
      VALIDATE CONSTRAINT "budget_commitment_events_event_type_check_v2"
    `;
  } finally {
    await client`RESET statement_timeout`;
    await client`RESET lock_timeout`;
  }
}

/** Build the email-intake parent key concurrently before its tenant-scoped FK is added. */
async function prepareEmailIntakeItemOrganizationIndex(client: postgres.Sql): Promise<void> {
  const [state] = await client<EmailIntakeIndexState[]>`
    SELECT
      to_regclass('public.email_intake_items') IS NOT NULL AS "emailIntakeItemsTableExists",
      to_regclass('public.email_intake_items_id_org_unique') IS NOT NULL AS "indexExists",
      COALESCE(index_state.indisvalid, false) AS "indexIsValid"
    FROM (VALUES (1)) AS singleton(value)
    LEFT JOIN pg_class AS index_class
      ON index_class.oid = to_regclass('public.email_intake_items_id_org_unique')
    LEFT JOIN pg_index AS index_state ON index_state.indexrelid = index_class.oid
  `;

  if (!state?.emailIntakeItemsTableExists || state.indexIsValid) return;

  if (state.indexExists) {
    await client`DROP INDEX CONCURRENTLY "email_intake_items_id_org_unique"`;
  }
  await client`
    CREATE UNIQUE INDEX CONCURRENTLY "email_intake_items_id_org_unique"
    ON "email_intake_items" ("id", "organization_id")
  `;
}

/** Build the custom-role parent key concurrently before adding the tenant-scoped FK. */
async function prepareCustomRoleOrganizationIndex(client: postgres.Sql): Promise<void> {
  const [state] = await client<CustomRoleOrganizationIndexState[]>`
    SELECT
      to_regclass('public.custom_roles') IS NOT NULL AS "customRolesTableExists",
      index_class.oid IS NOT NULL AS "indexExists",
      COALESCE(index_state.indisvalid, false) AS "indexIsValid"
    FROM (VALUES (1)) AS singleton(value)
    LEFT JOIN pg_class AS index_class
      ON index_class.oid = to_regclass('public.custom_roles_id_organization_id_unique')
    LEFT JOIN pg_index AS index_state ON index_state.indexrelid = index_class.oid
  `;

  if (!state?.customRolesTableExists || state.indexIsValid) return;

  await client`SET lock_timeout = '5s'`;
  await client`SET statement_timeout = '5min'`;
  try {
    if (state.indexExists) {
      await client`DROP INDEX CONCURRENTLY "custom_roles_id_organization_id_unique"`;
    }
    await client`
      CREATE UNIQUE INDEX CONCURRENTLY "custom_roles_id_organization_id_unique"
      ON "custom_roles" ("id", "organization_id")
    `;
  } finally {
    await client`RESET statement_timeout`;
    await client`RESET lock_timeout`;
  }
}

/** Build owner idempotency keys after the migration transaction so populated tables stay writable. */
async function prepareArtifactOwnerIdempotencyIndexes(client: postgres.Sql): Promise<void> {
  await client`SET lock_timeout = '5s'`;
  await client`SET statement_timeout = '5min'`;
  try {
    for (const { table, index } of ARTIFACT_OWNER_IDEMPOTENCY_INDEXES) {
      const [state] = await client<ArtifactOwnerIdempotencyIndexState[]>`
        SELECT
          to_regclass(${'public.' + table}) IS NOT NULL AS "tableExists",
          (
            SELECT count(*) = 2
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ${table}
              AND column_name IN ('organization_id', 'idempotency_key')
          ) AS "columnsExist",
          index_class.oid IS NOT NULL AS "indexExists",
          COALESCE(index_state.indisvalid, false) AS "indexIsValid",
          COALESCE(index_state.indisunique, false)
            AND index_state.indrelid = to_regclass(${'public.' + table})
            AND COALESCE(index_state.indnkeyatts, 0) = 2
            AND COALESCE((
              SELECT array_agg(attribute.attname ORDER BY indexed.ordinality)
              FROM unnest(index_state.indkey) WITH ORDINALITY AS indexed(attnum, ordinality)
              JOIN pg_attribute AS attribute
                ON attribute.attrelid = index_state.indrelid
                AND attribute.attnum = indexed.attnum
            ) = ARRAY['organization_id', 'idempotency_key']::text[], false)
            AS "indexIsCanonical"
        FROM (VALUES (1)) AS singleton(value)
        LEFT JOIN pg_class AS index_class
          ON index_class.oid = to_regclass(${'public.' + index})
        LEFT JOIN pg_index AS index_state ON index_state.indexrelid = index_class.oid
      `;

      if (!state?.tableExists || !state.columnsExist) continue;
      if (state.indexIsValid && state.indexIsCanonical) continue;

      if (state.indexExists) {
        await client`DROP INDEX CONCURRENTLY ${client(index)}`;
      }
      await client`
        CREATE UNIQUE INDEX CONCURRENTLY ${client(index)}
        ON ${client(table)} ("organization_id", "idempotency_key")
      `;
    }
  } finally {
    await client`RESET statement_timeout`;
    await client`RESET lock_timeout`;
  }
}

/** Backfill tenant ownership in small commits so large role tables stay writable. */
async function backfillUserRoleOrganizations(client: postgres.Sql): Promise<void> {
  await client`SET lock_timeout = '5s'`;
  await client`SET statement_timeout = '30s'`;
  try {
    while (true) {
      const updated = await client<{ id: string }[]>`
        WITH batch AS (
          SELECT assignments.id, assigned_users.organization_id
          FROM "user_roles" AS assignments
          JOIN "users" AS assigned_users ON assigned_users.id = assignments.user_id
          WHERE assignments.organization_id IS NULL
          ORDER BY assignments.id
          LIMIT ${USER_ROLE_BACKFILL_BATCH_SIZE}
          FOR UPDATE OF assignments SKIP LOCKED
        )
        UPDATE "user_roles" AS assignments
        SET organization_id = batch.organization_id
        FROM batch
        WHERE assignments.id = batch.id
        RETURNING assignments.id
      `;
      if (updated.length < USER_ROLE_BACKFILL_BATCH_SIZE) break;
    }
  } finally {
    await client`RESET statement_timeout`;
    await client`RESET lock_timeout`;
  }
}

/** Contract the expanded role shape while preventing old writers from adding null tenants. */
async function ensureUserRoleOrganizationContract(client: postgres.Sql): Promise<void> {
  await client.begin(async (transaction) => {
    await transaction`SET LOCAL lock_timeout = '5s'`;
    await transaction`SET LOCAL statement_timeout = '5min'`;
    await transaction`LOCK TABLE "user_roles" IN SHARE ROW EXCLUSIVE MODE`;

    while (true) {
      const updated = await transaction<{ id: string }[]>`
        WITH batch AS (
          SELECT assignments.id, assigned_users.organization_id
          FROM "user_roles" AS assignments
          JOIN "users" AS assigned_users ON assigned_users.id = assignments.user_id
          WHERE assignments.organization_id IS NULL
          ORDER BY assignments.id
          LIMIT ${USER_ROLE_BACKFILL_BATCH_SIZE}
        )
        UPDATE "user_roles" AS assignments
        SET organization_id = batch.organization_id
        FROM batch
        WHERE assignments.id = batch.id
        RETURNING assignments.id
      `;
      if (updated.length < USER_ROLE_BACKFILL_BATCH_SIZE) break;
    }

    const [remaining] = await transaction`
      SELECT 1
      FROM "user_roles"
      WHERE organization_id IS NULL
      LIMIT 1
    `;
    if (remaining) {
      throw new Error(
        'user_roles contains assignments without an organization; repair them before migrating',
      );
    }

    const [state] = await transaction<UserRoleOrganizationContractState[]>`
      SELECT
        column_definition.attnotnull AS "columnIsNotNull",
        EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'public.user_roles'::regclass
            AND conname = 'user_roles_user_org_fk'
        ) AS "userOrganizationForeignKeyExists",
        EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'public.user_roles'::regclass
            AND conname = 'user_roles_custom_role_org_fk'
        ) AS "customRoleOrganizationForeignKeyExists"
      FROM pg_attribute AS column_definition
      WHERE column_definition.attrelid = 'public.user_roles'::regclass
        AND column_definition.attname = 'organization_id'
        AND NOT column_definition.attisdropped
    `;
    if (!state) return;

    if (!state.columnIsNotNull) {
      await transaction`
        ALTER TABLE "user_roles"
        ALTER COLUMN "organization_id" SET NOT NULL
      `;
    }
    if (!state.userOrganizationForeignKeyExists) {
      await transaction`
        ALTER TABLE "user_roles"
        ADD CONSTRAINT "user_roles_user_org_fk"
        FOREIGN KEY ("user_id", "organization_id")
        REFERENCES "public"."users"("id", "organization_id")
        ON DELETE no action ON UPDATE no action
        NOT VALID
      `;
    }
    if (!state.customRoleOrganizationForeignKeyExists) {
      await transaction`
        ALTER TABLE "user_roles"
        ADD CONSTRAINT "user_roles_custom_role_org_fk"
        FOREIGN KEY ("custom_role_id", "organization_id")
        REFERENCES "public"."custom_roles"("id", "organization_id")
        ON DELETE no action ON UPDATE no action
        NOT VALID
      `;
    }
  });
}

/** Build the role-assignment natural key without blocking writes on a table scan. */
async function prepareUserRoleAssignmentIndex(client: postgres.Sql): Promise<void> {
  const [state] = await client<UserRoleAssignmentIndexState[]>`
    SELECT
      to_regclass('public.user_roles') IS NOT NULL AS "userRolesTableExists",
      index_class.oid IS NOT NULL AS "indexExists",
      COALESCE(index_state.indisvalid, false) AS "indexIsValid"
    FROM (VALUES (1)) AS singleton(value)
    LEFT JOIN pg_class AS index_class
      ON index_class.oid = to_regclass('public.user_roles_assignment_natural_key')
    LEFT JOIN pg_index AS index_state ON index_state.indexrelid = index_class.oid
  `;

  if (!state?.userRolesTableExists) return;

  const [invalid] = await client<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM "user_roles"
    WHERE NOT (
      (("role" in ('admin', 'approver', 'requester', 'receiver', 'finance') AND "custom_role_id" IS NULL)
        OR ("role" = 'custom' AND "custom_role_id" IS NOT NULL))
      AND (("scope_type" = 'global' AND "scope_id" IS NULL)
        OR ("scope_type" IN ('department', 'project', 'entity') AND "scope_id" IS NOT NULL))
    )
  `;
  if (Number(invalid?.count ?? 0) > 0) {
    throw new Error(
      'user_roles contains invalid role or scope assignments; repair them before migrating',
    );
  }

  const [duplicate] = await client`
    SELECT 1
    FROM "user_roles"
    GROUP BY
      "user_id",
      "role",
      "scope_type",
      coalesce("custom_role_id", '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce("scope_id", '00000000-0000-0000-0000-000000000000'::uuid)
    HAVING count(*) > 1
    LIMIT 1
  `;
  if (duplicate) {
    throw new Error('user_roles contains duplicate assignments; repair them before migrating');
  }

  if (state.indexIsValid) return;

  if (state.indexExists) {
    await client`DROP INDEX CONCURRENTLY "user_roles_assignment_natural_key"`;
  }
  await client`
    CREATE UNIQUE INDEX CONCURRENTLY "user_roles_assignment_natural_key"
    ON "user_roles" (
      "user_id",
      "role",
      "scope_type",
      coalesce("custom_role_id", '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce("scope_id", '00000000-0000-0000-0000-000000000000'::uuid)
    )
  `;
}

/** Fail before the migration transaction when legacy role rows cross tenant boundaries. */
async function validateLegacyUserRoleOrganizations(client: postgres.Sql): Promise<void> {
  const [state] = await client<
    { userRolesTableExists: boolean; customRolesTableExists: boolean }[]
  >`
    SELECT
      to_regclass('public.user_roles') IS NOT NULL AS "userRolesTableExists",
      to_regclass('public.custom_roles') IS NOT NULL AS "customRolesTableExists"
  `;
  if (!state?.userRolesTableExists || !state.customRolesTableExists) return;

  const [invalid] = await client`
    SELECT 1
    FROM "user_roles" AS assignments
    JOIN "users" AS assigned_users ON assigned_users."id" = assignments."user_id"
    JOIN "custom_roles" AS roles ON roles."id" = assignments."custom_role_id"
    WHERE assigned_users."organization_id" <> roles."organization_id"
    LIMIT 1
  `;
  if (invalid) {
    throw new Error(
      'user_roles contains custom-role assignments across organizations; repair them before migrating',
    );
  }
}

/** Validate NOT VALID role checks after the migration transaction commits. */
async function validateUserRoleAssignmentConstraints(client: postgres.Sql): Promise<void> {
  const constraints = [
    'user_roles_role_source_check',
    'user_roles_scope_shape_check',
    'user_roles_user_org_fk',
    'user_roles_custom_role_org_fk',
  ];
  await client`SET lock_timeout = '5s'`;
  await client`SET statement_timeout = '5min'`;
  try {
    for (const constraint of constraints) {
      const [state] = await client<{ exists: boolean; validated: boolean }[]>`
        SELECT
          constraint_row.oid IS NOT NULL AS "exists",
          COALESCE(constraint_row.convalidated, false) AS "validated"
        FROM (VALUES (1)) AS singleton(value)
        LEFT JOIN pg_constraint AS constraint_row
          ON constraint_row.conrelid = to_regclass('public.user_roles')
          AND constraint_row.conname = ${constraint}
      `;
      if (!state?.exists || state.validated) continue;
      await client.unsafe(`ALTER TABLE "user_roles" VALIDATE CONSTRAINT "${constraint}"`);
    }
  } finally {
    await client`RESET statement_timeout`;
    await client`RESET lock_timeout`;
  }
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
    await prepareBudgetEventTypeConstraint(client);
    await prepareEmailIntakeItemOrganizationIndex(client);
    await validateLegacyUserRoleOrganizations(client);
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: path.resolve(__dirname, 'migrations') });
    await prepareArtifactOwnerIdempotencyIndexes(client);
    await prepareUserRoleAssignmentIndex(client);
    await prepareCustomRoleOrganizationIndex(client);
    await backfillUserRoleOrganizations(client);
    await ensureUserRoleOrganizationContract(client);
    await validateUserRoleAssignmentConstraints(client);
    await migrateBetterAuthAccounts(client);
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
