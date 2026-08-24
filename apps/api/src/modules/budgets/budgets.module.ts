import { Module } from '@nestjs/common';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { EntitiesModule } from '../entities/entities.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [EntitiesModule, ExchangeRatesModule, SettingsModule],
  controllers: [BudgetsController],
  providers: [BudgetsService],
  exports: [BudgetsService],
})
export class BudgetsModule {}
