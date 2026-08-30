import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { QBO_MASTER_DATA, type QboMasterData, qboCdcJobDataSchema } from './qbo-inbound.service';

@Processor('qbo-cdc')
export class QboCdcProcessor extends WorkerHost {
  private readonly logger = new Logger(QboCdcProcessor.name);

  constructor(@Inject(QBO_MASTER_DATA) private readonly qboInboundService: QboMasterData) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    const data = qboCdcJobDataSchema.parse(job.data);
    if (data.kind === 'webhook') {
      await this.qboInboundService.synchronize({ kind: 'master-webhook', event: data.event });
      return;
    }
    if (data.kind === 'vendor-merge-recovery') {
      await this.qboInboundService.processVendorMergeRecovery(data);
      return;
    }
    this.logger.log(`Processing QBO CDC sweep for ${data.organizationId}`);
    await this.qboInboundService.synchronize({
      kind: 'cdc',
      organizationId: data.organizationId,
      lookbackDays: data.lookbackDays,
    });
  }
}
