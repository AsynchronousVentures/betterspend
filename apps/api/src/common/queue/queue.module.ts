import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QBO_SYNC_QUEUE_NAME } from '../qbo-sync-queue';
import { CONTRACT_OBLIGATION_REMINDER_QUEUE_NAME } from '../contract-obligation-reminder-queue';

import { getRedisConnection } from '../redis-connection';
export { getRedisConnection } from '../redis-connection';

@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: getRedisConnection(),
    }),
    BullModule.registerQueue(
      { name: 'gl-export' },
      { name: 'webhook-delivery' },
      { name: 'ocr' },
      { name: 'email-intake' },
      { name: QBO_SYNC_QUEUE_NAME },
      { name: 'qbo-cdc' },
      { name: CONTRACT_OBLIGATION_REMINDER_QUEUE_NAME },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
