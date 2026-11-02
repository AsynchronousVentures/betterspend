import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableColumns, getTableName } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import * as schema from '@betterspend/db';
import type { Db } from '@betterspend/db';
import type { EntitiesService } from '../entities/entities.service';
import { VendorsService } from '../vendors/vendors.service';
import { VendorPortalService } from './vendor-portal.service';

const org = '00000000-0000-4000-8000-000000000001';
const entity = '00000000-0000-4000-8000-000000000002';
const vendor = '00000000-0000-4000-8000-000000000003';
const po = '00000000-0000-4000-8000-000000000004';
const invoice = '00000000-0000-4000-8000-000000000005';

// Build each table from the Drizzle schema so the raw SQL in the services is
// checked against the real column names rather than a hand-written copy.
function createTableSql(table: AnyPgTable): string {
  const columns = Object.values(getTableColumns(table)).map((column) => {
    const type =
      column.columnType === 'PgUUID'
        ? 'uuid'
        : column.columnType === 'PgNumeric'
          ? 'numeric'
          : column.columnType === 'PgTimestamp'
            ? 'timestamptz'
            : column.columnType === 'PgBoolean'
              ? 'boolean'
              : column.columnType === 'PgJsonb'
                ? 'jsonb'
                : column.columnType === 'PgInteger' || column.columnType === 'PgSerial'
                  ? 'integer'
                  : 'text';
    return `"${column.name}" ${type}`;
  });
  return `CREATE TABLE "${getTableName(table)}" (${columns.join(', ')})`;
}

test('vendor PO queries select real purchase_orders columns', async () => {
  const database = new PGlite();
  try {
    for (const table of [
      schema.legalEntities,
      schema.vendors,
      schema.purchaseOrders,
      schema.invoices,
    ]) {
      await database.exec(createTableSql(table));
    }
    await database.query(
      'INSERT INTO vendors (id, organization_id, entity_id, name, code, status) VALUES ($1,$2,$3,$4,$5,$6)',
      [vendor, org, entity, 'Supplier One', 'SUP-1', 'active'],
    );
    await database.query(
      'INSERT INTO purchase_orders (id, organization_id, entity_id, vendor_id, number, status, total_amount, currency, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())',
      [po, org, entity, vendor, 'PO-2026-0001', 'issued', '125.50', 'USD'],
    );
    await database.query(
      'INSERT INTO invoices (id, organization_id, entity_id, vendor_id, internal_number, invoice_number, status, total_amount, currency, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())',
      [
        invoice,
        org,
        entity,
        vendor,
        'INV-2026-0001',
        'S1-100',
        'pending_approval',
        '125.50',
        'USD',
      ],
    );

    // postgres-js returns rows directly from execute(); PGlite wraps them in { rows }.
    const pglite = drizzle(database, { schema });
    const db = Object.assign(Object.create(pglite), {
      execute: async (query: Parameters<typeof pglite.execute>[0]) =>
        (await pglite.execute(query)).rows,
    }) as unknown as Db;

    const portal = new VendorPortalService(
      db,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const dashboard = await portal.getVendorDashboard(vendor, org);
    assert.equal(dashboard.purchaseOrders.length, 1);
    assert.equal(dashboard.purchaseOrders[0]?.['internalNumber'], 'PO-2026-0001');
    assert.equal(dashboard.invoices[0]?.['internalNumber'], 'INV-2026-0001');
    assert.equal(dashboard.stats.totalPOs, 1);
    assert.equal(dashboard.stats.pendingPayment, 125.5);

    const vendors = new VendorsService(db, undefined as unknown as EntitiesService);
    const transactions = await vendors.getTransactions(vendor, org);
    assert.equal(transactions.purchaseOrders.length, 1);
    assert.equal(transactions.purchaseOrders[0]?.['number'], 'PO-2026-0001');
    assert.equal(transactions.invoices[0]?.['number'], 'INV-2026-0001');
  } finally {
    await database.close();
  }
});
