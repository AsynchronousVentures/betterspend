import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  calculateRecurringPoAmounts,
  parseRecurringPoCreateInput,
  parseRecurringPoUpdateInput,
} from './recurring-po.input';

const createBody = {
  title: 'Monthly office supplies',
  frequency: 'monthly',
  dayOfMonth: 1,
  totalAmount: '0.30',
  currency: 'usd',
  lines: [{ description: 'Paper clips', quantity: '3', unitPrice: '0.10' }],
};

test('recurring PO input preserves canonical decimals and rounds line totals exactly', () => {
  const input = parseRecurringPoCreateInput(createBody);

  assert.deepEqual(input.lines, [
    { description: 'Paper clips', quantity: '3.00', unitPrice: '0.10' },
  ]);
  assert.equal(input.totalAmount, '0.30');
  assert.equal(input.currency, 'USD');
  assert.deepEqual(calculateRecurringPoAmounts(input.lines), {
    lineTotals: ['0.30'],
    subtotal: '0.30',
  });
});

test('recurring PO input rejects unsafe values and inconsistent totals', () => {
  assert.throws(
    () =>
      parseRecurringPoCreateInput({
        ...createBody,
        totalAmount: '9007199254740993',
      }),
    BadRequestException,
  );
  assert.throws(
    () =>
      parseRecurringPoCreateInput({
        ...createBody,
        lines: [{ description: 'Paper clips', quantity: '1.001', unitPrice: '0.10' }],
      }),
    BadRequestException,
  );
  assert.throws(
    () => parseRecurringPoCreateInput({ ...createBody, totalAmount: '0.29' }),
    /Total amount must equal the line total/,
  );
  assert.throws(
    () => parseRecurringPoUpdateInput({ totalAmount: '1.00' }),
    /Update line items to change the recurring PO total/,
  );
});
