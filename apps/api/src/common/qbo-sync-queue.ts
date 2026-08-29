export const QBO_SYNC_QUEUE_NAME = 'qbo-sync-in' as const;
export const QBO_INITIAL_SYNC_JOB_NAME = 'initial-sync' as const;

const QBO_INITIAL_SYNC_ATTEMPTS = 3;
const QBO_INITIAL_SYNC_BACKOFF_DELAY_MS = 2_000;

export function qboInitialSyncJobId(organizationId: string): string {
  return `qbo-initial-sync-${organizationId}`;
}

export function qboInitialSyncJobOptions(organizationId: string) {
  return {
    attempts: QBO_INITIAL_SYNC_ATTEMPTS,
    backoff: { type: 'exponential' as const, delay: QBO_INITIAL_SYNC_BACKOFF_DELAY_MS },
    jobId: qboInitialSyncJobId(organizationId),
    removeOnComplete: true,
    removeOnFail: true,
  };
}

type QboInitialSyncQueueJob = {
  id?: string;
  getState: () => Promise<string>;
  remove: () => Promise<void>;
};

type QboInitialSyncQueue = {
  getJob: (jobId: string) => Promise<QboInitialSyncQueueJob | null | undefined>;
};

export async function findReusableQboInitialSyncJob(
  queue: QboInitialSyncQueue,
  organizationId: string,
): Promise<{ id: string | undefined } | null> {
  const existing = await queue.getJob(qboInitialSyncJobId(organizationId));
  if (!existing) return null;
  if ((await existing.getState()) === 'failed') {
    await existing.remove();
    return null;
  }
  return { id: existing.id };
}
