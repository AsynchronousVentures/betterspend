import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { WorkflowDraft } from '@betterspend/shared';
import { isValidWorkflowConnection, useWorkflowBuilderStore } from './workflow-store';

const draft: WorkflowDraft = {
  graph: {
    schemaVersion: 1,
    domain: 'requisition',
    entryNodeId: 'trigger',
    nodes: [
      {
        id: 'trigger',
        name: 'Submitted',
        type: 'trigger',
        disabled: false,
        config: { event: 'requisition_submitted' },
      },
      {
        id: 'approved',
        name: 'Approved',
        type: 'approved',
        disabled: false,
        config: {},
      },
    ],
    edges: [
      {
        id: 'trigger-to-approved',
        sourceNodeId: 'trigger',
        sourceHandle: 'out',
        targetNodeId: 'approved',
        targetHandle: 'in',
        isDefault: false,
      },
    ],
  },
  positions: { trigger: { x: 0, y: 0 }, approved: { x: 400, y: 0 } },
  notes: [],
};

describe('workflow builder store', () => {
  beforeEach(() => useWorkflowBuilderStore.getState().loadDraft(draft));

  it('rejects duplicate and invalid typed connections', () => {
    assert.equal(
      isValidWorkflowConnection(draft, {
        source: 'trigger',
        sourceHandle: 'out',
        target: 'approved',
        targetHandle: 'in',
      }),
      false,
    );
    assert.equal(
      isValidWorkflowConnection(draft, {
        source: 'approved',
        sourceHandle: 'out',
        target: 'trigger',
        targetHandle: 'in',
      }),
      false,
    );
  });

  it('increments the local revision and refuses a stale assistant proposal', () => {
    const store = useWorkflowBuilderStore.getState();
    store.setAssistantProposal({
      draftRevision: 0,
      snapshot: { graph: draft.graph, positions: draft.positions },
      response: {
        summary: 'Rename the terminal step.',
        operations: [
          {
            type: 'update_node',
            nodeId: 'approved',
            node: {
              id: 'approved',
              name: 'Completed',
              type: 'approved',
              disabled: false,
              config: {},
            },
          },
        ],
        validation: { valid: true, issues: [] },
      },
    });
    store.addNote({ x: 100, y: 100 });

    assert.equal(useWorkflowBuilderStore.getState().draftRevision, 1);
    assert.equal(useWorkflowBuilderStore.getState().applyAssistantProposal(), false);
    assert.equal(
      useWorkflowBuilderStore.getState().draft?.graph.nodes.find((node) => node.id === 'approved')
        ?.name,
      'Approved',
    );
  });

  it('refuses an assistant proposal that does not pass graph validation', () => {
    const store = useWorkflowBuilderStore.getState();
    store.setAssistantProposal({
      draftRevision: 0,
      snapshot: { graph: draft.graph, positions: draft.positions },
      response: {
        summary: 'Remove the terminal step.',
        operations: [{ type: 'remove_node', nodeId: 'approved' }],
        validation: {
          valid: false,
          issues: [
            {
              code: 'dead_end',
              message: 'Workflow requires a terminal node',
              path: ['nodes'],
            },
          ],
        },
      },
    });

    assert.equal(store.applyAssistantProposal(), false);
    assert.equal(useWorkflowBuilderStore.getState().draft?.graph.nodes.length, 2);
  });

  it('inserts a one-output node without changing the edge endpoints', () => {
    const insertedId = useWorkflowBuilderStore
      .getState()
      .insertNodeOnEdge('trigger-to-approved', 'resolver');
    const next = useWorkflowBuilderStore.getState().draft;

    assert.ok(insertedId);
    assert.equal(next?.graph.nodes.length, 3);
    assert.equal(next?.graph.edges.length, 2);
    assert.equal(next?.graph.edges[0]?.sourceNodeId, 'trigger');
    assert.equal(next?.graph.edges[0]?.targetNodeId, insertedId);
    assert.equal(next?.graph.edges[1]?.sourceNodeId, insertedId);
    assert.equal(next?.graph.edges[1]?.targetNodeId, 'approved');
  });
});
