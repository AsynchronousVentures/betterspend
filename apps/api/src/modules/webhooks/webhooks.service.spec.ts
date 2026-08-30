import type { Db } from '@betterspend/db';
import type { Queue } from 'bullmq';
import { WebhookDeliveryProcessor, type WebhookRetryJobData } from './webhook-delivery.processor';
import * as webhookUrlPolicy from './webhook-url-policy';
import { WebhooksService } from './webhooks.service';

interface DeliveryRecord {
  id: string;
  webhookEndpointId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  nextRetryAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function createDurableHarness() {
  const endpoint = {
    id: '00000000-0000-0000-0000-000000000101',
    organizationId: '00000000-0000-0000-0000-000000000001',
    url: 'https://vendor.example/webhooks',
    secret: 'test-secret',
    events: ['invoice.approved'],
    isActive: true,
  };
  const deliveries: DeliveryRecord[] = [];
  const jobs = new Map<string, { name: string; data: unknown; opts: Record<string, unknown> }>();

  const db = {
    query: {
      webhookEndpoints: {
        findMany: jest.fn(async () => [endpoint]),
        findFirst: jest.fn(async () => endpoint),
      },
      webhookDeliveries: {
        findFirst: jest.fn(async () => deliveries[0]),
        findMany: jest.fn(async () =>
          deliveries.filter((delivery) => ['pending', 'retrying'].includes(delivery.status)),
        ),
      },
    },
    insert: jest.fn(() => ({
      values: jest.fn((values: Partial<DeliveryRecord>) => ({
        returning: jest.fn(async () => {
          const now = new Date();
          const delivery: DeliveryRecord = {
            ...values,
            id: '00000000-0000-0000-0000-000000000201',
            webhookEndpointId: String(values.webhookEndpointId),
            eventType: String(values.eventType),
            payload: values.payload ?? {},
            status: values.status ?? 'pending',
            attempts: values.attempts ?? 0,
            responseStatus: values.responseStatus ?? null,
            responseBody: values.responseBody ?? null,
            nextRetryAt: values.nextRetryAt ?? null,
            deliveredAt: values.deliveredAt ?? null,
            createdAt: now,
            updatedAt: now,
          };
          deliveries.push(delivery);
          return [delivery];
        }),
      })),
    })),
    update: jest.fn(() => ({
      set: jest.fn((values: Partial<DeliveryRecord>) => ({
        where: jest.fn(async () => {
          Object.assign(deliveries[0], values);
        }),
      })),
    })),
  } as unknown as Db;

  const queue = {
    add: jest.fn(async (name: string, data: unknown, opts: Record<string, unknown> = {}) => {
      const id = String(opts.jobId ?? `${name}-${jobs.size + 1}`);
      if (!jobs.has(id)) jobs.set(id, { name, data, opts });
      return jobs.get(id);
    }),
  } as unknown as Queue;

  return { db, deliveries, jobs, queue };
}

describe('durable webhook retries', () => {
  const safeTarget: webhookUrlPolicy.SafeWebhookTarget = {
    protocol: 'https:',
    hostname: 'vendor.example',
    hostHeader: 'vendor.example',
    address: '93.184.216.34',
    family: 4,
    port: 443,
    path: '/webhooks',
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-24T20:00:00Z'));
    jest.spyOn(webhookUrlPolicy, 'resolveSafeWebhookTarget').mockResolvedValue(safeTarget);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('resumes one delayed delivery after the worker restarts', async () => {
    const harness = createDurableHarness();
    const requestMock = jest
      .spyOn(webhookUrlPolicy, 'requestPinnedWebhook')
      .mockResolvedValueOnce({ status: 503, body: 'unavailable', ok: false })
      .mockResolvedValueOnce({ status: 204, body: '', ok: true });
    const firstProcess = new WebhooksService(harness.db, harness.queue);

    await firstProcess.dispatchEvent('00000000-0000-0000-0000-000000000001', 'invoice.approved', {
      invoiceId: 'INV-1',
    });

    expect(harness.deliveries).toHaveLength(1);
    expect(harness.deliveries[0]).toMatchObject({ status: 'retrying', attempts: 1 });

    const restartedProcess = new WebhooksService(harness.db, harness.queue);
    await restartedProcess.onModuleInit();

    expect(harness.jobs.size).toBe(1);
    const [retryJob] = harness.jobs.values();
    const processor = new WebhookDeliveryProcessor(restartedProcess);
    await processor.process({ name: retryJob.name, data: retryJob.data } as never);

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(harness.deliveries).toHaveLength(1);
    expect(harness.deliveries[0]).toMatchObject({
      status: 'delivered',
      attempts: 2,
      nextRetryAt: null,
    });
    expect(retryJob.data).toEqual<WebhookRetryJobData>({
      kind: 'retry',
      deliveryId: '00000000-0000-0000-0000-000000000201',
    });
  });

  it('records each backoff and stops after the fifth failed attempt', async () => {
    const harness = createDurableHarness();
    jest
      .spyOn(webhookUrlPolicy, 'requestPinnedWebhook')
      .mockResolvedValue({ status: 503, body: 'unavailable', ok: false });
    const service = new WebhooksService(harness.db, harness.queue);
    const processor = new WebhookDeliveryProcessor(service);

    await service.dispatchEvent('00000000-0000-0000-0000-000000000001', 'invoice.approved', {
      invoiceId: 'INV-1',
    });

    for (const [attempt, delay] of [
      [2, 30_000],
      [3, 120_000],
      [4, 600_000],
      [5, 3_600_000],
    ] as const) {
      const jobId = `webhook-retry-00000000-0000-0000-0000-000000000201-${attempt}`;
      const retryJob = harness.jobs.get(jobId);
      expect(retryJob?.opts.delay).toBe(delay);
      expect(harness.deliveries[0]).toMatchObject({
        status: 'retrying',
        attempts: attempt - 1,
        nextRetryAt: new Date(Date.now() + delay),
      });

      jest.setSystemTime(new Date(Date.now() + delay));
      await processor.process({ name: retryJob?.name, data: retryJob?.data } as never);
    }

    expect(harness.deliveries[0]).toMatchObject({
      status: 'failed',
      attempts: 5,
      nextRetryAt: null,
    });
    expect(harness.jobs.size).toBe(4);
  });

  it('enqueues a past-due retrying delivery when the module starts', async () => {
    const harness = createDurableHarness();
    jest
      .spyOn(webhookUrlPolicy, 'requestPinnedWebhook')
      .mockResolvedValueOnce({ status: 503, body: 'unavailable', ok: false })
      .mockResolvedValueOnce({ status: 204, body: '', ok: true });
    const firstProcess = new WebhooksService(harness.db, harness.queue);

    await firstProcess.dispatchEvent('00000000-0000-0000-0000-000000000001', 'invoice.approved', {
      invoiceId: 'INV-1',
    });

    harness.jobs.clear();
    jest.setSystemTime(new Date('2026-08-24T20:00:31Z'));
    const restartedProcess = new WebhooksService(harness.db, harness.queue);
    await restartedProcess.onModuleInit();

    const [recoveredJob] = harness.jobs.values();
    expect(recoveredJob.opts.delay).toBe(0);
    const processor = new WebhookDeliveryProcessor(restartedProcess);
    await processor.process({ name: recoveredJob.name, data: recoveredJob.data } as never);
    expect(harness.deliveries[0]).toMatchObject({ status: 'delivered', attempts: 2 });
  });

  it('lets startup replace a retry job that failed before advancing the delivery', async () => {
    const harness = createDurableHarness();
    jest
      .spyOn(webhookUrlPolicy, 'requestPinnedWebhook')
      .mockResolvedValue({ status: 503, body: 'unavailable', ok: false });
    const firstProcess = new WebhooksService(harness.db, harness.queue);

    await firstProcess.dispatchEvent('00000000-0000-0000-0000-000000000001', 'invoice.approved', {
      invoiceId: 'INV-1',
    });

    const [jobId, failedJob] = [...harness.jobs.entries()][0];
    if (failedJob.opts.removeOnFail === true) harness.jobs.delete(jobId);

    const restartedProcess = new WebhooksService(harness.db, harness.queue);
    await restartedProcess.onModuleInit();

    expect(harness.jobs.get(jobId)).not.toBe(failedJob);
  });

  it('recovers a persisted pending delivery with a stable job identity', async () => {
    const harness = createDurableHarness();
    harness.deliveries.push({
      id: '00000000-0000-0000-0000-000000000202',
      webhookEndpointId: '00000000-0000-0000-0000-000000000101',
      eventType: 'invoice.paid',
      payload: { invoiceId: 'INV-2' },
      status: 'pending',
      attempts: 0,
      responseStatus: null,
      responseBody: null,
      nextRetryAt: null,
      deliveredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = new WebhooksService(harness.db, harness.queue);

    await service.onModuleInit();

    expect(harness.jobs.get('webhook-delivery-00000000-0000-0000-0000-000000000202')).toMatchObject(
      {
        name: 'deliver',
        data: {
          kind: 'delivery',
          deliveryId: '00000000-0000-0000-0000-000000000202',
        },
      },
    );
  });

  it('does not redeliver a completed persisted delivery when a duplicate job runs', async () => {
    const harness = createDurableHarness();
    harness.deliveries.push({
      id: '00000000-0000-0000-0000-000000000202',
      webhookEndpointId: '00000000-0000-0000-0000-000000000101',
      eventType: 'invoice.paid',
      payload: { invoiceId: 'INV-2' },
      status: 'pending',
      attempts: 0,
      responseStatus: null,
      responseBody: null,
      nextRetryAt: null,
      deliveredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const requestMock = jest
      .spyOn(webhookUrlPolicy, 'requestPinnedWebhook')
      .mockResolvedValue({ status: 204, body: '', ok: true });
    const service = new WebhooksService(harness.db, harness.queue);
    const processor = new WebhookDeliveryProcessor(service);

    await processor.process({
      name: 'deliver',
      data: { kind: 'delivery', deliveryId: '00000000-0000-0000-0000-000000000202' },
    } as never);
    await processor.process({
      name: 'deliver',
      data: { kind: 'delivery', deliveryId: '00000000-0000-0000-0000-000000000202' },
    } as never);

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(harness.deliveries[0]).toMatchObject({ status: 'delivered', attempts: 1 });
  });
});
