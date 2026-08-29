import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  availableNodeDefinitions,
  assertWorkflowNodeConfigFields,
  workflowNodeConfigSchemaKeys,
  WORKFLOW_NODE_REGISTRY,
} from './workflow-node-registry';
import { WORKFLOW_NODE_DOMAINS } from '@betterspend/shared';

describe('workflow node registry configuration', () => {
  it('declares an editor field for every node configuration property', () => {
    assert.doesNotThrow(() => assertWorkflowNodeConfigFields());
    for (const definition of Object.values(WORKFLOW_NODE_REGISTRY)) {
      assert.deepEqual(
        definition.configFields.map((field) => field.path.split('.')[0]).sort(),
        workflowNodeConfigSchemaKeys(definition),
      );
    }
  });

  it('uses the shared runtime domain catalog for the manual palette', () => {
    for (const definition of Object.values(WORKFLOW_NODE_REGISTRY)) {
      assert.equal(definition.domains, WORKFLOW_NODE_DOMAINS[definition.type]);
    }
  });

  it('keeps runtime-unsupported steps and branch modes out of creation controls', () => {
    const available = availableNodeDefinitions('requisition').map((definition) => definition.type);
    const condition = WORKFLOW_NODE_REGISTRY.condition.configFields.find(
      (field) => field.path === 'mode',
    );

    assert.ok(!available.includes('collect_form'));
    assert.ok(!available.includes('notify'));
    assert.ok(condition?.kind === 'select');
    assert.deepEqual(condition.options, [{ value: 'first_true', label: 'First match' }]);
  });
});
