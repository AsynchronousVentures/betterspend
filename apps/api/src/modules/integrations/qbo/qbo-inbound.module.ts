import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QboInboundController } from './qbo-inbound.controller';
import { QBO_MASTER_DATA, QboInboundService } from './qbo-inbound.service';
import { QboCdcProcessor } from './qbo-cdc.processor';
import { QboSyncProcessor } from './qbo-sync.processor';
import { QBO_SYNC_QUEUE_NAME } from '../../../common/qbo-sync-queue';

@Module({
  imports: [BullModule.registerQueue({ name: QBO_SYNC_QUEUE_NAME }, { name: 'qbo-cdc' })],
  controllers: [QboInboundController],
  providers: [
    QboInboundService,
    { provide: QBO_MASTER_DATA, useExisting: QboInboundService },
    QboCdcProcessor,
    QboSyncProcessor,
  ],
  exports: [QBO_MASTER_DATA],
})
export class QboInboundModule {}
