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

test('saved report configurations are tenant-scoped', () => {
  const service = new ReportsService({} as never);

  const acme = service.saveReport('org-acme', {
    name: 'Acme spend',
    reportType: 'spend_by_vendor',
    filters: {},
  });
  service.saveReport('org-other', {
    name: 'Other spend',
    reportType: 'spend_by_vendor',
    filters: {},
  });

  assert.deepEqual(service.listSavedReports('org-acme'), [acme]);
  assert.equal(service.listSavedReports('org-other').length, 1);
  assert.equal(service.deleteSavedReport('org-other', acme.id), false);
  assert.equal(service.deleteSavedReport('org-acme', acme.id), true);
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
  assert.match(scopedQuery.sql, /false/);

  await service.getAuditLog('org-acme', {}, { ...scopedAccess, unrestricted: true });
  const globalQuery = new PgDialect().sqlToQuery(queries[1] as never);
  assert.match(globalQuery.sql, /true/);
});
