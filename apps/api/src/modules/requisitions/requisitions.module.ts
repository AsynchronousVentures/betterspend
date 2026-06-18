import { Module } from '@nestjs/common';
import { RequisitionsController } from './requisitions.controller';
import { RequisitionsService } from './requisitions.service';
import { AiRequisitionService } from './ai-requisition.service';
import { ApprovalsModule } from '../approvals/approvals.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { SpendGuardModule } from '../spend-guard/spend-guard.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';

@Module({
  imports: [ApprovalsModule, BudgetsModule, SpendGuardModule, AiProvidersModule],
  controllers: [RequisitionsController],
  providers: [RequisitionsService, AiRequisitionService],
  exports: [RequisitionsService, AiRequisitionService],
})
export class RequisitionsModule {}
