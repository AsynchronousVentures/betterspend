import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowAssistantSnapshot, WorkflowGraphPatchOperation } from './assistant';
import { applyWorkflowGraphPatch } from './assistant';

const snapshot: WorkflowAssistantSnapshot = {
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
  positions: {
    trigger: { x: 0, y: 0 },
    approved: { x: 400, y: 0 },
  },
};

describe('applyWorkflowGraphPatch', () => {
  it('applies typed graph and position operations without mutating the input', () => {
    const operations: WorkflowGraphPatchOperation[] = [
      { type: 'remove_edge', edgeId: 'trigger-to-approved' },
      {
        type: 'add_node',
        node: {
          id: 'manager',
          name: 'Manager approval',
          type: 'resolver',
          disabled: false,
          config: {
            resolvers: [{ type: 'manager_chain', maxLevels: 10 }],
            separationOfDuties: { enabled: false, exclude: [], fallbackResolvers: [] },
          },
        },
        position: { x: 200, y: 0 },
      },
      {
        type: 'add_edge',
        edge: {
          id: 'trigger-to-manager',
          sourceNodeId: 'trigger',
          sourceHandle: 'out',
          targetNodeId: 'manager',
          targetHandle: 'in',
          isDefault: false,
        },
      },
      {
        type: 'add_edge',
        edge: {
          id: 'manager-to-approved',
          sourceNodeId: 'manager',
          sourceHandle: 'out',
          targetNodeId: 'approved',
          targetHandle: 'in',
          isDefault: false,
        },
      },
    ];

    const result = applyWorkflowGraphPatch(snapshot, operations);

    assert.equal(result.graph.nodes.length, 3);
    assert.deepEqual(result.positions.manager, { x: 200, y: 0 });
    assert.deepEqual(
      result.graph.edges.map((edge) => edge.id),
      ['trigger-to-manager', 'manager-to-approved'],
    );
    assert.equal(snapshot.graph.nodes.length, 2);
    assert.equal(snapshot.positions.manager, undefined);
  });

  it('rejects identity changes and references to missing records', () => {
    assert.throws(
      () =>
        applyWorkflowGraphPatch(snapshot, [
          {
            type: 'update_node',
            nodeId: 'approved',
            node: {
              id: 'renamed',
              name: 'Approved',
              type: 'approved',
              disabled: false,
              config: {},
            },
          },
        ]),
      /must remain approved/,
    );
    assert.throws(
      () => applyWorkflowGraphPatch(snapshot, [{ type: 'remove_edge', edgeId: 'missing' }]),
      /missing workflow edge missing/,
    );
  });
});
