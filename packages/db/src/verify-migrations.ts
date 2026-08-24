import postgres from 'postgres';

const EXPECTED_TABLES = [
  'vendor_portal_tokens',
  'notifications',
  'integration_connections',
  'sync_records',
] as const;

const EXPECTED_FOREIGN_KEYS = [
  {
    name: 'vendor_portal_tokens_vendor_id_vendors_id_fk',
    child: 'vendor_portal_tokens',
    parent: 'vendors',
  },
  { name: 'notifications_user_id_users_id_fk', child: 'notifications', parent: 'users' },
  {
    name: 'integration_connections_organization_id_organizations_id_fk',
    child: 'integration_connections',
    parent: 'organizations',
  },
  {
    name: 'integration_connections_connected_by_user_org_fk',
    child: 'integration_connections',
    parent: 'users',
  },
  {
    name: 'sync_records_connection_org_fk',
    child: 'sync_records',
    parent: 'integration_connections',
  },
] as const;

async function main(): Promise<void> {
  const client = postgres(process.env.DATABASE_URL!);
  try {
    const tables = await client<{ name: string }[]>`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ${client(EXPECTED_TABLES)}
    `;
    const constraints = await client<{ name: string; child: string; parent: string }[]>`
      SELECT fk.conname AS name, child.relname AS child, parent.relname AS parent
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
    const foundTables = new Set(tables.map((row) => row.name));
    const foundConstraints = new Set(
      constraints.map((row) => `${row.name}:${row.child}:${row.parent}`),
    );
    const missingTables = EXPECTED_TABLES.filter((name) => !foundTables.has(name));
    const missingConstraints = EXPECTED_FOREIGN_KEYS.filter(
      (item) => !foundConstraints.has(`${item.name}:${item.child}:${item.parent}`),
    ).map((item) => item.name);

    if (missingTables.length || missingConstraints.length) {
      throw new Error(
        `Migration verification failed. Missing tables: ${missingTables.join(', ') || 'none'}. ` +
          `Missing constraints: ${missingConstraints.join(', ') || 'none'}.`,
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
