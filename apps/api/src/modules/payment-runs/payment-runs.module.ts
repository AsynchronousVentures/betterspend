import { Module } from '@nestjs/common';
import { PaymentRunsController } from './payment-runs.controller';
import { PaymentRunsService } from './payment-runs.service';

@Module({
  controllers: [PaymentRunsController],
  providers: [PaymentRunsService],
  exports: [PaymentRunsService],
})
export class PaymentRunsModule {}
