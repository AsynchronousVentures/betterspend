import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { MatchingService } from './matching.service';
import { BudgetsModule } from '../budgets/budgets.module';
import { EntitiesModule } from '../entities/entities.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';

@Module({
  imports: [BudgetsModule, EntitiesModule, ExchangeRatesModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, MatchingService],
  exports: [InvoicesService, MatchingService],
})
export class InvoicesModule {}
