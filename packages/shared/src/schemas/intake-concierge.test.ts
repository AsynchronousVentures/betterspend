import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { intakeConciergeConversionSchema } from './intake-concierge';

describe('intakeConciergeConversionSchema', () => {
  it('accepts a real calendar date for a routing deadline', () => {
    assert.equal(
      intakeConciergeConversionSchema.safeParse({
        acceptedValues: { neededBy: '2026-02-28' },
      }).success,
      true,
    );
  });

  it('rejects a normalized calendar overflow', () => {
    assert.equal(
      intakeConciergeConversionSchema.safeParse({
        acceptedValues: { neededBy: '2026-02-30' },
      }).success,
      false,
    );
  });
});
