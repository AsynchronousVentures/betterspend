import { Module } from '@nestjs/common';
import { RequisitionTemplatesController } from './requisition-templates.controller';
import { RequisitionTemplatesService } from './requisition-templates.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [RequisitionTemplatesController],
  providers: [RequisitionTemplatesService],
  exports: [RequisitionTemplatesService],
})
export class RequisitionTemplatesModule {}
