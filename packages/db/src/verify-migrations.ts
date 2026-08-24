import postgres from 'postgres';

const EXPECTED_TABLES = [
  'vendor_portal_tokens',
  'notifications',
  'integration_connections',
  'sync_records',
] as const;

const EXPECTED_CONSTRAINTS = [
  'vendor_portal_tokens_vendor_id_vendors_id_fk',
  'notifications_user_id_users_id_fk',
  'integration_connections_organization_id_organizations_id_fk',
  'sync_records_connection_id_integration_connections_id_fk',
] as const;

async function main(): Promise<void> {
  const client = postgres(process.env.DATABASE_URL!);
  try {
    const tables = await client<{ name: string }[]>`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ${client(EXPECTED_TABLES)}
    `;
    const constraints = await client<{ name: string }[]>`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conname IN ${client(EXPECTED_CONSTRAINTS)}
    `;
    const foundTables = new Set(tables.map((row) => row.name));
    const foundConstraints = new Set(constraints.map((row) => row.name));
    const missingTables = EXPECTED_TABLES.filter((name) => !foundTables.has(name));
    const missingConstraints = EXPECTED_CONSTRAINTS.filter((name) => !foundConstraints.has(name));

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
