import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowAssistantSnapshot } from '@betterspend/shared';
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
});
