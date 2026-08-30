import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QboInboundService, qboCdcJobDataSchema } from './qbo-inbound.service';

@Processor('qbo-cdc')
export class QboCdcProcessor extends WorkerHost {
  private readonly logger = new Logger(QboCdcProcessor.name);

  constructor(private readonly qboInboundService: QboInboundService) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    const data = qboCdcJobDataSchema.parse(job.data);
    if (data.kind === 'webhook') {
      await this.qboInboundService.processWebhookEvent(data.event);
      return;
    }
    this.logger.log(`Processing QBO CDC sweep for ${data.organizationId}`);
    await this.qboInboundService.runCdcSweep(data.organizationId, data.lookbackDays);
  }
}
