import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { and, eq, ne, isNull, desc, sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { invoices } from '@betterspend/db';
import { invoiceListQuerySchema } from '@betterspend/shared';
import type { AccessPolicy } from '../auth/access-policy';
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
        '2026-09-01',
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
            offset: number;
          }) => {
            const predicate = config.where(invoices, { and, eq, ne, isNull });
            const ordering = config.orderBy(invoices, { desc });
            const statement = new PgDialect().sqlToQuery(
              sql`SELECT id FROM invoices WHERE ${predicate} ORDER BY ${sql.join(ordering, sql`, `)} LIMIT ${config.limit} OFFSET ${config.offset}`,
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
    for (let page = 1; page <= 3; page++) {
      const result = await service.findAll(
        org,
        { page, limit: 50, status: 'matched', unpaid: 'true' },
        access,
      );
      assert.equal(result.page, page);
      assert.equal(result.hasMore, page < 3);
      assert.equal(result.items.length, page < 3 ? 50 : 22);
      assert.ok(returnedRows <= 51);
      for (const row of result.items) {
        assert.equal(seen.has(row.id), false);
        seen.add(row.id);
      }
    }
    assert.equal(seen.size, 122);
    assert.equal((await service.findAll(org, { entityId: other }, access)).items.length, 0);
    assert.equal((await service.findAll(org, { page: 4 }, access)).hasMore, false);
    assert.equal((await service.findAll(org, { status: 'paid' }, access)).items.length, 1);
    assert.equal((await service.findAll(org, {}, { ...access, can: () => false })).items.length, 0);
    await assert.rejects(service.findAll(org, { limit: 101 }, access));
  } finally {
    await database.close();
  }
});

test('aging summary counts the complete scoped history independently of invoice pages', async () => {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const db = {
    query: {
      invoices: {
        findMany: async (config: {
          where: (
            table: typeof invoices,
            operators: { and: typeof and; eq: typeof eq; ne: typeof ne; isNull: typeof isNull },
          ) => SQL;
          columns: Record<string, boolean>;
        }) => {
          const predicate = new PgDialect().sqlToQuery(
            config.where(invoices, { and, eq, ne, isNull }),
          );
          assert.ok(predicate.params.includes(org));
          assert.ok(predicate.params.includes(entity));
          assert.deepEqual(config.columns, { dueDate: true, totalAmount: true });
          return Array.from({ length: 125 }, () => ({ dueDate: date, totalAmount: '10.00' }));
        },
      },
    },
  };
  const service = Object.assign(Object.create(InvoicesService.prototype), {
    db,
  }) as InvoicesService;
  const report = await service.getAgingReport(org, access, entity);
  assert.equal(report.openCount, 125);
  assert.deepEqual(report.dueIn7Days, { count: 125, totalAmount: '1250.00' });
  assert.deepEqual(report.current, { count: 125, totalAmount: '1250.00' });
});
