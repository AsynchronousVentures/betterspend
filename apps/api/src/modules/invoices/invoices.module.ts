import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { MatchingService } from './matching.service';
import { BudgetsModule } from '../budgets/budgets.module';
import { EntitiesModule } from '../entities/entities.module';

@Module({
  imports: [BudgetsModule, EntitiesModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, MatchingService],
  exports: [InvoicesService, MatchingService],
})
export class InvoicesModule {}
