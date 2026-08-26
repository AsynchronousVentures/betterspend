import { PgDialect } from 'drizzle-orm/pg-core';
import { ReportsService } from './reports.service';
import { ExportService } from '../export/export.service';
import type { ResourceScope } from '@betterspend/shared';
import assert from 'node:assert/strict';
import test from 'node:test';

const scopedAccess: ResourceScope = {
  organizationId: 'org-acme',
  userId: 'user-1',
  unrestricted: false,
  ownOnly: false,
  departmentIds: ['department-1'],
  projectIds: [],
  entityIds: [],
};

test('saved report persistence scopes every operation to the organization', async () => {
  const selectConditions: unknown[] = [];
  const insertValues: unknown[] = [];
  const deleteConditions: unknown[] = [];
  const row = {
    id: 'saved-report-1',
    organizationId: 'org-acme',
    name: 'Acme spend',
    reportType: 'spend_by_vendor',
    filters: {},
    groupBy: null,
    createdAt: new Date('2026-08-26T00:00:00.000Z'),
  };
  const service = new ReportsService({
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          orderBy: async () => {
            selectConditions.push(condition);
            return [row];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => {
        insertValues.push(values);
        return { returning: async () => [row] };
      },
    }),
    delete: () => ({
      where: (condition: unknown) => {
        deleteConditions.push(condition);
        return { returning: async () => [{ id: row.id }] };
      },
    }),
  } as never);

  const saved = await service.saveReport('org-acme', {
    name: 'Acme spend',
    reportType: 'spend_by_vendor',
    filters: {},
  });
  const listed = await service.listSavedReports('org-acme');
  const deleted = await service.deleteSavedReport('org-acme', saved.id);

  assert.deepEqual(listed, [saved]);
  assert.equal(deleted, true);
  assert.equal((insertValues[0] as { organizationId: string }).organizationId, 'org-acme');
  assert.ok(new PgDialect().sqlToQuery(selectConditions[0] as never).params.includes('org-acme'));
  assert.ok(new PgDialect().sqlToQuery(deleteConditions[0] as never).params.includes('org-acme'));
});

test('custom reports apply row scope inside the aggregate query', async () => {
  const queries: unknown[] = [];
  const service = new ReportsService({
    execute: async (query: unknown) => {
      queries.push(query);
      return [];
    },
  } as never);

  await service.runCustomReport(
    'org-acme',
    { reportType: 'spend_by_vendor' },
    scopedAccess,
  );

  const query = new PgDialect().sqlToQuery(queries[0] as never);
  assert.match(query.sql, /department_id/);
  assert.ok(query.params.includes('department-1'));
});

test('custom spend-by-category reports aggregate base-currency line totals', async () => {
  const queries: unknown[] = [];
  const service = new ReportsService({
    execute: async (query: unknown) => {
      queries.push(query);
      return [];
    },
  } as never);

  await service.runCustomReport('org-acme', { reportType: 'spend_by_category' });

  const query = new PgDialect().sqlToQuery(queries[0] as never);
  assert.match(query.sql, /SUM\(il\.base_total_price\)/i);
  assert.doesNotMatch(query.sql, /SUM\(il\.total_price\)/i);
});

test('scoped audit exports fail closed while global exports remain available', async () => {
  const queries: unknown[] = [];
  const service = new ExportService({
    execute: async (query: unknown) => {
      queries.push(query);
      return [];
    },
  } as never);

  await service.getAuditLog('org-acme', {}, scopedAccess);
  const scopedQuery = new PgDialect().sqlToQuery(queries[0] as never);
  assert.match(scopedQuery.sql, /and\s+false/i);
  assert.doesNotMatch(scopedQuery.sql, /and\s+true/i);

  await service.getAuditLog('org-acme', {}, { ...scopedAccess, unrestricted: true });
  const globalQuery = new PgDialect().sqlToQuery(queries[1] as never);
  assert.match(globalQuery.sql, /and\s+true/i);
  assert.doesNotMatch(globalQuery.sql, /and\s+false/i);
});
