import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateRecurringPoAmounts,
  createRecurringPoSchema,
  updateRecurringPoSchema,
} from './recurring-po';

const createBody = {
  title: 'Monthly office supplies',
  frequency: 'monthly',
  dayOfMonth: 1,
  totalAmount: '0.30',
  currency: 'usd',
  startDate: '2028-02-29',
  lines: [{ description: 'Paper clips', quantity: '3', unitPrice: '0.10' }],
};

test('recurring PO input preserves canonical decimals and rounds line totals exactly', () => {
  const parsed = createRecurringPoSchema.safeParse(createBody);
  assert.equal(parsed.success, true);
  if (!parsed.success) throw new Error('Expected recurring PO input to be valid');

  assert.deepEqual(parsed.data.lines, [
    { description: 'Paper clips', quantity: '3.00', unitPrice: '0.10' },
  ]);
  assert.equal(parsed.data.totalAmount, '0.30');
  assert.equal(parsed.data.currency, 'USD');
  assert.deepEqual(calculateRecurringPoAmounts(parsed.data.lines), {
    lineTotals: ['0.30'],
    subtotal: '0.30',
  });
});

test('recurring PO input rejects unsafe precision, inconsistent totals, and invalid calendar dates', () => {
  assert.equal(
    createRecurringPoSchema.safeParse({
      ...createBody,
      totalAmount: '9007199254740993',
    }).success,
    false,
  );
  assert.equal(
    createRecurringPoSchema.safeParse({
      ...createBody,
      lines: [{ description: 'Paper clips', quantity: '1.005', unitPrice: '0.10' }],
    }).success,
    false,
  );
  assert.equal(
    createRecurringPoSchema.safeParse({ ...createBody, totalAmount: '0.29' }).success,
    false,
  );
  assert.equal(
    createRecurringPoSchema.safeParse({ ...createBody, startDate: '2026-02-30' }).success,
    false,
  );
  assert.equal(
    createRecurringPoSchema.safeParse({
      title: createBody.title,
      frequency: createBody.frequency,
      lines: [
        {
          description: 'Oversized line',
          quantity: '99999999.99',
          unitPrice: '9999999999.99',
        },
      ],
    }).success,
    false,
  );
  assert.equal(updateRecurringPoSchema.safeParse({ totalAmount: '1.00' }).success, false);
});
