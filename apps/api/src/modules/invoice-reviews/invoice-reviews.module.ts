import { Module } from '@nestjs/common';
import { InvoiceReviewsController } from './invoice-reviews.controller';
import { InvoiceReviewsService } from './invoice-reviews.service';

@Module({
  controllers: [InvoiceReviewsController],
  providers: [InvoiceReviewsService],
  exports: [InvoiceReviewsService],
})
export class InvoiceReviewsModule {}
