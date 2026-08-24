import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailIntakeController } from './email-intake.controller';
import { EmailIntakeProcessor } from './email-intake.processor';
import { EmailIntakeService } from './email-intake.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'email-intake' }),
    NotificationsModule,
    SettingsModule,
  ],
  controllers: [EmailIntakeController],
  providers: [EmailIntakeService, EmailIntakeProcessor],
  exports: [EmailIntakeService],
})
export class EmailIntakeModule {}
