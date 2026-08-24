import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WebhooksService } from './webhooks.service';

export interface WebhookDispatchJobData {
  kind?: 'dispatch';
  organizationId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface WebhookRetryJobData {
  kind: 'retry';
  deliveryId: string;
}

export type WebhookDeliveryJobData = WebhookDispatchJobData | WebhookRetryJobData;

@Processor('webhook-delivery')
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(private readonly webhooksService: WebhooksService) {
    super();
  }

  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    if (job.data.kind === 'retry') {
      await this.webhooksService.retryDelivery(job.data.deliveryId);
      return;
    }

    const { organizationId, eventType, payload } = job.data;
    this.logger.log(`Processing webhook dispatch for event ${eventType} (org: ${organizationId})`);
    await this.webhooksService.dispatchEvent(organizationId, eventType, payload);
  }
}
