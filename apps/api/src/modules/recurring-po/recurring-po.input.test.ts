import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { parseRecurringPoCreateInput } from './recurring-po.input';

test('recurring PO API input maps shared validation failures to HTTP 400', () => {
  const body = {
    title: 'Monthly office supplies',
    frequency: 'monthly',
    lines: [{ description: 'Paper clips', quantity: '1.00', unitPrice: '0.10' }],
  };

  assert.throws(
    () =>
      parseRecurringPoCreateInput({
        ...body,
        lines: [{ description: 'Paper clips', quantity: '1.005', unitPrice: '0.10' }],
      }),
    BadRequestException,
  );
  assert.throws(
    () => parseRecurringPoCreateInput({ ...body, startDate: '2026-02-30' }),
    BadRequestException,
  );
});
