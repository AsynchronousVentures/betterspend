import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
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
});
