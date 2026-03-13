import { Module } from '@nestjs/common';
import { EmailIntakeController } from './email-intake.controller';
import { EmailIntakeService } from './email-intake.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [EmailIntakeController],
  providers: [EmailIntakeService],
  exports: [EmailIntakeService],
})
export class EmailIntakeModule {}
