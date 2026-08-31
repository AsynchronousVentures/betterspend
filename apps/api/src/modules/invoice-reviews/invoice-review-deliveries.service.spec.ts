import type { Queue } from 'bullmq';
import { InvoiceReviewDeliveries } from './invoice-review-deliveries.service';

function pendingIntentDb() {
  const query = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockResolvedValue([]),
    then: (resolve: (value: unknown[]) => unknown) => resolve([]),
  };
  return { select: jest.fn().mockReturnValue(query) };
}

function serviceWith(queue: { add: jest.Mock }) {
  return new InvoiceReviewDeliveries(
    queue as unknown as Queue,
    pendingIntentDb() as never,
    { createIdempotent: jest.fn() } as never,
    undefined as never,
    undefined as never,
  );
}

describe('InvoiceReviewDeliveries scheduling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('registers one stable reconciliation repeat job on startup', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = serviceWith(queue);

    await service.onModuleInit();
    service.onModuleDestroy();

    expect(queue.add).toHaveBeenCalledWith(
      'reconcile',
      { kind: 'reconcile' },
      expect.objectContaining({
        jobId: 'invoice-review-notification-reconcile',
        repeat: { every: 60_000, key: 'invoice-review-notification-reconcile' },
      }),
    );
  });

  it('does not fail startup, retries a rejected registration, and cleans up recovery', async () => {
    const queue = {
      add: jest
        .fn()
        .mockRejectedValueOnce(new Error('Redis unavailable'))
        .mockResolvedValue(undefined),
    };
    const service = serviceWith(queue);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(queue.add).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(queue.add).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
});
