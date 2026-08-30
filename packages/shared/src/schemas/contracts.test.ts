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

test('contract obligation schemas require supported statuses, UUID owners, and real calendar dates', () => {
  for (const status of ['open', 'completed']) {
    assert.equal(
      updateContractObligationSchema.safeParse({ status }).success,
      true,
      `update schema rejected ${status}`,
    );
  }
  for (const status of ['Open', 'foo', 'pending']) {
    assert.equal(
      updateContractObligationSchema.safeParse({ status }).success,
      false,
      `update schema accepted ${status}`,
    );
  }

  assert.equal(
    updateContractObligationSchema.safeParse({
      ownerId: '00000000-0000-4000-8000-000000000001',
    }).success,
    true,
  );
  assert.equal(updateContractObligationSchema.safeParse({ ownerId: 'owner-1' }).success, false);

  for (const dueDate of ['2024-02-29T12:00:00.000Z', '2026-09-30T12:00:00-06:00']) {
    assert.equal(
      updateContractObligationSchema.safeParse({ dueDate }).success,
      true,
      `update schema rejected ${dueDate}`,
    );
  }
  for (const dueDate of [
    '2023-02-29T12:00:00.000Z',
    '2024-02-30T12:00:00.000Z',
    '2026-04-31T12:00:00.000Z',
    'not-a-date',
  ]) {
    assert.equal(
      updateContractObligationSchema.safeParse({ dueDate }).success,
      false,
      `update schema accepted ${dueDate}`,
    );
  }
});
