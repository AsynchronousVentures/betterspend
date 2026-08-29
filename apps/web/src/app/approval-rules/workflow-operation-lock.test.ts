import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { beginWorkflowOperation, endWorkflowOperation } from './workflow-operation-lock';

describe('workflow editor operation lock', () => {
  it('blocks a second mutation synchronously before a render can observe busy state', () => {
    const lock = { current: false };

    assert.equal(beginWorkflowOperation(lock), true);
    assert.equal(beginWorkflowOperation(lock), false);

    endWorkflowOperation(lock);
    assert.equal(beginWorkflowOperation(lock), true);
  });
});
