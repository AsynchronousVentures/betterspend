import { closeDb } from './client';
import { parseRandomSeedArgs } from './random-seed';
import { assertRandomSeedAllowed, seedRandomWorkload } from './random-seed-persist';

const HELP = `Usage: pnpm db:seed:random -- [options]

Generate a repeatable local workload in the fixed Acme demo organization.

Options:
  --count <n>  Purchase-to-pay stories, 1-5000 (default: 500)
  --seed <s>   Deterministic seed string (default: betterspend-demo-2026)
  --help       Show this help

The same seed and count are safe to rerun. A durable seed marker records the
original count, so a namespace may only be rerun with that count. Once present,
the marker permits repair of deleted generated rows. To change the count,
choose a new seed. Webhook secrets and the inbound email address token are
random at first insert and preserved on reruns.
This command refuses to run with NODE_ENV=production.
`;

async function main(): Promise<void> {
  const options = parseRandomSeedArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  assertRandomSeedAllowed();
  await seedRandomWorkload({ count: options.count, seed: options.seed });
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error: unknown) {
    console.error(`Random seed failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    try {
      await closeDb();
    } catch (error: unknown) {
      console.error(
        `Random seed cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  }
}

void run();
