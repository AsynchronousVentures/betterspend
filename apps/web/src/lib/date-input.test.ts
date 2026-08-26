import assert from 'node:assert/strict';
import test from 'node:test';
import { localDateInputValue } from './date-input';

test('formats a date input from local calendar components', () => {
  assert.equal(localDateInputValue(new Date(2026, 7, 24, 23, 30)), '2026-08-24');
});
