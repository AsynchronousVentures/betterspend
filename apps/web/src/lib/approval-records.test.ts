import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatApprovalAmount } from './approval-records';

describe('approval record amount formatting', () => {
  it('uses the stored currency for non-USD approval amounts', () => {
    assert.equal(formatApprovalAmount('1250.5', 'EUR'), '€1,250.50');
    assert.equal(formatApprovalAmount('1250.5', 'GBP'), '£1,250.50');
    assert.equal(formatApprovalAmount('1.234', 'BHD'), 'BHD\u00a01.234');
  });

  it('does not silently substitute USD when a currency code is invalid', () => {
    assert.equal(formatApprovalAmount('1250.5', 'XXX-NOT-A-CURRENCY'), '1250.50 XXX-NOT-A-CURRENCY');
  });
});
