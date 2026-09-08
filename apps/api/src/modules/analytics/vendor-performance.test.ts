import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { AnalyticsService } from './analytics.service';

// Execute the service's actual SQL: mocked execute results cannot catch join fanout.
test('vendor performance aggregates each scoped invoice and PO exactly once', async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE vendors (id text PRIMARY KEY, organization_id text, name text);
      CREATE TABLE requisitions (id text PRIMARY KEY, department_id text, project_id text);
      CREATE TABLE purchase_orders (id text PRIMARY KEY, organization_id text, vendor_id text,
        requisition_id text, entity_id text);
      CREATE TABLE invoices (id text PRIMARY KEY, organization_id text, vendor_id text,
        purchase_order_id text, entity_id text, match_status text, status text,
        due_date date, updated_at timestamp, invoice_date date, total_amount numeric);
      INSERT INTO vendors VALUES ('both', 'org', 'Both'), ('po', 'org', 'PO only'),
        ('invoice', 'org', 'Invoice only'), ('empty', 'org', 'Empty'), ('other', 'other', 'Other');
      INSERT INTO requisitions VALUES ('req', 'department', 'project');
      INSERT INTO purchase_orders VALUES ('p1', 'org', 'both', 'req', 'visible'),
        ('p2', 'org', 'both', 'req', 'visible'), ('p3', 'org', 'both', 'req', 'visible'),
        ('p4', 'org', 'po', NULL, 'hidden'), ('p5', 'other', 'other', NULL, 'visible');
      INSERT INTO invoices VALUES
        ('i1', 'org', 'both', 'p1', 'visible', 'full_match', 'approved', '2026-09-30', '2026-09-03', '2026-09-01', 100),
        ('i2', 'org', 'both', 'p1', 'visible', 'exception', 'approved', '2026-09-30', '2026-09-05', '2026-09-01', 200),
        ('i3', 'org', 'invoice', NULL, 'hidden', 'full_match', 'approved', NULL, '2026-09-01', '2026-09-01', 50),
        ('i4', 'other', 'other', NULL, 'visible', 'full_match', 'approved', NULL, '2026-09-01', '2026-09-01', 999);
    `);
    const plans: unknown[] = [];
    const service = new AnalyticsService({
      execute: async (statement: SQL) => {
        const query = new PgDialect().sqlToQuery(statement);
        plans.push(
          (await database.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${query.sql}`, query.params)).rows,
        );
        return (await database.query(query.sql, query.params)).rows;
      },
    } as never);
    const rows = (await service.vendorPerformance('org')) as unknown as Record<string, unknown>[];
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], {
      vendorId: 'both',
      vendorName: 'Both',
      invoiceCount: 2,
      exceptionCount: 1,
      exceptionRate: '50.0',
      avgDaysToApprove: '3.0',
      totalApproved: '300',
      poCount: 3,
    });
    assert.equal(rows.find((row) => row.vendorId === 'po')?.invoiceCount, 0);
    assert.equal(rows.find((row) => row.vendorId === 'invoice')?.poCount, 0);
    await database.exec(
      "INSERT INTO purchase_orders VALUES ('p6', 'org', 'both', 'req', 'visible')",
    );
    const added = (await service.vendorPerformance('org')) as unknown as Record<string, unknown>[];
    assert.equal(added[0].totalApproved, '300');
    assert.equal(added[0].poCount, 4);
    const scoped = (await service.vendorPerformance('org', {
      organizationId: 'org',
      userId: 'user',
      unrestricted: false,
      ownOnly: false,
      departmentIds: [],
      projectIds: [],
      entityIds: ['visible'],
    })) as unknown as Record<string, unknown>[];
    assert.deepEqual(
      scoped.map((row) => row.vendorId),
      ['both'],
    );
    // Every join in the representative plan emits at most one row per source record.
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      const node = value as Record<string, unknown>;
      if (String(node['Node Type']).includes('Join')) {
        assert.ok(Number(node['Actual Rows']) <= 5, JSON.stringify(node));
      }
      Object.values(node).forEach(visit);
    };
    visit(plans[0]);
  } finally {
    await database.close();
  }
});
