import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changedMaterialInvoiceFields, type MaterialInvoiceState } from './invoice-material-edit';

const invoice = (): MaterialInvoiceState => ({
  vendorId: 'vendor-1',
  invoiceDate: '2026-08-24',
  dueDate: '2026-09-24',
  paymentTerms: 'NET30',
  earlyPaymentDiscountPercent: null,
  earlyPaymentDiscountBy: null,
  currency: 'USD',
  exchangeRate: '1.00000000',
  lines: [
    {
      id: 'line-1',
      lineNumber: '1',
      poLineId: 'po-line-1',
      quantity: '1.00',
      unitPrice: '100.00',
      glAccount: '6000',
      taxCodeId: null,
      taxInclusive: false,
    },
  ],
});

describe('invoice material edit classification', () => {
  it('does not restart approval for a description-only edit', () => {
    assert.deepEqual(changedMaterialInvoiceFields(invoice(), invoice()), []);
  });

  it('classifies vendor, payment, currency, amount, and coding changes as material', () => {
    const previous = invoice();
    const next = invoice();
    next.vendorId = 'vendor-2';
    next.dueDate = '2026-10-01';
    next.currency = 'EUR';
    next.lines[0] = {
      ...next.lines[0],
      quantity: '2.00',
      glAccount: '6100',
    };

    assert.deepEqual(changedMaterialInvoiceFields(previous, next), [
      'vendorId',
      'dueDate',
      'currency',
      'lines.quantity',
      'lines.glAccount',
    ]);
  });

  it('does not discard decimal precision when comparing line values', () => {
    const previous = invoice();
    const next = invoice();
    next.lines[0] = { ...next.lines[0], unitPrice: '100.001' };

    assert.deepEqual(changedMaterialInvoiceFields(previous, next), ['lines.unitPrice']);
  });
});
