import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PdfService } from './pdf.service';
import { ContractComplianceService } from './contract-compliance.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, PdfService, ContractComplianceService],
  exports: [PurchaseOrdersService, ContractComplianceService],
})
export class PurchaseOrdersModule {}
