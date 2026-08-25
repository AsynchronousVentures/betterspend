import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { ApprovalEngineService } from './approval-engine.service';
import { ApprovalDelegationsModule } from '../approval-delegations/approval-delegations.module';
import { SettingsModule } from '../settings/settings.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { WorkflowExecutionModule } from '../workflow-execution/workflow-execution.module';

@Module({
  imports: [ApprovalDelegationsModule, SettingsModule, BudgetsModule, WorkflowExecutionModule],
  controllers: [ApprovalsController],
  providers: [ApprovalEngineService],
  exports: [ApprovalEngineService],
})
export class ApprovalsModule {}
