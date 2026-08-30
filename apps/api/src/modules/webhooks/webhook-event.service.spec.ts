import type { DbTransaction } from '@betterspend/db';
import { webhookDeliveries, webhookEndpoints } from '@betterspend/db';
import type { Queue } from 'bullmq';
import { WebhookEventService } from './webhook-event.service';

const organizationId = '00000000-0000-4000-8000-000000000001';

function createHarness() {
  const endpoints = [
    { id: 'endpoint-1', events: ['invoice.paid'] },
    { id: 'endpoint-2', events: [] },
    { id: 'endpoint-3', events: ['invoice.approved'] },
  ];
  const inserted: Array<Record<string, unknown>> = [];
  const jobs: Array<{ name: string; data: unknown; options: Record<string, unknown> }> = [];
  const transaction = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => (table === webhookEndpoints ? endpoints : []),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Array<Record<string, unknown>>) => ({
        returning: async () => {
          if (table !== webhookDeliveries) return [];
          values.forEach((value, index) => inserted.push(value));
          return values.map((_value, index) => ({ id: `delivery-${index + 1}` }));
        },
      }),
    }),
  } as unknown as DbTransaction;
  const queue = {
    add: async (name: string, data: unknown, options: Record<string, unknown>) => {
      jobs.push({ name, data, options });
    },
  } as unknown as Queue;
  return { jobs, inserted, queue, transaction };
}

describe('durable webhook event recording', () => {
  it('records only matching active endpoints inside the owner transaction', async () => {
    const harness = createHarness();
    const service = new WebhookEventService(harness.queue);

    const deliveryIds = await service.recordInvoicePaidInTransaction(
      harness.transaction,
      organizationId,
      { id: 'invoice-1' },
    );

    expect(deliveryIds).toEqual(['delivery-1', 'delivery-2']);
    expect(harness.inserted).toEqual([
      {
        webhookEndpointId: 'endpoint-1',
        eventType: 'invoice.paid',
        payload: { invoice: { id: 'invoice-1' } },
        status: 'pending',
        attempts: 0,
      },
      {
        webhookEndpointId: 'endpoint-2',
        eventType: 'invoice.paid',
        payload: { invoice: { id: 'invoice-1' } },
        status: 'pending',
        attempts: 0,
      },
    ]);
  });

  it('uses stable delivery jobs that can recover after queue submission fails', async () => {
    const harness = createHarness();
    const service = new WebhookEventService(harness.queue);

    await service.enqueueDurableDeliveries(['delivery-1', 'delivery-2']);

    expect(harness.jobs).toEqual([
      {
        name: 'deliver',
        data: { kind: 'delivery', deliveryId: 'delivery-1' },
        options: expect.objectContaining({ jobId: 'webhook-delivery-delivery-1' }),
      },
      {
        name: 'deliver',
        data: { kind: 'delivery', deliveryId: 'delivery-2' },
        options: expect.objectContaining({ jobId: 'webhook-delivery-delivery-2' }),
      },
    ]);
  });

  it('keeps queue failures non-fatal because the pending row remains recoverable', async () => {
    const harness = createHarness();
    jest.spyOn(harness.queue, 'add').mockRejectedValue(new Error('queue unavailable'));
    const service = new WebhookEventService(harness.queue);

    await expect(service.enqueueDurableDeliveries(['delivery-1'])).resolves.toBeUndefined();
    expect(harness.jobs).toHaveLength(0);
  });

  it('keeps emit as a queue-only dispatch for non-payment events', async () => {
    const harness = createHarness();
    const service = new WebhookEventService(harness.queue);

    service.emit(organizationId, 'invoice.approved', { invoiceId: 'invoice-1' });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(harness.jobs).toEqual([
      {
        name: 'dispatch',
        data: {
          kind: 'dispatch',
          organizationId,
          eventType: 'invoice.approved',
          payload: { invoiceId: 'invoice-1' },
        },
        options: expect.objectContaining({ attempts: 5 }),
      },
    ]);
    expect(harness.inserted).toHaveLength(0);
  });
});
