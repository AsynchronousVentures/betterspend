import { Module } from '@nestjs/common';
import { SoftwareLicensesController } from './software-licenses.controller';
import { SoftwareLicensesService } from './software-licenses.service';
import { RequisitionsModule } from '../requisitions/requisitions.module';
import { RfqModule } from '../rfq/rfq.module';
import { ArtifactIdempotencyModule } from '../artifact-idempotency/artifact-idempotency.module';

@Module({
  imports: [RequisitionsModule, RfqModule, ArtifactIdempotencyModule],
  controllers: [SoftwareLicensesController],
  providers: [SoftwareLicensesService],
  exports: [SoftwareLicensesService],
})
export class SoftwareLicensesModule {}
