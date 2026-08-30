import assert from 'node:assert/strict';
import test from 'node:test';
import { sortUniqueIdsForLocking } from './users.service';

test('sortUniqueIdsForLocking returns deterministic unique identities', () => {
  assert.deepEqual(sortUniqueIdsForLocking(['user-3', 'user-1', 'user-2', 'user-1', 'user-3']), [
    'user-1',
    'user-2',
    'user-3',
  ]);
});
