import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QBO_SYNC_QUEUE_NAME } from '../../../common/qbo-sync-queue';
import { QboInboundService, type QboSyncJobData } from './qbo-inbound.service';

@Processor(QBO_SYNC_QUEUE_NAME)
export class QboSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(QboSyncProcessor.name);

  constructor(private readonly qboInboundService: QboInboundService) {
    super();
  }

  async process(job: Job<QboSyncJobData>): Promise<void> {
    this.logger.log(`Processing QBO ${job.data.kind} sync for ${job.data.organizationId}`);
    if (job.data.kind === 'initial') {
      await this.qboInboundService.syncNow(job.data.organizationId, job.data.entityTypes);
      await this.qboInboundService.ensureScheduledSync(job.data.organizationId);
      return;
    }
    await this.qboInboundService.syncNow(job.data.organizationId, job.data.entityTypes);
  }
}
