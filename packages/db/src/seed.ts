import { db } from './client';
import { upsertDemoFixtures } from './demo-fixtures';
import { demoVendorPortalPassword, upsertDemoVendorPortalLogins } from './vendor-portal-seed';

/** Seed the small, predictable Acme dataset used by local demo mode. */
export async function seed(): Promise<void> {
  console.log('Seeding database...');

  const logins = await db.transaction(async (tx) => {
    const identity = await upsertDemoFixtures(tx);
    return upsertDemoVendorPortalLogins(tx, identity.organizationId);
  });

  if (logins.email) {
    console.log(
      `Vendor portal logins ready (${logins.created} created). Example: ${logins.email} / ${demoVendorPortalPassword()}`,
    );
  }
  console.log('Seed complete!');
}

if (process.argv[1]?.endsWith('/seed.ts')) {
  seed()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}
