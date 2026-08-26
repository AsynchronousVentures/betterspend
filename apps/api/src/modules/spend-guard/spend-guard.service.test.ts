import assert from 'node:assert/strict';
import test from 'node:test';
import { and, eq } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { spendGuardAlerts } from '@betterspend/db';
import { SpendGuardService } from './spend-guard.service';

const scope = {
  organizationId: 'org-1',
  userId: 'user-1',
  unrestricted: false,
  ownOnly: false,
  departmentIds: ['department-1'],
  projectIds: [],
  entityIds: [],
};

test('scoped alert reads fail closed before loading unrestricted rows', async () => {
  const queries: unknown[] = [];
  let findManyCalled = false;
  const service = new SpendGuardService({
    query: {
      spendGuardAlerts: {
        findMany: async (options: {
          where: (
            alert: typeof spendGuardAlerts,
            operators: { and: typeof and; eq: typeof eq },
          ) => unknown;
        }) => {
          findManyCalled = true;
          queries.push(options.where(spendGuardAlerts, { and, eq }));
          return [];
        },
      },
    },
  } as never);

  const alerts = await service.list('org-1', 'open', scope);

  assert.deepEqual(alerts, []);
  assert.equal(findManyCalled, true);
  const query = new PgDialect().sqlToQuery(queries[0] as never);
  assert.match(query.sql, /SELECT a\.id/);
  assert.match(query.sql, /record_type/);
  assert.ok(query.params.includes('department-1'));
});

test('scoped alert mutations reject records outside the granted scope', async () => {
  const queries: unknown[] = [];
  const service = new SpendGuardService({
    update: () => {
      return {
        set: () => ({
          where: (condition: unknown) => {
            queries.push(condition);
            return { returning: async () => [] };
          },
        }),
      };
    },
  } as never);

  await assert.rejects(
    service.updateStatus('alert-outside-scope', 'org-1', 'user-1', 'dismissed', undefined, scope),
    /not found/,
  );
  const query = new PgDialect().sqlToQuery(queries[0] as never);
  assert.match(query.sql, /SELECT a\.id/);
  assert.match(query.sql, /record_type/);
  assert.ok(query.params.includes('department-1'));
});

test('scoped alert mutations return the updated row from the atomic predicate', async () => {
  const queries: unknown[] = [];
  const updated = { id: 'alert-in-scope', status: 'dismissed' };
  const service = new SpendGuardService({
    update: () => ({
      set: () => ({
        where: (condition: unknown) => {
          queries.push(condition);
          return { returning: async () => [updated] };
        },
      }),
    }),
  } as never);

  const result = await service.updateStatus(
    'alert-in-scope',
    'org-1',
    'user-1',
    'dismissed',
    undefined,
    scope,
  );

  assert.deepEqual(result, updated);
  const query = new PgDialect().sqlToQuery(queries[0] as never);
  assert.match(query.sql, /SELECT a\.id/);
  assert.match(query.sql, /spend_guard_alerts/);
  assert.ok(query.params.includes('department-1'));
});

test('entity-scoped alert reads include requisitions through their purchase order entity', async () => {
  let predicate: unknown;
  const service = new SpendGuardService({
    query: {
      spendGuardAlerts: {
        findMany: async (options: {
          where: (
            alert: typeof spendGuardAlerts,
            operators: { and: typeof and; eq: typeof eq },
          ) => unknown;
        }) => {
          predicate = options.where(spendGuardAlerts, { and, eq });
          return [{ id: 'alert-entity-requisition' }];
        },
      },
    },
  } as never);

  const alerts = await service.list('org-1', 'open', {
    ...scope,
    departmentIds: [],
    entityIds: ['entity-1'],
  });

  assert.deepEqual(alerts, [{ id: 'alert-entity-requisition' }]);
  const query = new PgDialect().sqlToQuery(predicate as never);
  assert.match(query.sql, /SELECT a\.id/);
  assert.match(query.sql, /purchase_orders/);
  assert.match(query.sql, /po\.entity_id/);
  assert.ok(query.params.includes('entity-1'));
});
