import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  WorkflowExecutionService,
  workflowEscalationJobDataSchema,
  type WorkflowEscalationJobData,
} from './workflow-execution.service';

@Processor('workflow-escalation')
export class WorkflowEscalationProcessor extends WorkerHost {
  constructor(private readonly workflows: WorkflowExecutionService) {
    super();
  }

  process(job: Job<WorkflowEscalationJobData>): Promise<void> {
    return this.workflows.handleEscalation(workflowEscalationJobDataSchema.parse(job.data));
  }
}
