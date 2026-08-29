import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QboInboundController } from './qbo-inbound.controller';
import { QboInboundService } from './qbo-inbound.service';
import { QboCdcProcessor } from './qbo-cdc.processor';
import { QboSyncProcessor } from './qbo-sync.processor';
import { QBO_SYNC_QUEUE_NAME } from '../../../common/qbo-sync-queue';

@Module({
  imports: [BullModule.registerQueue({ name: QBO_SYNC_QUEUE_NAME }, { name: 'qbo-cdc' })],
  controllers: [QboInboundController],
  providers: [QboInboundService, QboCdcProcessor, QboSyncProcessor],
  exports: [QboInboundService],
})
export class QboInboundModule {}
