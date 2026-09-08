import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { ExportService, type ExportType } from './export.service';

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

test('SQL export pages share scoped totals and stable ordering', async () => {
  const database = new PGlite();
  try {
    const directory = join(process.cwd(), '../../packages/db/src/migrations');
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      await database.exec(await readFile(join(directory, file), 'utf8'));
    }
    await database.exec(`
      INSERT INTO organizations (id, name, slug) VALUES ('${id(1)}', 'Org', 'export-test'), ('${id(2)}', 'Other', 'export-other');
      INSERT INTO legal_entities (id, organization_id, name, code) VALUES ('${id(3)}', '${id(1)}', 'Visible', 'VISIBLE');
      INSERT INTO vendors (id, organization_id, name, contact_info) VALUES ('${id(4)}', '${id(1)}', 'Vendor', '{"email":"vendor@example.test"}'), ('${id(5)}', '${id(2)}', 'Hidden', '{}');
      INSERT INTO purchase_orders (id, organization_id, vendor_id, entity_id, number) VALUES ('${id(6)}', '${id(1)}', '${id(4)}', '${id(3)}', 'PO-EXPORT');
      INSERT INTO invoices (organization_id, vendor_id, entity_id, purchase_order_id, internal_number, invoice_number, invoice_date, created_at, status, total_amount)
        SELECT '${id(1)}', '${id(4)}', '${id(3)}', '${id(6)}', 'INV-' || n, 'SUP-' || n, '2026-01-01', '2026-01-01', 'approved', 10 FROM generate_series(1, 1105) n;
      INSERT INTO invoices (organization_id, vendor_id, internal_number, invoice_number, invoice_date, status, total_amount)
        VALUES ('${id(2)}', '${id(5)}', 'OTHER', 'OTHER', '2026-01-01', 'approved', 999);
    `);
    const reads: Array<{ sql: string; rows: number }> = [];
    const fixture = {
      execute: async (statement: SQL) => {
        const query = new PgDialect().sqlToQuery(statement);
        const result = await database.query(
          query.sql,
          query.params.map((value) => (value instanceof Date ? value.toISOString() : value)),
        );
        reads.push({ sql: query.sql, rows: result.rows.length });
        return result.rows;
      },
    };
    const service = new ExportService({
      transaction: (run: (tx: typeof fixture) => unknown) => run(fixture),
    } as never);
    const first = await service.getPage('invoices', id(1), { page: 1, limit: 1 });
    const second = await service.getPage('invoices', id(1), { page: 2, limit: 1 });
    assert.equal(first.total, 1105);
    assert.equal(first.pages, 1105);
    assert.equal(first.data.length, 1);
    assert.notEqual(first.data[0].id, second.data[0].id);
    assert.ok(reads.every((read) => read.rows === 1));
    assert.equal(reads.filter((read) => /LIMIT/.test(read.sql)).length, 2);
    const scope = {
      organizationId: id(1),
      userId: id(10),
      unrestricted: false,
      ownOnly: false,
      departmentIds: [],
      projectIds: [],
      entityIds: [id(3)],
    };
    assert.equal((await service.getPage('invoices', id(1), { limit: 1 }, scope)).total, 1105);
    const hidden = await service.getPage(
      'invoices',
      id(1),
      { limit: 1 },
      { ...scope, entityIds: [] },
    );
    assert.equal(hidden.total, 0);
    assert.deepEqual(hidden.data, []);
    for (const type of [
      'purchase-orders',
      'budgets',
      'audit-log',
      'spend-by-vendor',
      'spend-by-category',
    ] as ExportType[]) {
      await service.getPage(type, id(1), { limit: 1 });
    }
    assert.equal(
      (await service.getPage('purchase-orders', id(1), {})).data[0].vendorEmail,
      'vendor@example.test',
    );
    assert.equal(
      (await service.getPage('spend-by-vendor', id(1), {})).data[0].totalSpend,
      '11050.00',
    );
    assert.equal(
      (await service.getPage('invoices', id(1), { from: '2026-02-01', limit: 1 })).total,
      0,
    );
  } finally {
    await database.close();
  }
});

test('export pagination and dates reject invalid input before executing queries', async () => {
  const service = new ExportService({
    execute: () => assert.fail('Invalid inputs must not reach SQL'),
  } as never);
  for (const query of [
    { page: 0 },
    { limit: 1001 },
    { page: NaN },
    { page: 1.5 },
    { limit: -1 },
    { page: Number.MAX_SAFE_INTEGER },
    { from: '2026-02-30' },
    { to: 'invalid' },
  ]) {
    await assert.rejects(service.getPage('invoices', id(1), query), /Invalid export|Export dates/);
  }
});
