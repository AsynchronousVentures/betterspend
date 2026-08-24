import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { MatchingService } from './matching.service';
import { BudgetsModule } from '../budgets/budgets.module';
import { EntitiesModule } from '../entities/entities.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { SpendGuardModule } from '../spend-guard/spend-guard.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [BudgetsModule, EntitiesModule, ExchangeRatesModule, SpendGuardModule, SettingsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, MatchingService],
  exports: [InvoicesService, MatchingService],
})
export class InvoicesModule {}
