import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Db } from '@betterspend/db';
import { RfqService, withoutOwnerIdempotencyKey } from './rfq.service';
import { parseCreateRfqBody } from './rfq.controller';

const auditProjection = [
  {
    changesJson: '{}',
    metadataJson: '{}',
    createdAtText: '2026-08-29T00:00:00.000000Z',
  },
];

test('public RFQ input rejects private owner idempotency keys', () => {
  assert.throws(
    () =>
      parseCreateRfqBody({
        title: 'Public RFQ',
        lines: [{ description: 'Seats', quantity: 1 }],
        ownerIdempotencyKey: 'artifact-operation:attacker-controlled',
      }),
    (error: unknown) => error instanceof BadRequestException,
  );
});

test('public RFQ input rejects invalid due dates at the validation boundary', () => {
  for (const dueDate of ['not-a-date', ' ']) {
    assert.throws(
      () =>
        parseCreateRfqBody({
          title: 'Public RFQ',
          dueDate,
          lines: [{ description: 'Seats', quantity: 1 }],
        }),
      (error: unknown) => error instanceof BadRequestException,
    );
  }
});

test('public RFQ input omits an exact empty due date from optional form input', () => {
  const parsed = parseCreateRfqBody({
    title: 'No deadline RFQ',
    dueDate: '',
    lines: [{ description: 'Seats', quantity: 1 }],
  });

  assert.equal('dueDate' in parsed, false);
});

test('public RFQ input accepts date-only and offset datetime due dates', () => {
  const dateOnly = parseCreateRfqBody({
    title: 'Date-only RFQ',
    dueDate: '2026-08-29',
    lines: [{ description: 'Seats', quantity: 1 }],
  });
  const withOffset = parseCreateRfqBody({
    title: 'Timed RFQ',
    dueDate: '2026-08-29T12:00:00-06:00',
    lines: [{ description: 'Seats', quantity: 1 }],
  });

  assert.equal(dateOnly.dueDate, '2026-08-29');
  assert.equal(withOffset.dueDate, '2026-08-29T12:00:00-06:00');
});

test('public RFQ input rejects negative target prices and accepts nonnegative values', () => {
  assert.throws(
    () =>
      parseCreateRfqBody({
        title: 'Invalid target price',
        lines: [{ description: 'Seats', quantity: 1, targetPrice: -0.01 }],
      }),
    (error: unknown) => error instanceof BadRequestException && error.getStatus() === 400,
  );

  const parsed = parseCreateRfqBody({
    title: 'Valid target price',
    lines: [{ description: 'Seats', quantity: 1, targetPrice: 0 }],
  });
  assert.equal(parsed.lines[0]?.targetPrice, 0);
});

test('RFQ response projections hide private owner idempotency keys', () => {
  const response = withoutOwnerIdempotencyKey({
    id: 'rfq-1',
    title: 'Renewal',
    idempotencyKey: 'artifact-operation:private',
  });

  assert.equal('idempotencyKey' in response, false);
});

function createOpenFixture(input: { updateResult: unknown[]; existing?: { status: string } }) {
  let updateCondition: unknown;
  const audits: Array<Record<string, unknown>> = [];
  const transaction = {
    execute: async () => auditProjection,
    update: () => ({
      set: () => ({
        where: (condition: unknown) => {
          updateCondition = condition;
          return { returning: async () => input.updateResult };
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [] }),
          limit: async () => (input.existing ? [input.existing] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          audits.push(value);
          return [value];
        },
      }),
    }),
  };
  const db = {
    transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as Db;

  return { db, audits, getUpdateCondition: () => updateCondition };
}

test('opening an RFQ conditionally transitions draft status and records its initiator', async () => {
  const fixture = createOpenFixture({
    updateResult: [{ id: 'rfq-1', status: 'open' }],
  });
  const service = new RfqService(
    fixture.db,
    undefined as never,
    undefined as never,
    undefined as never,
  );

  const opened = await service.open('00000000-0000-4000-8000-000000000001', 'rfq-1', 'user-1');
  const sql = new PgDialect().sqlToQuery(fixture.getUpdateCondition() as never).sql;

  assert.deepEqual(opened, { id: 'rfq-1', status: 'open' });
  assert.match(sql, /"status" = \$\d+/);
  assert.equal(fixture.audits.length, 1);
  assert.deepEqual(
    {
      organizationId: fixture.audits[0]?.organizationId,
      userId: fixture.audits[0]?.userId,
      entityType: fixture.audits[0]?.entityType,
      entityId: fixture.audits[0]?.entityId,
      action: fixture.audits[0]?.action,
      changes: fixture.audits[0]?.changes,
    },
    {
      organizationId: '00000000-0000-4000-8000-000000000001',
      userId: 'user-1',
      entityType: 'rfq',
      entityId: 'rfq-1',
      action: 'opened',
      changes: { previousStatus: 'draft', status: 'open' },
    },
  );
  assert.equal(typeof fixture.audits[0]?.entryHash, 'string');
});

test('a concurrent RFQ award prevents reopening the record', async () => {
  const fixture = createOpenFixture({
    updateResult: [],
    existing: { status: 'awarded' },
  });
  const service = new RfqService(
    fixture.db,
    undefined as never,
    undefined as never,
    undefined as never,
  );

  await assert.rejects(
    service.open('00000000-0000-4000-8000-000000000001', 'rfq-1', 'user-1'),
    (error: unknown) => error instanceof BadRequestException,
  );
  assert.deepEqual(fixture.audits, []);
});

test('opening an unknown RFQ reports not found', async () => {
  const fixture = createOpenFixture({ updateResult: [] });
  const service = new RfqService(
    fixture.db,
    undefined as never,
    undefined as never,
    undefined as never,
  );

  await assert.rejects(
    service.open('00000000-0000-4000-8000-000000000001', 'missing', 'user-1'),
    (error: unknown) => error instanceof NotFoundException,
  );
});
