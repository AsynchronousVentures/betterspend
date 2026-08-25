import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REQUIRED_APPROVAL_NODE_ID, workflowNodeIdSchema } from './node-types';

describe('workflowNodeIdSchema', () => {
  it('reserves the synthetic required-approval state for the execution engine', () => {
    assert.throws(() => workflowNodeIdSchema.parse(REQUIRED_APPROVAL_NODE_ID), /reserved/);
    assert.throws(() => workflowNodeIdSchema.parse(`  ${REQUIRED_APPROVAL_NODE_ID}  `), /reserved/);
    assert.equal(workflowNodeIdSchema.parse('department-review'), 'department-review');
  });
});
