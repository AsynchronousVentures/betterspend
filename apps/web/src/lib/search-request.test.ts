import assert from 'node:assert/strict';
import test from 'node:test';
import { createSearchRequestController } from './search-request';

test('only the latest search request may commit results', () => {
  const controller = createSearchRequestController();
  const applied: string[] = [];
  const commit = (requestId: number, result: string) => {
    if (controller.isCurrent(requestId)) applied.push(result);
  };

  const olderRequest = controller.begin();
  const latestRequest = controller.begin();
  commit(olderRequest, 'older');
  commit(latestRequest, 'latest');

  assert.deepEqual(applied, ['latest']);
});

test('invalidating a search prevents its response from committing', () => {
  const controller = createSearchRequestController();
  const requestId = controller.begin();
  controller.invalidate();

  assert.equal(controller.isCurrent(requestId), false);
});
