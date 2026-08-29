import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowEdge } from '@betterspend/shared';
import { buildWorkflowConditionEdge, workflowEdgeLabel } from './workflow-edge-config';

const edge: WorkflowEdge = {
  id: 'route',
  sourceNodeId: 'condition',
  sourceHandle: 'branch',
  targetNodeId: 'approved',
  targetHandle: 'in',
  isDefault: false,
};

describe('workflow condition edge editor', () => {
  it('builds typed amount, department, and currency routes', () => {
    const amount = buildWorkflowConditionEdge({
      edge,
      defaultRoute: false,
      field: 'totalAmount',
      operator: '>=',
      rawValue: '25000',
      priority: 0,
    });
    const department = buildWorkflowConditionEdge({
      edge,
      defaultRoute: false,
      field: 'departmentId',
      operator: 'eq',
      rawValue: 'finance',
      priority: 1,
    });
    const currency = buildWorkflowConditionEdge({
      edge,
      defaultRoute: false,
      field: 'currency',
      operator: 'eq',
      rawValue: 'usd',
      priority: 2,
    });

    assert.equal(conditionValue(amount), 25_000);
    assert.equal(conditionValue(department), 'finance');
    assert.equal(conditionValue(currency), 'USD');
  });

  it('turns a condition route into an explicit default without stale criteria', () => {
    const result = buildWorkflowConditionEdge({
      edge: {
        ...edge,
        condition: { field: 'totalAmount', operator: '>=', value: 1_000 },
        priority: 0,
      },
      defaultRoute: true,
      field: 'totalAmount',
      operator: '>=',
      rawValue: '1000',
      priority: 0,
    });

    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.edge.sourceHandle, 'default');
    assert.equal(result.edge.isDefault, true);
    assert.equal(result.edge.condition, undefined);
    assert.equal(result.edge.priority, undefined);
  });

  it('describes condition and default routes on the canvas', () => {
    assert.equal(
      workflowEdgeLabel({
        ...edge,
        condition: { field: 'totalAmount', operator: '>=', value: 25_000 },
      }),
      'Amount is at least 25000',
    );
    assert.equal(
      workflowEdgeLabel({ ...edge, sourceHandle: 'default', isDefault: true }),
      'Default',
    );
  });
});

function conditionValue(result: ReturnType<typeof buildWorkflowConditionEdge>) {
  assert.equal(result.success, true);
  if (!result.success) return undefined;
  assert.ok(result.edge.condition && 'field' in result.edge.condition);
  return result.edge.condition.value;
}
