import { Module } from '@nestjs/common';
import { RequisitionsModule } from '../requisitions/requisitions.module';
import { RfqModule } from '../rfq/rfq.module';
import { IntakeConciergeController } from './intake-concierge.controller';
import { IntakeConciergeService } from './intake-concierge.service';

@Module({
  imports: [RequisitionsModule, RfqModule],
  controllers: [IntakeConciergeController],
  providers: [IntakeConciergeService],
  exports: [IntakeConciergeService],
})
export class IntakeConciergeModule {}
