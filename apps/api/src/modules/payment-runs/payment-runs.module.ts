import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module';
import { WorkflowExecutionModule } from '../workflow-execution/workflow-execution.module';
import { PaymentRunsController } from './payment-runs.controller';
import { PaymentRunsService } from './payment-runs.service';

@Module({
  imports: [BudgetsModule, WorkflowExecutionModule],
  controllers: [PaymentRunsController],
  providers: [PaymentRunsService],
  exports: [PaymentRunsService],
})
export class PaymentRunsModule {}
