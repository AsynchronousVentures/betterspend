import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateInvoiceLineAmounts } from './invoice-money';

describe('calculateInvoiceLineAmounts', () => {
  it('rounds exclusive tax half up using scaled decimals', () => {
    assert.deepEqual(calculateInvoiceLineAmounts('3.00', '19.99', '7.25', false), {
      subtotal: '59.97',
      taxAmount: '4.35',
      totalAmount: '64.32',
    });
  });

  it('backs tax out of an inclusive total without floating-point drift', () => {
    assert.deepEqual(calculateInvoiceLineAmounts('1.00', '10.00', '8.25', true), {
      subtotal: '9.24',
      taxAmount: '0.76',
      totalAmount: '10.00',
    });
  });
});
