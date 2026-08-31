import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  INVOICE_REVIEW_DELIVERY_QUEUE,
  InvoiceReviewDeliveries,
} from './invoice-review-deliveries.service';

@Processor(INVOICE_REVIEW_DELIVERY_QUEUE)
export class InvoiceReviewNotificationProcessor extends WorkerHost {
  constructor(private readonly deliveries: InvoiceReviewDeliveries) {
    super();
  }

  async process(job: Job<{ intentId?: string; kind?: 'reconcile' }>): Promise<void> {
    if (job.data.kind === 'reconcile') {
      await this.deliveries.enqueuePending();
      return;
    }
    if (!job.data.intentId) return;
    await this.deliveries.deliver(job.data.intentId);
  }
}
