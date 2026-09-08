import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@betterspend/db';
import { and, eq, ne, isNull, desc, sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { invoices } from '@betterspend/db';
import { invoiceListQuerySchema } from '@betterspend/shared';
import type { AccessPolicy } from '../auth/access-policy';
import { encodeInvoiceListCursor } from './invoice-list-cursor';
import { InvoicesService } from './invoices.service';

const org = '00000000-0000-4000-8000-000000000001';
const entity = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';

const access: AccessPolicy = {
  can: (permission) => permission === 'invoices:view_all',
  scopeFor: () => ({
    organizationId: org,
    userId: other,
    unrestricted: false,
    ownOnly: false,
    departmentIds: [],
    projectIds: [],
    entityIds: [entity],
  }),
  isGlobalBuiltInAdmin: () => false,
  toDocument: () => ({ permissions: ['invoices:view_all'], scopes: {} }),
};

test('validates bounded invoice page parameters', () => {
  assert.equal(invoiceListQuerySchema.parse({}).limit, 50);
  assert.equal(invoiceListQuerySchema.safeParse({ status: 'pending_approval' }).success, true);
  assert.equal(invoiceListQuerySchema.safeParse({ status: 'ready_for_release' }).success, true);
  for (const query of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { page: 0 },
    { page: Number.MAX_SAFE_INTEGER },
    { status: 'invalid' },
    { entityId: 'invalid' },
    { unpaid: 'yes' },
  ]) {
    assert.equal(invoiceListQuerySchema.safeParse(query).success, false);
  }
});

test('paginates real scoped SQL across matching timestamps and server filters', async () => {
  const database = new PGlite();
  try {
    await database.exec(
      'CREATE TABLE invoices (id uuid PRIMARY KEY, organization_id uuid, entity_id uuid, status text, paid_at timestamptz, created_at timestamptz)',
    );
    for (let index = 1; index <= 125; index++) {
      await database.query('INSERT INTO invoices VALUES ($1,$2,$3,$4,NULL,$5)', [
        `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        index === 125 ? other : org,
        index === 124 ? other : entity,
        index === 123 ? 'paid' : 'matched',
        index === 1 ? '2026-09-01T00:00:00.123455Z' : '2026-09-01T00:00:00.123456Z',
      ]);
    }
    let returnedRows = 0;
    const db = {
      query: {
        invoices: {
          findMany: async (config: {
            where: (
              table: typeof invoices,
              operators: { and: typeof and; eq: typeof eq; ne: typeof ne; isNull: typeof isNull },
            ) => SQL;
            orderBy: (table: typeof invoices, operators: { desc: typeof desc }) => SQL[];
            limit: number;
            extras: (table: typeof invoices) => { cursorCreatedAt: SQL.Aliased<string> };
          }) => {
            assert.equal('offset' in config, false);
            const predicate = config.where(invoices, { and, eq, ne, isNull });
            const ordering = config.orderBy(invoices, { desc });
            const statement = new PgDialect().sqlToQuery(
              sql`SELECT id, ${config.extras(invoices).cursorCreatedAt.sql} AS "cursorCreatedAt" FROM invoices WHERE ${predicate} ORDER BY ${sql.join(ordering, sql`, `)} LIMIT ${config.limit}`,
            );
            const result = await database.query(statement.sql, statement.params);
            returnedRows = result.rows.length;
            return result.rows;
          },
        },
      },
    };
    const service = Object.assign(Object.create(InvoicesService.prototype), {
      db,
    }) as InvoicesService;
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 1; page <= 3; page++) {
      const result = await service.findAll(
        org,
        { cursor, limit: 50, status: 'matched', unpaid: 'true' },
        access,
      );
      assert.equal(result.nextCursor !== null, page < 3);
      cursor = result.nextCursor ?? undefined;
      assert.equal(result.items.length, page < 3 ? 50 : 22);
      assert.ok(returnedRows <= 51);
      if (page === 1)
        await database.query('INSERT INTO invoices VALUES ($1,$2,$3,$4,NULL,$5)', [
          '20000000-0000-4000-8000-000000000001',
          org,
          entity,
          'matched',
          '2026-09-02',
        ]);
      if (page === 2) await database.query('DELETE FROM invoices WHERE id = $1', [[...seen][0]]);
      for (const row of result.items) {
        assert.equal(seen.has(row.id), false);
        seen.add(row.id);
      }
    }
    assert.equal(seen.size, 122);
    await database.query("UPDATE invoices SET status = 'ready_for_release' WHERE status = 'paid'");
    assert.equal(
      (await service.findAll(org, { status: 'ready_for_release' }, access)).items.length,
      1,
    );
    await database.query("UPDATE invoices SET status = 'paid' WHERE status = 'ready_for_release'");
    assert.equal((await service.findAll(org, { entityId: other }, access)).items.length, 0);
    await assert.rejects(service.findAll(org, { cursor: 'invalid' }, access));
    await assert.rejects(
      service.findAll(
        org,
        { cursor: encodeInvoiceListCursor({ createdAt: 'invalid', id: org }) },
        access,
      ),
    );
    assert.equal((await service.findAll(org, { status: 'paid' }, access)).items.length, 1);
    assert.equal((await service.findAll(org, {}, { ...access, can: () => false })).items.length, 0);
    await assert.rejects(service.findAll(org, { limit: 101 }, access));
  } finally {
    await database.close();
  }
});

test('aging summary uses real database timestamps across the complete scoped history', async () => {
  const database = new PGlite();
  try {
    await database.exec(`CREATE TABLE invoices (
      organization_id uuid, entity_id uuid, status text, paid_at timestamptz,
      due_date timestamptz, total_amount numeric(18, 2)
    )`);
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    async function insert(
      days: number | null,
      organizationId = org,
      entityId = entity,
      status = 'matched',
    ) {
      const due = new Date(today);
      if (days !== null) due.setDate(due.getDate() + days);
      await database.query('INSERT INTO invoices VALUES ($1, $2, $3, NULL, $4, 10.00)', [
        organizationId,
        entityId,
        status,
        days === null ? null : due.toISOString(),
      ]);
    }
    for (let index = 0; index < 125; index++) await insert(0);
    for (const days of [5, null, -15, -45, -75, -100]) await insert(days);
    await insert(0, other);
    await insert(0, org, other);
    await insert(0, org, entity, 'paid');

    const db = drizzle(database, { schema });
    const row = await db.query.invoices.findFirst({ columns: { dueDate: true } });
    assert.ok(row?.dueDate instanceof Date);
    const service = Object.assign(Object.create(InvoicesService.prototype), {
      db,
    }) as InvoicesService;
    const report = await service.getAgingReport(org, access, entity);
    assert.equal(report.openCount, 131);
    assert.deepEqual(report.dueIn7Days, { count: 126, totalAmount: '1260.00' });
    assert.deepEqual(report.current, { count: 127, totalAmount: '1270.00' });
    for (const bucket of [
      report.days_1_30,
      report.days_31_60,
      report.days_61_90,
      report.days_90_plus,
    ]) {
      assert.deepEqual(bucket, { count: 1, totalAmount: '10.00' });
    }
  } finally {
    await database.close();
  }
});

test('aging sums persisted numeric(14,2) amounts exactly in current and overdue buckets', async () => {
  const database = new PGlite();
  try {
    await database.exec(`CREATE TABLE invoices (
      organization_id uuid, entity_id uuid, status text, paid_at timestamptz,
      due_date timestamptz, total_amount numeric(14, 2)
    )`);
    const current = new Date();
    current.setHours(12, 0, 0, 0);
    const overdue = new Date(current);
    overdue.setDate(overdue.getDate() - 45);
    for (const dueDate of [current, overdue]) {
      await database.query(
        `INSERT INTO invoices
        SELECT $1::uuid, $2::uuid, 'matched', NULL, $3::timestamptz, 999999999999.99
        FROM generate_series(1, 38)`,
        [org, entity, dueDate.toISOString()],
      );
    }
    const db = drizzle(database, { schema });
    const service = Object.assign(Object.create(InvoicesService.prototype), {
      db,
    }) as InvoicesService;
    const report = await service.getAgingReport(org, access, entity);
    const expected = { count: 38, totalAmount: '37999999999999.62' };
    assert.equal(report.openCount, 76);
    assert.deepEqual(report.dueIn7Days, expected);
    assert.deepEqual(report.current, expected);
    assert.deepEqual(report.days_31_60, expected);
  } finally {
    await database.close();
  }
});

test('early payment opportunities intersect selected entity and access scopes', async () => {
  const database = new PGlite();
  try {
    await database.exec(`CREATE TABLE invoices (
      id uuid, organization_id uuid, entity_id uuid, status text, paid_at timestamptz
    )`);
    await database.query(
      "INSERT INTO invoices VALUES ($1,$2,$3,'matched',NULL),($2,$2,$1,'matched',NULL),($3,$1,$3,'matched',NULL)",
      [other, org, entity],
    );
    const db = {
      query: {
        invoices: {
          findMany: async (config: {
            where: (
              table: typeof invoices,
              operators: { and: typeof and; eq: typeof eq; ne: typeof ne; isNull: typeof isNull },
            ) => SQL;
          }) => {
            const statement = new PgDialect().sqlToQuery(
              sql`SELECT id FROM invoices WHERE ${config.where(invoices, { and, eq, ne, isNull })}`,
            );
            const result = await database.query<{ id: string }>(statement.sql, statement.params);
            return result.rows.map((row) => ({
              ...row,
              earlyPaymentDiscountBy: new Date(),
              earlyPaymentDiscountPercent: '2.00',
            }));
          },
        },
      },
    };
    const service = Object.assign(Object.create(InvoicesService.prototype), {
      db,
    }) as InvoicesService;
    const unrestricted = {
      ...access,
      scopeFor: () => ({ ...access.scopeFor('invoice', 'invoices:view_all'), unrestricted: true }),
    };
    assert.equal((await service.getEarlyPaymentOpportunities(org, unrestricted)).length, 2);
    assert.equal((await service.getEarlyPaymentOpportunities(org, unrestricted, entity)).length, 1);
    assert.equal((await service.getEarlyPaymentOpportunities(org, access, other)).length, 0);
    assert.equal((await service.getEarlyPaymentOpportunities(org, access, entity)).length, 1);
  } finally {
    await database.close();
  }
});
