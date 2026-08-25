import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExecutableStep } from '@betterspend/shared';
import {
  evaluateWorkflowCondition,
  evaluateWorkflowQuorum,
  requiredWorkflowApprovals,
  selectWorkflowTransition,
} from './workflow-runtime';

describe('workflow runtime', () => {
  it('evaluates nested conditions against a dotted immutable context', () => {
    assert.equal(
      evaluateWorkflowCondition(
        {
          operator: 'AND',
          conditions: [
            { field: 'request.totalAmount', operator: '>=', value: 1_000 },
            { field: 'request.priority', operator: 'eq', value: 'high' },
          ],
        },
        { request: { totalAmount: '1250.00', priority: 'high' } },
      ),
      true,
    );
  });

  it('uses compiled priority order and falls back deterministically', () => {
    const step = {
      node: {
        id: 'condition',
        name: 'Route spend',
        type: 'condition',
        disabled: false,
        config: { mode: 'first_true' },
      },
      transitions: [
        {
          edgeId: 'high',
          targetStepId: 'director',
          sourceHandle: 'branch',
          condition: { field: 'amount', operator: '>=', value: 10_000 },
          priority: 1,
          isDefault: false,
        },
        {
          edgeId: 'default',
          targetStepId: 'manager',
          sourceHandle: 'default',
          isDefault: true,
        },
      ],
    } satisfies ExecutableStep;

    assert.equal(selectWorkflowTransition(step, { amount: '12000' })?.targetStepId, 'director');
    assert.equal(selectWorkflowTransition(step, { amount: '500' })?.targetStepId, 'manager');
  });

  it('calculates all, count, and majority quorum sizes', () => {
    assert.equal(requiredWorkflowApprovals({ type: 'all' }, 4), 4);
    assert.equal(requiredWorkflowApprovals({ type: 'count', count: 2 }, 4), 2);
    assert.equal(requiredWorkflowApprovals({ type: 'majority' }, 4), 3);
  });

  it('advances serial assignments until quorum and rejects impossible quorum', () => {
    assert.deepEqual(
      evaluateWorkflowQuorum('serial', { type: 'count', count: 3 }, [
        { sequence: 1, status: 'approved' },
        { sequence: 2, status: 'pending' },
        { sequence: 3, status: 'waiting' },
      ]),
      { state: 'pending', nextSequence: 3 },
    );
    assert.deepEqual(
      evaluateWorkflowQuorum('parallel', { type: 'majority' }, [
        { sequence: 1, status: 'approved' },
        { sequence: 2, status: 'rejected' },
        { sequence: 3, status: 'rejected' },
      ]),
      { state: 'rejected', nextSequence: null },
    );
  });
});
