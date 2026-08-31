import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CommonServicesModule } from '../../common/services/common-services.module';
import { SettingsModule } from '../settings/settings.module';
import { InvoiceReviewsController } from './invoice-reviews.controller';
import { InvoiceReviewCommands } from './invoice-review-commands';
import { InvoiceReviewNotificationProcessor } from './invoice-review-notification.processor';
import {
  INVOICE_REVIEW_DELIVERY_QUEUE,
  InvoiceReviewDeliveries,
} from './invoice-review-deliveries.service';
import { InvoiceReviewProvenanceService } from './invoice-review-provenance.service';
import { InvoiceReviewsService } from './invoice-reviews.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: INVOICE_REVIEW_DELIVERY_QUEUE }),
    CommonServicesModule,
    SettingsModule,
  ],
  controllers: [InvoiceReviewsController],
  providers: [
    InvoiceReviewProvenanceService,
    InvoiceReviewsService,
    InvoiceReviewCommands,
    InvoiceReviewDeliveries,
    InvoiceReviewNotificationProcessor,
  ],
  exports: [InvoiceReviewProvenanceService, InvoiceReviewsService, InvoiceReviewCommands],
})
export class InvoiceReviewsModule {}
