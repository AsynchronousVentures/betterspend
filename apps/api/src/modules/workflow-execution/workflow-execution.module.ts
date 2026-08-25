import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ApprovalDelegationsModule } from '../approval-delegations/approval-delegations.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { SettingsModule } from '../settings/settings.module';
import { WorkflowEscalationProcessor } from './workflow-escalation.processor';
import { WorkflowExecutionService } from './workflow-execution.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'workflow-escalation' }),
    ApprovalDelegationsModule,
    BudgetsModule,
    SettingsModule,
  ],
  providers: [WorkflowExecutionService, WorkflowEscalationProcessor],
  exports: [WorkflowExecutionService],
})
export class WorkflowExecutionModule {}
