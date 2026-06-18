import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

function getRedisConnection() {
  if (!process.env.REDIS_HOST && process.env.REDIS_URL) {
    try {
      const url = new URL(process.env.REDIS_URL);
      return {
        host: url.hostname,
        port: Number(url.port || 6379),
        username: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
      };
    } catch {
      // Fall through to explicit host/port defaults below.
    }
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  };
}

@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: getRedisConnection(),
    }),
    BullModule.registerQueue({ name: 'gl-export' }, { name: 'webhook-delivery' }, { name: 'ocr' }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
