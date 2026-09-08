import { Queue } from 'bullmq';
import { getRedisConnection } from './queue.module';
import { cleanExpiredTerminalJobs } from './terminal-job-retention';

async function main() {
  const [name, ...extra] = process.argv.slice(2);
  if ((name !== 'ocr' && name !== 'gl-export') || extra.length > 0) {
    throw new Error('Usage: tsx src/common/queue/clean-terminal-jobs.ts <ocr|gl-export>');
  }
  const queue = new Queue(name, { connection: getRedisConnection() });
  try {
    console.log(JSON.stringify({ queue: name, ...(await cleanExpiredTerminalJobs(queue)) }));
  } finally {
    await queue.close();
  }
}

main().catch(() => {
  // Connection errors can include credentials supplied in a Redis URL.
  console.error(
    'Terminal-job cleanup failed. Check the queue name and Redis connection configuration.',
  );
  process.exitCode = 1;
});
