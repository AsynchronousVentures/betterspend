import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  WorkflowExecutionService,
  workflowQueueJobDataSchema,
  type WorkflowQueueJobData,
} from './workflow-execution.service';

@Processor('workflow-escalation')
export class WorkflowEscalationProcessor extends WorkerHost {
  constructor(private readonly workflows: WorkflowExecutionService) {
    super();
  }

  process(job: Job<WorkflowQueueJobData>): Promise<void> {
    const data = workflowQueueJobDataSchema.parse(job.data);
    if (data.kind === 'publication') {
      return this.workflows.handleRuntimePublication(data.publicationId);
    }
    return this.workflows.handleEscalation(data);
  }
}
