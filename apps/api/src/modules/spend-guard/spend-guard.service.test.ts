import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
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
    execute: async (query: unknown) => {
      queries.push(query);
      return [];
    },
    query: {
      spendGuardAlerts: {
        findMany: async () => {
          findManyCalled = true;
          return [];
        },
      },
    },
  } as never);

  const alerts = await service.list('org-1', 'open', scope);

  assert.deepEqual(alerts, []);
  assert.equal(findManyCalled, false);
  const query = new PgDialect().sqlToQuery(queries[0] as never);
  assert.match(query.sql, /record_type/);
  assert.ok(query.params.includes('department-1'));
});

test('scoped alert mutations reject records outside the granted scope', async () => {
  let updateCalled = false;
  const service = new SpendGuardService({
    execute: async () => [],
    update: () => {
      updateCalled = true;
      throw new Error('update should not run');
    },
  } as never);

  await assert.rejects(
    service.updateStatus('alert-outside-scope', 'org-1', 'user-1', 'dismissed', undefined, scope),
    /not found/,
  );
  assert.equal(updateCalled, false);
});
