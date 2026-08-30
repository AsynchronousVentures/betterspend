import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QBO_SYNC_QUEUE_NAME } from '../../../common/qbo-sync-queue';
import { QboInboundService, qboSyncJobDataSchema } from './qbo-inbound.service';

@Processor(QBO_SYNC_QUEUE_NAME)
export class QboSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(QboSyncProcessor.name);

  constructor(private readonly qboInboundService: QboInboundService) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    const data = qboSyncJobDataSchema.parse(job.data);
    this.logger.log(`Processing QBO ${data.kind} sync for ${data.organizationId}`);
    if (data.kind === 'initial') {
      await this.qboInboundService.syncNow(data.organizationId, data.entityTypes);
      await this.qboInboundService.ensureScheduledSync(data.organizationId);
      return;
    }
    await this.qboInboundService.syncNow(data.organizationId, data.entityTypes);
  }
}
