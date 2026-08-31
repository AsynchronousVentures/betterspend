import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { InvoiceReviewsController } from './invoice-reviews.controller';
import { InvoiceReviewCommands } from './invoice-review-commands';
import { InvoiceReviewNotificationProcessor } from './invoice-review-notification.processor';
import {
  INVOICE_REVIEW_NOTIFICATION_QUEUE,
  InvoiceReviewNotificationsService,
} from './invoice-review-notifications.service';
import { InvoiceReviewProvenanceService } from './invoice-review-provenance.service';
import { InvoiceReviewsService } from './invoice-reviews.service';

@Module({
  imports: [BullModule.registerQueue({ name: INVOICE_REVIEW_NOTIFICATION_QUEUE })],
  controllers: [InvoiceReviewsController],
  providers: [
    InvoiceReviewProvenanceService,
    InvoiceReviewsService,
    InvoiceReviewCommands,
    InvoiceReviewNotificationsService,
    InvoiceReviewNotificationProcessor,
  ],
  exports: [InvoiceReviewProvenanceService, InvoiceReviewsService, InvoiceReviewCommands],
})
export class InvoiceReviewsModule {}
