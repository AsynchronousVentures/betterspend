import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { webhookDeliveries, webhookEndpoints, type DbTransaction } from '@betterspend/db';

export type WebhookEventType =
  | 'requisition.submitted'
  | 'requisition.approved'
  | 'requisition.rejected'
  | 'po.issued'
  | 'po.approved'
  | 'po.rejected'
  | 'po.cancelled'
  | 'grn.created'
  | 'invoice.matched'
  | 'invoice.exception'
  | 'invoice.approved'
  | 'invoice.rejected'
  | 'invoice.paid'
  | 'approval.requested'
  | 'approval.approved'
  | 'approval.rejected';

export async function enqueueWebhookDelivery(queue: Queue, deliveryId: string): Promise<void> {
  await queue.add(
    'deliver',
    { kind: 'delivery', deliveryId },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      jobId: `webhook-delivery-${deliveryId}`,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

@Injectable()
export class WebhookEventService {
  private readonly logger = new Logger(WebhookEventService.name);

  constructor(@InjectQueue('webhook-delivery') private readonly webhookQueue: Queue) {}

  emit(
    organizationId: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
  ): void {
    this.enqueue(organizationId, eventType, payload).catch((error: unknown) =>
      this.logger.error(`Failed to enqueue webhook event ${eventType}: ${String(error)}`),
    );
  }

  /** Record an invoice-paid delivery inside the payment transaction before queueing it. */
  async recordInvoicePaidInTransaction(
    transaction: DbTransaction,
    organizationId: string,
    invoice: object,
  ): Promise<string[]> {
    return this.recordEventInTransaction(transaction, organizationId, 'invoice.paid', { invoice });
  }

  private async recordEventInTransaction(
    transaction: DbTransaction,
    organizationId: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
  ): Promise<string[]> {
    const endpoints = await transaction
      .select({ id: webhookEndpoints.id, events: webhookEndpoints.events })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.organizationId, organizationId),
          eq(webhookEndpoints.isActive, true),
        ),
      );
    const matchedEndpoints = endpoints.filter(
      (endpoint) => endpoint.events.length === 0 || endpoint.events.includes(eventType),
    );
    if (matchedEndpoints.length === 0) return [];

    const deliveries = await transaction
      .insert(webhookDeliveries)
      .values(
        matchedEndpoints.map((endpoint) => ({
          webhookEndpointId: endpoint.id,
          eventType,
          payload,
          status: 'pending',
          attempts: 0,
        })),
      )
      .returning({ id: webhookDeliveries.id });
    return deliveries.map((delivery) => delivery.id);
  }

  /** Queue persisted endpoint deliveries after their owner transaction commits. */
  async enqueueDurableDeliveries(deliveryIds: readonly string[]): Promise<void> {
    await Promise.all(
      deliveryIds.map(async (deliveryId) => {
        try {
          await enqueueWebhookDelivery(this.webhookQueue, deliveryId);
        } catch (error: unknown) {
          this.logger.error(
            `Failed to enqueue persisted webhook delivery ${deliveryId}: ${String(error)}`,
          );
        }
      }),
    );
  }

  async enqueue(
    organizationId: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
    jobId?: string,
  ): Promise<void> {
    await this.webhookQueue.add(
      'dispatch',
      { kind: 'dispatch', organizationId, eventType, payload },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        ...(jobId ? { jobId } : {}),
      },
    );
  }
}
