import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateInvoiceSchema } from './invoices';

const LINE_ID = '00000000-0000-4000-8000-000000000001';

describe('updateInvoiceSchema', () => {
  it('accepts precise invoice edits and normalizes currency', () => {
    assert.deepEqual(
      updateInvoiceSchema.parse({
        currency: 'usd',
        lines: [{ id: LINE_ID, quantity: 2.25, unitPrice: 19.99 }],
      }),
      {
        currency: 'USD',
        lines: [{ id: LINE_ID, quantity: 2.25, unitPrice: 19.99 }],
      },
    );
  });

  it('rejects invalid dates, excess monetary precision, and fractional line numbers', () => {
    assert.equal(updateInvoiceSchema.safeParse({ invoiceDate: '2026-02-30' }).success, false);
    assert.equal(
      updateInvoiceSchema.safeParse({ lines: [{ id: LINE_ID, unitPrice: 2.675 }] }).success,
      false,
    );
    assert.equal(
      updateInvoiceSchema.safeParse({ lines: [{ id: LINE_ID, lineNumber: 1.1 }] }).success,
      false,
    );
  });

  it('rejects wrong JSON shapes before they reach invoice persistence', () => {
    assert.equal(updateInvoiceSchema.safeParse({ currency: {} }).success, false);
    assert.equal(updateInvoiceSchema.safeParse({ lines: {} }).success, false);
    assert.equal(updateInvoiceSchema.safeParse({}).success, false);
  });
});
