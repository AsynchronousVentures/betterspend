import { Module } from '@nestjs/common';
import { SpendGuardController } from './spend-guard.controller';
import { SpendGuardService } from './spend-guard.service';
import { InvoiceReviewsModule } from '../invoice-reviews/invoice-reviews.module';

@Module({
  imports: [InvoiceReviewsModule],
  controllers: [SpendGuardController],
  providers: [SpendGuardService],
  exports: [SpendGuardService],
})
export class SpendGuardModule {}
