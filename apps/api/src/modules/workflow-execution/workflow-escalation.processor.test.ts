import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Job } from 'bullmq';
import type {
  WorkflowEscalationJobData,
  WorkflowExecutionService,
} from './workflow-execution.service';
import { WorkflowEscalationProcessor } from './workflow-escalation.processor';

const validJob: WorkflowEscalationJobData = {
  organizationId: '00000000-0000-4000-8000-000000000101',
  approvalRequestId: '00000000-0000-4000-8000-000000000201',
  definitionVersionId: '00000000-0000-4000-8000-000000000301',
  parentNodeId: 'review',
  timerNodeId: 'review-timer',
  attempt: 2,
  kind: 'action',
};

describe('WorkflowEscalationProcessor', () => {
  it('rejects malformed queue payloads before they reach the workflow service', () => {
    const calls: unknown[] = [];
    const processor = new WorkflowEscalationProcessor({
      handleEscalation: async (data: unknown) => {
        calls.push(data);
      },
    } as unknown as WorkflowExecutionService);

    assert.throws(
      () =>
        processor.process({
          data: { ...validJob, kind: 'auto_approve', unexpected: true },
        } as unknown as Job<WorkflowEscalationJobData>),
      /Invalid option|Unrecognized key/,
    );
    assert.deepEqual(calls, []);
  });

  it('forwards a strict, validated payload', async () => {
    const calls: unknown[] = [];
    const processor = new WorkflowEscalationProcessor({
      handleEscalation: async (data: unknown) => {
        calls.push(data);
      },
    } as unknown as WorkflowExecutionService);

    await processor.process({ data: validJob } as Job<WorkflowEscalationJobData>);

    assert.deepEqual(calls, [validJob]);
  });
});
