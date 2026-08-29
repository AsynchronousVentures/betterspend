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

  it('does not let a late acquire response replace a newer takeover token', async () => {
    let latestRequestId = 0;
    let committedToken: string | null = null;
    const run = async (requestId: number, token: string, delay: Promise<void>) => {
      await delay;
      if (
        isCurrentWorkflowRequest('definition-a', latestRequestId, {
          definitionId: 'definition-a',
          requestId,
        })
      )
        committedToken = token;
    };
    let finishAcquire: (() => void) | undefined;
    let finishTakeover: (() => void) | undefined;
    const acquireDelay = new Promise<void>((resolve) => {
      finishAcquire = resolve;
    });
    const takeoverDelay = new Promise<void>((resolve) => {
      finishTakeover = resolve;
    });

    const acquire = run(++latestRequestId, 'acquire-token', acquireDelay);
    const takeover = run(++latestRequestId, 'takeover-token', takeoverDelay);
    finishTakeover?.();
    await takeover;
    finishAcquire?.();
    await acquire;

    assert.equal(committedToken, 'takeover-token');
  });
});
