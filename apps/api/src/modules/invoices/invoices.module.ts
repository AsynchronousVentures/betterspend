import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { MatchingService } from './matching.service';
import { BudgetsModule } from '../budgets/budgets.module';
import { EntitiesModule } from '../entities/entities.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { SpendGuardModule } from '../spend-guard/spend-guard.module';
import { SettingsModule } from '../settings/settings.module';
import { WorkflowExecutionModule } from '../workflow-execution/workflow-execution.module';
import { InvoiceReviewsModule } from '../invoice-reviews/invoice-reviews.module';

@Module({
  imports: [
    BudgetsModule,
    EntitiesModule,
    ExchangeRatesModule,
    SpendGuardModule,
    SettingsModule,
    WorkflowExecutionModule,
    InvoiceReviewsModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, MatchingService],
  exports: [InvoicesService, MatchingService],
})
export class InvoicesModule {}
