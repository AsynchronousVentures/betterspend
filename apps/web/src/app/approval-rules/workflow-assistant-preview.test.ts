import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowAssistantSnapshot, WorkflowGraphPatchOperation } from '@betterspend/shared';
import { buildWorkflowPatchPreview } from './workflow-assistant-preview';

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
      { id: 'approved', name: 'Approved', type: 'approved', disabled: false, config: {} },
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
  positions: {},
};

describe('workflow assistant patch preview', () => {
  it('shows typed before and after values, including configuration changes', () => {
    const [item] = buildWorkflowPatchPreview(snapshot, [
      {
        type: 'update_node',
        nodeId: 'approved',
        node: {
          id: 'approved',
          name: 'Auto-approved',
          type: 'auto_approve',
          disabled: false,
          config: { reason: 'Below threshold' },
        },
      },
    ]);

    assert.match(item?.before ?? '', /"name":"Approved"/);
    assert.match(item?.after ?? '', /"reason":"Below threshold"/);
  });

  it('calls out edges removed as a consequence of deleting a node', () => {
    const [item] = buildWorkflowPatchPreview(snapshot, [
      { type: 'remove_node', nodeId: 'approved' },
    ]);

    assert.match(item?.consequence ?? '', /trigger-to-approved/);
  });

  it('previews every typed patch operation', () => {
    const rejected = {
      id: 'rejected',
      name: 'Rejected',
      type: 'reject' as const,
      disabled: false,
      config: { reasonRequired: true },
    };
    const route = {
      id: 'trigger-to-rejected',
      sourceNodeId: 'trigger',
      sourceHandle: 'out',
      targetNodeId: 'rejected',
      targetHandle: 'in',
      isDefault: false,
    };
    const operations: WorkflowGraphPatchOperation[] = [
      { type: 'add_node', node: rejected, position: { x: 400, y: 120 } },
      {
        type: 'update_node',
        nodeId: 'approved',
        node: { ...snapshot.graph.nodes[1]!, name: 'Completed' },
      },
      { type: 'remove_node', nodeId: 'approved' },
      { type: 'add_edge', edge: route },
      { type: 'update_edge', edgeId: route.id, edge: { ...route, isDefault: true } },
      { type: 'remove_edge', edgeId: route.id },
      { type: 'set_entry', nodeId: rejected.id },
    ];

    const preview = buildWorkflowPatchPreview(snapshot, operations);

    assert.deepEqual(
      preview.map(({ action, subject }) => `${action} ${subject}`),
      [
        'Add node',
        'Update node',
        'Remove node',
        'Add edge',
        'Update edge',
        'Remove edge',
        'Set entry',
      ],
    );
    assert.match(preview[4]?.before ?? '', /trigger\.out -> rejected\.in/);
    assert.equal(preview[6]?.before, 'trigger');
    assert.equal(preview[6]?.after, 'rejected');
  });
});
