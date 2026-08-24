import postgres from 'postgres';

const EXPECTED_TABLES = [
  'vendor_portal_tokens',
  'vendor_portal_sessions',
  'notifications',
  'integration_connections',
  'sync_records',
  'workflow_definitions',
  'workflow_definition_versions',
] as const;

const EXPECTED_COLUMNS = [
  { table: 'approval_requests', column: 'definition_version_id' },
  { table: 'approval_requests', column: 'current_node_id' },
  { table: 'approval_requests', column: 'attempt' },
  { table: 'workflow_definition_versions', column: 'organization_id' },
] as const;

const EXPECTED_TRIGGERS = [
  'workflow_definition_versions_immutable',
  'workflow_definitions_published_version_owner',
] as const;

const EXPECTED_FOREIGN_KEYS = [
  {
    name: 'vendor_portal_tokens_vendor_id_vendors_id_fk',
    child: 'vendor_portal_tokens',
    parent: 'vendors',
    childColumns: ['vendor_id'],
    parentColumns: ['id'],
  },
  {
    name: 'vendor_portal_sessions_organization_id_organizations_id_fk',
    child: 'vendor_portal_sessions',
    parent: 'organizations',
    childColumns: ['organization_id'],
    parentColumns: ['id'],
  },
  {
    name: 'vendor_portal_sessions_vendor_org_fk',
    child: 'vendor_portal_sessions',
    parent: 'vendors',
    childColumns: ['vendor_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'notifications_user_id_users_id_fk',
    child: 'notifications',
    parent: 'users',
    childColumns: ['user_id'],
    parentColumns: ['id'],
  },
  {
    name: 'integration_connections_organization_id_organizations_id_fk',
    child: 'integration_connections',
    parent: 'organizations',
    childColumns: ['organization_id'],
    parentColumns: ['id'],
  },
  {
    name: 'integration_connections_connected_by_user_org_fk',
    child: 'integration_connections',
    parent: 'users',
    childColumns: ['connected_by_user_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'sync_records_connection_org_fk',
    child: 'sync_records',
    parent: 'integration_connections',
    childColumns: ['connection_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_definition_versions_definition_org_fk',
    child: 'workflow_definition_versions',
    parent: 'workflow_definitions',
    childColumns: ['definition_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_definitions_published_version_org_fk',
    child: 'workflow_definitions',
    parent: 'workflow_definition_versions',
    childColumns: ['published_version_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_definitions_entity_org_fk',
    child: 'workflow_definitions',
    parent: 'legal_entities',
    childColumns: ['entity_id', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_definitions_created_by_org_fk',
    child: 'workflow_definitions',
    parent: 'users',
    childColumns: ['created_by', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_definitions_updated_by_org_fk',
    child: 'workflow_definitions',
    parent: 'users',
    childColumns: ['updated_by', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'workflow_definition_versions_published_by_org_fk',
    child: 'workflow_definition_versions',
    parent: 'users',
    childColumns: ['published_by', 'organization_id'],
    parentColumns: ['id', 'organization_id'],
  },
  {
    name: 'approval_requests_definition_version_fk',
    child: 'approval_requests',
    parent: 'workflow_definition_versions',
    childColumns: ['definition_version_id'],
    parentColumns: ['id'],
  },
] as const;

type ForeignKeyDescription = {
  name: string;
  child: string;
  parent: string;
  childColumns: readonly string[];
  parentColumns: readonly string[];
};

function foreignKeySignature(foreignKey: ForeignKeyDescription): string {
  return [
    foreignKey.name,
    foreignKey.child,
    foreignKey.parent,
    foreignKey.childColumns.join(','),
    foreignKey.parentColumns.join(','),
  ].join(':');
}

async function main(): Promise<void> {
  const client = postgres(process.env.DATABASE_URL!);
  try {
    const tables = await client<{ name: string }[]>`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ${client(EXPECTED_TABLES)}
    `;
    const constraints = await client<ForeignKeyDescription[]>`
      SELECT
        fk.conname AS name,
        child.relname AS child,
        parent.relname AS parent,
        ARRAY(
          SELECT child_attribute.attname
          FROM unnest(fk.conkey) WITH ORDINALITY AS child_key(attnum, position)
          JOIN pg_attribute AS child_attribute
            ON child_attribute.attrelid = fk.conrelid
            AND child_attribute.attnum = child_key.attnum
          ORDER BY child_key.position
        ) AS "childColumns",
        ARRAY(
          SELECT parent_attribute.attname
          FROM unnest(fk.confkey) WITH ORDINALITY AS parent_key(attnum, position)
          JOIN pg_attribute AS parent_attribute
            ON parent_attribute.attrelid = fk.confrelid
            AND parent_attribute.attnum = parent_key.attnum
          ORDER BY parent_key.position
        ) AS "parentColumns"
      FROM pg_constraint AS fk
      JOIN pg_class AS child ON child.oid = fk.conrelid
      JOIN pg_namespace AS child_namespace ON child_namespace.oid = child.relnamespace
      JOIN pg_class AS parent ON parent.oid = fk.confrelid
      JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent.relnamespace
      WHERE fk.contype = 'f'
        AND child_namespace.nspname = 'public'
        AND parent_namespace.nspname = 'public'
        AND fk.conname IN ${client(EXPECTED_FOREIGN_KEYS.map((item) => item.name))}
    `;
    const columns = await client<{ table: string; column: string }[]>`
      SELECT table_name AS table, column_name AS column
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ${client(EXPECTED_COLUMNS.map((item) => item.table))}
        AND column_name IN ${client(EXPECTED_COLUMNS.map((item) => item.column))}
    `;
    const triggers = await client<{ name: string }[]>`
      SELECT trigger.tgname AS name
      FROM pg_trigger trigger
      JOIN pg_class table_definition ON table_definition.oid = trigger.tgrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_definition.relnamespace
      WHERE NOT trigger.tgisinternal
        AND table_namespace.nspname = 'public'
        AND trigger.tgenabled IN ('O', 'A')
        AND trigger.tgname IN ${client(EXPECTED_TRIGGERS)}
    `;
    const foundTables = new Set(tables.map((row) => row.name));
    const foundConstraints = new Set(constraints.map(foreignKeySignature));
    const foundColumns = new Set(columns.map((row) => `${row.table}.${row.column}`));
    const foundTriggers = new Set(triggers.map((row) => row.name));
    const missingTables = EXPECTED_TABLES.filter((name) => !foundTables.has(name));
    const missingConstraints = EXPECTED_FOREIGN_KEYS.filter(
      (item) => !foundConstraints.has(foreignKeySignature(item)),
    ).map((item) => item.name);
    const missingColumns = EXPECTED_COLUMNS.filter(
      (item) => !foundColumns.has(`${item.table}.${item.column}`),
    ).map((item) => `${item.table}.${item.column}`);
    const missingTriggers = EXPECTED_TRIGGERS.filter((name) => !foundTriggers.has(name));

    if (
      missingTables.length ||
      missingConstraints.length ||
      missingColumns.length ||
      missingTriggers.length
    ) {
      throw new Error(
        `Migration verification failed. Missing tables: ${missingTables.join(', ') || 'none'}. ` +
          `Missing constraints: ${missingConstraints.join(', ') || 'none'}. ` +
          `Missing columns: ${missingColumns.join(', ') || 'none'}. ` +
          `Missing triggers: ${missingTriggers.join(', ') || 'none'}.`,
      );
    }
    console.log('Migration verification passed.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
