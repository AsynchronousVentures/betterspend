import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { overallInvoiceMatchStatus } from './matching.service';

describe('overallInvoiceMatchStatus', () => {
  it('requires at least one invoice line', () => {
    assert.equal(overallInvoiceMatchStatus([]), 'partial_match');
  });

  it('requires positive quantity and a goods receipt line', () => {
    assert.equal(
      overallInvoiceMatchStatus([{ status: 'match', grnLineId: null, invoicedQuantity: 1 }]),
      'partial_match',
    );
    assert.equal(
      overallInvoiceMatchStatus([
        { status: 'match', grnLineId: 'grn-line-1', invoicedQuantity: 0 },
      ]),
      'partial_match',
    );
  });

  it('accepts only fully matched, received positive-quantity lines', () => {
    assert.equal(
      overallInvoiceMatchStatus([
        { status: 'match', grnLineId: 'grn-line-1', invoicedQuantity: 2 },
      ]),
      'full_match',
    );
  });
});
