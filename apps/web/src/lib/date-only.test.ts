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
