import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  INVOICE_REVIEW_NOTIFICATION_QUEUE,
  InvoiceReviewNotificationsService,
} from './invoice-review-notifications.service';

@Processor(INVOICE_REVIEW_NOTIFICATION_QUEUE)
export class InvoiceReviewNotificationProcessor extends WorkerHost {
  constructor(private readonly notifications: InvoiceReviewNotificationsService) {
    super();
  }

  async process(job: Job<{ intentId?: string; kind?: 'reconcile' }>): Promise<void> {
    if (job.data.kind === 'reconcile') {
      await this.notifications.enqueuePending();
      return;
    }
    if (!job.data.intentId) return;
    await this.notifications.deliver(job.data.intentId);
  }
}
