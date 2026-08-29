import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QboInboundService, type QboSyncJobData } from './qbo-inbound.service';

@Processor('qbo-sync-in')
export class QboSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(QboSyncProcessor.name);

  constructor(private readonly qboInboundService: QboInboundService) {
    super();
  }

  async process(job: Job<QboSyncJobData>): Promise<void> {
    this.logger.log(`Processing QBO ${job.data.kind} sync for ${job.data.organizationId}`);
    if (job.data.kind === 'initial') {
      await this.qboInboundService.ensureScheduledSync(job.data.organizationId);
    }
    await this.qboInboundService.syncNow(job.data.organizationId, job.data.entityTypes);
  }
}
