import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PdfService } from './pdf.service';
import { ContractComplianceService } from './contract-compliance.service';
import { SettingsModule } from '../settings/settings.module';
import { EntitiesModule } from '../entities/entities.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { RiskScreeningModule } from '../risk-screening/risk-screening.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [
    SettingsModule,
    EntitiesModule,
    ExchangeRatesModule,
    RiskScreeningModule,
    BudgetsModule,
    ApprovalsModule,
  ],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, PdfService, ContractComplianceService],
  exports: [PurchaseOrdersService, ContractComplianceService],
})
export class PurchaseOrdersModule {}
