import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCurrentWorkflowRequest } from './workflow-request-identity';

describe('workflow request identity', () => {
  it('rejects a response from another definition even when revisions match', () => {
    assert.equal(
      isCurrentWorkflowRequest('definition-b', 1, {
        definitionId: 'definition-a',
        requestId: 1,
      }),
      false,
    );
  });

  it('rejects a superseded response for the same definition', () => {
    assert.equal(
      isCurrentWorkflowRequest('definition-a', 2, {
        definitionId: 'definition-a',
        requestId: 1,
      }),
      false,
    );
  });
});
