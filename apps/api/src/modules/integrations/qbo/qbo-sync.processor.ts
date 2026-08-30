import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { QBO_SYNC_QUEUE_NAME } from '../../../common/qbo-sync-queue';
import { QBO_MASTER_DATA, type QboMasterData, qboSyncJobDataSchema } from './qbo-inbound.service';

@Processor(QBO_SYNC_QUEUE_NAME)
export class QboSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(QboSyncProcessor.name);

  constructor(@Inject(QBO_MASTER_DATA) private readonly qboInboundService: QboMasterData) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    const data = qboSyncJobDataSchema.parse(job.data);
    if (data.kind === 'reconcile') {
      await this.qboInboundService.reconcileCatalogWebhook(
        data.organizationId,
        data.connectionId,
        data.realmId,
        data.entityName,
      );
      return;
    }
    this.logger.log(`Processing QBO ${data.kind} sync for ${data.organizationId}`);
    if (data.kind === 'initial') {
      await this.qboInboundService.synchronize({
        kind: 'snapshot',
        organizationId: data.organizationId,
        entityTypes: data.entityTypes,
      });
      await this.qboInboundService.ensureScheduledSync(data.organizationId);
      return;
    }
    await this.qboInboundService.synchronize({
      kind: 'snapshot',
      organizationId: data.organizationId,
      entityTypes: data.entityTypes,
    });
  }
}
