import type { JobsOptions, Queue } from 'bullmq';

// PostgreSQL owns OCR results and GL sync history. Redis retains recent execution diagnostics.
export const TERMINAL_JOB_RETENTION = {
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
} satisfies Pick<JobsOptions, 'removeOnComplete' | 'removeOnFail'>;

/** One bounded cleanup pass for jobs retained before the policy was introduced. */
export async function cleanExpiredTerminalJobs(queue: Pick<Queue, 'clean'>) {
  const completed = await queue.clean(
    TERMINAL_JOB_RETENTION.removeOnComplete.age * 1000,
    1000,
    'completed',
  );
  const failed = await queue.clean(TERMINAL_JOB_RETENTION.removeOnFail.age * 1000, 1000, 'failed');
  return { completed: completed.length, failed: failed.length };
}
