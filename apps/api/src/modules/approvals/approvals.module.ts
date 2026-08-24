import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { ApprovalEngineService } from './approval-engine.service';
import { ApprovalDelegationsModule } from '../approval-delegations/approval-delegations.module';
import { SettingsModule } from '../settings/settings.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { WorkflowDefinitionsModule } from '../workflow-definitions/workflow-definitions.module';

@Module({
  imports: [
    ApprovalDelegationsModule,
    SettingsModule,
    BudgetsModule,
    WorkflowDefinitionsModule,
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalEngineService],
  exports: [ApprovalEngineService],
})
export class ApprovalsModule {}
