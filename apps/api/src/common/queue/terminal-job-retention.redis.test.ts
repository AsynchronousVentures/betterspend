import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { TERMINAL_JOB_RETENTION } from './terminal-job-retention';

test('OCR/GL terminal retention bounds Redis history while retrying and deduplicating jobs', async (t) => {
  const redisUrl = process.env.REDIS_TEST_URL;
  if (!redisUrl) {
    t.skip('Set REDIS_TEST_URL to an isolated test Redis instance');
    return;
  }
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(`retention-test-${randomUUID()}`, { connection });
  let executions = 0;
  const worker = new Worker(
    queue.name,
    async (job) => {
      executions++;
      if (job.data.fail) throw new Error('Expected fixture failure');
    },
    { connection, concurrency: 20 },
  );
  try {
    const completedCount = TERMINAL_JOB_RETENTION.removeOnComplete.count + 2;
    const failedCount = TERMINAL_JOB_RETENTION.removeOnFail.count + 2;
    await queue.addBulk([
      ...Array.from({ length: completedCount }, (_, index) => ({
        name: 'completed',
        data: {},
        opts: { ...TERMINAL_JOB_RETENTION, jobId: `completed-${index}` },
      })),
      ...Array.from({ length: failedCount }, (_, index) => ({
        name: 'failed',
        data: { fail: true },
        opts: { ...TERMINAL_JOB_RETENTION, jobId: `failed-${index}`, attempts: 2 },
      })),
    ]);
    const deadline = Date.now() + 30_000;
    while ((await queue.getWaitingCount()) || (await queue.getActiveCount())) {
      if (Date.now() > deadline) throw new Error('Queue fixture timed out');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(executions, completedCount + failedCount * 2);
    assert.equal(await queue.getCompletedCount(), TERMINAL_JOB_RETENTION.removeOnComplete.count);
    assert.equal(await queue.getFailedCount(), TERMINAL_JOB_RETENTION.removeOnFail.count);
    const lastId = `completed-${completedCount - 1}`;
    await queue.add('duplicate', {}, { ...TERMINAL_JOB_RETENTION, jobId: lastId });
    assert.equal(await queue.getWaitingCount(), 0);
    assert.equal((await queue.getJob(lastId))?.name, 'completed');
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
  }
});
