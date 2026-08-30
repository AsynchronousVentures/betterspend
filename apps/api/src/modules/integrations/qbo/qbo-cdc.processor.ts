import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QboInboundService, type QboCdcJobData } from './qbo-inbound.service';

@Processor('qbo-cdc')
export class QboCdcProcessor extends WorkerHost {
  private readonly logger = new Logger(QboCdcProcessor.name);

  constructor(private readonly qboInboundService: QboInboundService) {
    super();
  }

  async process(job: Job<QboCdcJobData>): Promise<void> {
    if (job.data.kind === 'webhook') {
      await this.qboInboundService.processWebhookEvent(job.data.event);
      return;
    }
    this.logger.log(`Processing QBO CDC sweep for ${job.data.organizationId}`);
    await this.qboInboundService.runCdcSweep(job.data.organizationId, job.data.lookbackDays);
  }
}
