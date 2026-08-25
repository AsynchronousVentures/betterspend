import { db } from './client';
import { upsertDemoFixtures } from './demo-fixtures';

/** Seed the small, predictable Acme dataset used by local demo mode. */
export async function seed(): Promise<void> {
  console.log('Seeding database...');

  await db.transaction(async (tx) => {
    await upsertDemoFixtures(tx);
  });

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
