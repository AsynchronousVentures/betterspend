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

  it('accepts a compatible typed connection', () => {
    const compatibleDraft: WorkflowDraft = {
      ...draft,
      graph: {
        ...draft.graph,
        nodes: [
          ...draft.graph.nodes,
          {
            id: 'resolver',
            name: 'Manager approval',
            type: 'resolver',
            disabled: false,
            config: {
              resolvers: [{ type: 'manager_chain', maxLevels: 10 }],
              separationOfDuties: { enabled: false, exclude: [], fallbackResolvers: [] },
            },
          },
        ],
      },
    };

    assert.equal(
      isValidWorkflowConnection(compatibleDraft, {
        source: 'resolver',
        sourceHandle: 'out',
        target: 'approved',
        targetHandle: 'in',
      }),
      true,
    );
  });

  it('increments the local revision and refuses a stale assistant proposal', () => {
    const store = useWorkflowBuilderStore.getState();
    const proposalRevision = store.draftRevision;
    store.setAssistantProposal({
      draftRevision: proposalRevision,
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

    assert.equal(useWorkflowBuilderStore.getState().draftRevision, proposalRevision + 1);
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
      draftRevision: store.draftRevision,
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

  it('advances identity on authoritative load and rejects a late proposal for the old draft', () => {
    const store = useWorkflowBuilderStore.getState();
    const oldRevision = store.draftRevision;
    const lateProposal = {
      draftRevision: oldRevision,
      snapshot: { graph: draft.graph, positions: draft.positions },
      response: {
        summary: 'Rename the terminal step.',
        operations: [
          {
            type: 'update_node' as const,
            nodeId: 'approved',
            node: {
              id: 'approved',
              name: 'Completed',
              type: 'approved' as const,
              disabled: false,
              config: {},
            },
          },
        ],
        validation: { valid: true as const, issues: [] },
      },
    };

    store.loadDraft({
      ...draft,
      graph: {
        ...draft.graph,
        nodes: draft.graph.nodes.map((node) =>
          node.id === 'approved' ? { ...node, name: 'Restored approval' } : node,
        ),
      },
    });
    assert.ok(useWorkflowBuilderStore.getState().draftRevision > oldRevision);
    assert.equal(useWorkflowBuilderStore.getState().assistantProposal, null);

    useWorkflowBuilderStore.getState().setAssistantProposal(lateProposal);
    assert.equal(useWorkflowBuilderStore.getState().applyAssistantProposal(), false);
    assert.equal(
      useWorkflowBuilderStore.getState().draft?.graph.nodes.find((node) => node.id === 'approved')
        ?.name,
      'Restored approval',
    );
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

  it('refuses to insert a node outside the workflow domain', () => {
    const before = useWorkflowBuilderStore.getState().draft;

    assert.equal(
      useWorkflowBuilderStore.getState().insertNodeOnEdge('trigger-to-approved', 'match_check'),
      null,
    );
    assert.deepEqual(useWorkflowBuilderStore.getState().draft, before);
  });

  it('selects a new condition branch for explicit configuration instead of inventing criteria', () => {
    const branchingDraft: WorkflowDraft = {
      graph: {
        schemaVersion: 1,
        domain: 'requisition',
        entryNodeId: 'trigger',
        nodes: [
          draft.graph.nodes[0]!,
          {
            id: 'condition',
            name: 'Route request',
            type: 'condition',
            disabled: false,
            config: { mode: 'first_true' },
          },
          draft.graph.nodes[1]!,
          {
            id: 'rejected',
            name: 'Rejected',
            type: 'reject',
            disabled: false,
            config: { reasonRequired: true },
          },
        ],
        edges: [
          {
            id: 'to-condition',
            sourceNodeId: 'trigger',
            sourceHandle: 'out',
            targetNodeId: 'condition',
            targetHandle: 'in',
            isDefault: false,
          },
          {
            id: 'default-reject',
            sourceNodeId: 'condition',
            sourceHandle: 'default',
            targetNodeId: 'rejected',
            targetHandle: 'in',
            isDefault: true,
          },
        ],
      },
      positions: {},
      notes: [],
    };
    useWorkflowBuilderStore.getState().loadDraft(branchingDraft);

    const edgeId = useWorkflowBuilderStore.getState().connect({
      source: 'condition',
      sourceHandle: 'branch',
      target: 'approved',
      targetHandle: 'in',
    });
    const added = useWorkflowBuilderStore
      .getState()
      .draft?.graph.edges.find((edge) => edge.id === edgeId);

    assert.ok(added);
    assert.equal(added.condition, undefined);
    assert.deepEqual(useWorkflowBuilderStore.getState().selection, { kind: 'edge', id: edgeId });

    assert.equal(
      useWorkflowBuilderStore.getState().replaceEdge({
        ...added,
        condition: { field: 'departmentId', operator: 'eq', value: 'finance' },
        priority: 0,
      }),
      true,
    );
    assert.deepEqual(
      useWorkflowBuilderStore.getState().draft?.graph.edges.find((edge) => edge.id === edgeId)
        ?.condition,
      { field: 'departmentId', operator: 'eq', value: 'finance' },
    );
  });
});
