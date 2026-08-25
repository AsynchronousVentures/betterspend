import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

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
  | 'invoice.paid'
  | 'approval.requested'
  | 'approval.approved'
  | 'approval.rejected';

@Injectable()
export class WebhookEventService {
  private readonly logger = new Logger(WebhookEventService.name);

  constructor(@InjectQueue('webhook-delivery') private readonly webhookQueue: Queue) {}

  emit(
    organizationId: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
  ): void {
    this.enqueue(organizationId, eventType, payload).catch((err: unknown) =>
      this.logger.error(`Failed to enqueue webhook event ${eventType}: ${String(err)}`),
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
