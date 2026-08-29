import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { workflowGraphSchema } from './graph';
import { compileWorkflowGraph } from './compile';

function graphWithDisabledStep() {
  return workflowGraphSchema.parse({
    schemaVersion: 1,
    domain: 'invoice',
    entryNodeId: 'start',
    nodes: [
      {
        id: 'start',
        name: 'Invoice submitted',
        type: 'trigger',
        config: { event: 'invoice_submitted' },
      },
      {
        id: 'notice',
        name: 'Disabled notice',
        type: 'notify',
        disabled: true,
        config: {
          channels: ['email'],
          recipients: [{ type: 'role', role: 'finance' }],
          message: 'Review invoice',
        },
      },
      { id: 'approved', name: 'Approved', type: 'approved', config: {} },
    ],
    edges: [
      {
        id: 'to-notice',
        sourceNodeId: 'start',
        sourceHandle: 'out',
        targetNodeId: 'notice',
        targetHandle: 'in',
      },
      {
        id: 'to-approved',
        sourceNodeId: 'notice',
        sourceHandle: 'out',
        targetNodeId: 'approved',
        targetHandle: 'in',
      },
    ],
  });
}

describe('compileWorkflowGraph', () => {
  it('produces ordered enabled steps and bypasses disabled nodes', () => {
    const result = compileWorkflowGraph(graphWithDisabledStep());

    assert.equal(result.success, true);
    if (!result.success) return;
    assert.deepEqual(
      result.executable.steps.map((step) => step.node.id),
      ['start', 'approved'],
    );
    assert.deepEqual(result.executable.steps[0]?.transitions, [
      {
        edgeId: 'to-notice',
        targetStepId: 'approved',
        sourceHandle: 'out',
        isDefault: false,
      },
    ]);
  });

  it('returns publish-blocking validation issues instead of an artifact', () => {
    const graph = graphWithDisabledStep();
    graph.edges = [];

    const result = compileWorkflowGraph(graph);

    assert.equal(result.success, false);
    if (result.success) return;
    assert.ok(result.issues.some((issue) => issue.code === 'unreachable_node'));
  });

  it('does not compile enabled notify nodes until runtime support exists', () => {
    const graph = graphWithDisabledStep();
    const notice = graph.nodes.find((node) => node.id === 'notice');
    assert.ok(notice);
    notice.disabled = false;

    const result = compileWorkflowGraph(graph);

    assert.equal(result.success, false);
    if (result.success) return;
    assert.ok(result.issues.some((issue) => issue.code === 'runtime_unsupported'));
  });
});
