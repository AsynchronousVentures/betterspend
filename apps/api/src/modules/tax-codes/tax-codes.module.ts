import { Module } from '@nestjs/common';
import { TaxCodesController } from './tax-codes.controller';
import { TaxCodesService } from './tax-codes.service';

@Module({
  controllers: [TaxCodesController],
  providers: [TaxCodesService],
  exports: [TaxCodesService],
})
export class TaxCodesModule {}
