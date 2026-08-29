import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QboInboundController } from './qbo-inbound.controller';
import { QboInboundService } from './qbo-inbound.service';
import { QboCdcProcessor } from './qbo-cdc.processor';
import { QboSyncProcessor } from './qbo-sync.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'qbo-sync-in' }, { name: 'qbo-cdc' })],
  controllers: [QboInboundController],
  providers: [QboInboundService, QboCdcProcessor, QboSyncProcessor],
  exports: [QboInboundService],
})
export class QboInboundModule {}
