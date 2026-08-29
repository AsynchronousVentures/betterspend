import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Db } from '@betterspend/db';
import { RfqService } from './rfq.service';

function createOpenFixture(input: { updateResult: unknown[]; existing?: { status: string } }) {
  let updateCondition: unknown;
  const audits: Array<Record<string, unknown>> = [];
  const transaction = {
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
        where: () => ({ limit: async () => (input.existing ? [input.existing] : []) }),
      }),
    }),
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        audits.push(value);
      },
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

  const opened = await service.open('org-1', 'rfq-1', 'user-1');
  const sql = new PgDialect().sqlToQuery(fixture.getUpdateCondition() as never).sql;

  assert.deepEqual(opened, { id: 'rfq-1', status: 'open' });
  assert.match(sql, /"status" = \$\d+/);
  assert.deepEqual(fixture.audits, [
    {
      organizationId: 'org-1',
      userId: 'user-1',
      entityType: 'rfq',
      entityId: 'rfq-1',
      action: 'opened',
      changes: { previousStatus: 'draft', status: 'open' },
    },
  ]);
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
    service.open('org-1', 'rfq-1', 'user-1'),
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
    service.open('org-1', 'missing', 'user-1'),
    (error: unknown) => error instanceof NotFoundException,
  );
});
