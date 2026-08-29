import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WORKFLOW_NODE_REGISTRY } from './workflow-node-registry';

const expectedConfigPaths = {
  trigger: ['event'],
  condition: ['mode'],
  match_check: [],
  budget_check: ['policy'],
  approver_group: ['execution', 'quorum', 'resolvers', 'separationOfDuties'],
  resolver: ['resolvers', 'separationOfDuties'],
  delegation: ['mode'],
  escalation_timer: ['action', 'parentNodeId', 'slaHours', 'warningPercent'],
  collect_form: ['fields'],
  notify: ['channels', 'message', 'recipients'],
  auto_approve: ['reason'],
  reject: ['defaultReason', 'reasonRequired'],
  approved: [],
} as const;

describe('workflow node registry configuration', () => {
  it('declares an editor field for every node configuration property', () => {
    for (const [type, paths] of Object.entries(expectedConfigPaths)) {
      assert.deepEqual(
        WORKFLOW_NODE_REGISTRY[type as keyof typeof WORKFLOW_NODE_REGISTRY].configFields
          .map((field) => field.path)
          .sort(),
        [...paths].sort(),
      );
    }
  });
});
