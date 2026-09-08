import assert from 'node:assert/strict';
import test from 'node:test';
import { TERMINAL_JOB_RETENTION, cleanExpiredTerminalJobs } from './terminal-job-retention';

test('legacy cleanup only removes expired terminal jobs in bounded batches', async () => {
  const calls: unknown[] = [];
  const result = await cleanExpiredTerminalJobs({
    clean: async (...args) => {
      calls.push(args);
      return ['old-job'];
    },
  });
  assert.deepEqual(calls, [
    [TERMINAL_JOB_RETENTION.removeOnComplete.age * 1000, 1000, 'completed'],
    [TERMINAL_JOB_RETENTION.removeOnFail.age * 1000, 1000, 'failed'],
  ]);
  assert.deepEqual(result, { completed: 1, failed: 1 });
});
