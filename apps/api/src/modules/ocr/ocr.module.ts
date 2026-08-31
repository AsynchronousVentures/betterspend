import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OcrService } from './ocr.service';
import { OcrController } from './ocr.controller';
import { OcrProcessor } from './ocr.processor';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { InvoiceReviewsModule } from '../invoice-reviews/invoice-reviews.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'ocr' }), AiProvidersModule, InvoiceReviewsModule],
  controllers: [OcrController],
  providers: [OcrService, OcrProcessor],
  exports: [OcrService],
})
export class OcrModule {}
