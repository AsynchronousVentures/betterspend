import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { ArtifactIdempotencyModule } from '../artifact-idempotency/artifact-idempotency.module';

@Module({
  imports: [NotificationsModule, SettingsModule, ArtifactIdempotencyModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
