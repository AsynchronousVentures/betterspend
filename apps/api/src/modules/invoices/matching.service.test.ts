import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateInvoiceQuantitiesAndPrice,
  invoiceStatusFromMatchStatus,
  overallInvoiceMatchStatus,
} from './matching.service';

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

describe('invoiceStatusFromMatchStatus', () => {
  it('maps match outcomes to invoice lifecycle statuses', () => {
    assert.equal(invoiceStatusFromMatchStatus('full_match'), 'matched');
    assert.equal(invoiceStatusFromMatchStatus('exception'), 'exception');
    assert.equal(invoiceStatusFromMatchStatus('partial_match'), 'partial_match');
    assert.equal(invoiceStatusFromMatchStatus('unmatched'), 'partial_match');
  });
});

describe('financial matching boundaries', () => {
  const evaluate = (
    overrides: Partial<Parameters<typeof evaluateInvoiceQuantitiesAndPrice>[0]> = {},
  ) =>
    evaluateInvoiceQuantitiesAndPrice({
      invoicePrice: '10.00',
      poPrice: '10.00',
      cumulativeQuantity: '10.00',
      receipts: [{ quantityReceived: '10.00', quantityRejected: '0.00' }],
      ...overrides,
    });

  it('fails closed for positive invoices against free PO lines', () => {
    assert.equal(evaluate({ poPrice: '0.00' }).status, 'exception');
    assert.equal(evaluate({ poPrice: '0.00', invoicePrice: '0.00' }).status, 'match');
  });

  it('uses accepted receipts and rejects missing or fully rejected receipts', () => {
    assert.equal(evaluate({ receipts: [] }).status, 'exception');
    assert.equal(
      evaluate({ receipts: [{ quantityReceived: '10.00', quantityRejected: '10.00' }] }).status,
      'exception',
    );
    assert.equal(
      evaluate({ receipts: [{ quantityReceived: '10.00', quantityRejected: '5.00' }] }).status,
      'exception',
    );
    assert.equal(
      evaluate({
        cumulativeQuantity: '5.00',
        receipts: [{ quantityReceived: '10.00', quantityRejected: '5.00' }],
      }).status,
      'match',
    );
  });

  it('accepts partial billing and rejects cumulative overbilling', () => {
    assert.equal(evaluate({ cumulativeQuantity: '4.00' }).status, 'match');
    assert.equal(evaluate({ cumulativeQuantity: '20.00' }).status, 'exception');
    assert.equal(evaluate({ cumulativeQuantity: '10.50' }).status, 'match');
    assert.equal(evaluate({ cumulativeQuantity: '10.51' }).status, 'within_tolerance');
  });

  it('compares decimal tolerance boundaries exactly', () => {
    assert.equal(evaluate({ poPrice: '0.50', invoicePrice: '0.51' }).priceMatch, true);
    assert.equal(evaluate({ poPrice: '0.50', invoicePrice: '0.52' }).priceMatch, false);
  });
});
