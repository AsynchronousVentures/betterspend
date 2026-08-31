import { Module } from '@nestjs/common';
import { InvoiceReviewsController } from './invoice-reviews.controller';
import { InvoiceReviewProvenanceService } from './invoice-review-provenance.service';
import { InvoiceReviewsService } from './invoice-reviews.service';

@Module({
  controllers: [InvoiceReviewsController],
  providers: [InvoiceReviewProvenanceService, InvoiceReviewsService],
  exports: [InvoiceReviewProvenanceService, InvoiceReviewsService],
})
export class InvoiceReviewsModule {}
