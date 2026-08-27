import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDateOnly, isDateOnlyBeforeToday } from './date-only';

test('keeps a west-of-UTC date-only due date on its local calendar day', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';

  try {
    const localToday = new Date(2026, 7, 26, 12);
    assert.equal(formatDateOnly('2026-08-26T00:00:00.000Z'), '8/26/2026');
    assert.equal(isDateOnlyBeforeToday('2026-08-26T00:00:00.000Z', localToday), false);
    assert.equal(isDateOnlyBeforeToday('2026-08-25T00:00:00.000Z', localToday), true);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('accepts four-digit years below 100 without remapping them to the twentieth century', () => {
  const today = new Date(2026, 7, 26, 12);

  assert.notEqual(formatDateOnly('0000-01-01'), '—');
  assert.notEqual(formatDateOnly('0099-12-31'), '—');
  assert.equal(isDateOnlyBeforeToday('0000-01-01', today), true);
  assert.equal(isDateOnlyBeforeToday('0099-12-31', today), true);
  assert.equal(isDateOnlyBeforeToday('0099-02-29', today), false);
});
