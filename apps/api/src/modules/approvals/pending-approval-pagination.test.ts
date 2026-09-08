import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { approvalRequests } from '@betterspend/db';
import { ApprovalEngineService } from './approval-engine.service';

function harness(count: number) {
  let queryCount = 0;
  let hydratedCount = 0;
  const candidates = Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  }));
  const db = {
    execute: async (_query: SQL) => {
      queryCount++;
      return queryCount === 1 ? candidates : [];
    },
    query: {
      approvalRequests: {
        findMany: async (options: {
          where: (
            table: typeof approvalRequests,
            ops: { and: typeof and; eq: typeof eq; inArray: typeof inArray },
          ) => SQL;
        }) => {
          queryCount++;
          const condition = new PgDialect().sqlToQuery(
            options.where(approvalRequests, { and, eq, inArray }),
          );
          const rows = candidates.filter((candidate) => condition.params.includes(candidate.id));
          hydratedCount = rows.length;
          return rows.map((row) => ({
            ...row,
            approvableType: 'requisition',
            approvableId: '00000000-0000-4000-8000-000000009999',
          }));
        },
      },
    },
  };
  const service = new ApprovalEngineService(
    db as never,
    {} as never,
    {} as never,
    {
      getActiveDelegatee: () => assert.fail('Delegation must not be queried per request'),
    } as never,
    {} as never,
    {} as never,
  );
  return { service, counts: () => ({ queryCount, hydratedCount }) };
}

test('pending pages hydrate at most the requested page and never fan out delegation reads', async () => {
  const { service, counts } = harness(51);
  const result = await service.listPending('org', 'actor');
  assert.equal(result.data.length, 50);
  assert.equal(result.hasMore, true);
  assert.deepEqual(counts(), { queryCount: 3, hydratedCount: 50 });
});

test('an actor with no eligible requests performs only the candidate query', async () => {
  const { service, counts } = harness(0);
  assert.deepEqual(await service.listPending('org', 'actor'), {
    data: [],
    page: 1,
    limit: 50,
    hasMore: false,
  });
  assert.deepEqual(counts(), { queryCount: 1, hydratedCount: 0 });
});

test('invalid approval pagination is rejected before reading the database', async () => {
  const { service, counts } = harness(0);
  for (const [page, limit] of [
    [0, 50],
    [1, 101],
    [NaN, 50],
    [1.5, 50],
    [Number.MAX_SAFE_INTEGER, 100],
  ]) {
    await assert.rejects(
      service.listPending('org', 'actor', undefined, page, limit),
      /Invalid approval page/,
    );
  }
  assert.deepEqual(counts(), { queryCount: 0, hydratedCount: 0 });
});
