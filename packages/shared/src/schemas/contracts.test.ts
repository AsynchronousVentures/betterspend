import assert from 'node:assert/strict';
import test from 'node:test';
import { createContractObligationSchema, updateContractObligationSchema } from './contracts';

const createBody = {
  obligationType: 'renewal_notice',
  title: 'Renewal notice deadline',
  description: 'Review the renewal decision.',
  dueDate: new Date('2026-09-30T12:00:00.000Z'),
  recurrence: 'annual',
  sourceReference: 'terms:auto_renewal',
};

test('contract obligation schemas accept zero and default omitted lead days', () => {
  assert.equal(
    createContractObligationSchema.parse({ ...createBody, notificationLeadDays: 0 })
      .notificationLeadDays,
    0,
  );
  assert.equal(createContractObligationSchema.parse(createBody).notificationLeadDays, 30);
  assert.equal(
    updateContractObligationSchema.parse({ notificationLeadDays: 0 }).notificationLeadDays,
    0,
  );
});

test('contract obligation schemas reject negative, fractional, and non-finite lead days', () => {
  for (const notificationLeadDays of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    assert.equal(
      createContractObligationSchema.safeParse({ ...createBody, notificationLeadDays }).success,
      false,
      `create schema accepted ${String(notificationLeadDays)}`,
    );
    assert.equal(
      updateContractObligationSchema.safeParse({ notificationLeadDays }).success,
      false,
      `update schema accepted ${String(notificationLeadDays)}`,
    );
  }
});
