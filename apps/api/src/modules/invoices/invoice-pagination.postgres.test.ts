import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@betterspend/db';
import { InvoicesService } from './invoices.service';
import { decodeInvoiceListCursor } from './invoice-list-cursor';

// This opt-in test requires a disposable PostgreSQL database after db:migrate.
const url = process.env.INVOICE_LIST_TEST_DATABASE_URL;
test(
  'PostgreSQL seeks through tied microseconds without offset drift',
  { skip: !url, timeout: 30_000 },
  async () => {
    const client = postgres(url!, { max: 1 });
    const db = drizzle(client, { schema });
    const organizationId = randomUUID();
    const vendorId = randomUUID();
    try {
      await db
        .insert(schema.organizations)
        .values({ id: organizationId, name: 'Invoice seek test', slug: organizationId });
      await db.insert(schema.vendors).values({ id: vendorId, organizationId, name: 'Vendor' });
      await client`INSERT INTO invoices (id, organization_id, vendor_id, invoice_number, internal_number, invoice_date, created_at)
      SELECT gen_random_uuid(), ${organizationId}, ${vendorId}, n::text, ${organizationId} || '-' || n::text, now(),
        '2026-09-08T00:00:00.123456Z'::timestamptz + (n % 2) * interval '1 microsecond'
      FROM generate_series(1, 2000) AS n`;
      await client`ANALYZE invoices`;
      const service = Object.assign(Object.create(InvoicesService.prototype), {
        db,
      }) as InvoicesService;
      const first = await service.findAll(organizationId, { limit: 50 });
      assert.ok(first.nextCursor);
      const boundary = decodeInvoiceListCursor(first.nextCursor);
      assert.equal(boundary.createdAt, '2026-09-08T00:00:00.123457Z');
      const plan = await client`EXPLAIN (ANALYZE, FORMAT JSON)
      SELECT id FROM invoices WHERE organization_id = ${organizationId}
        AND (created_at, id) < (${boundary.createdAt}::timestamptz, ${boundary.id}::uuid)
      ORDER BY created_at DESC, id DESC LIMIT 51`;
      const planText = JSON.stringify(plan);
      assert.match(planText, /invoices_organization_created_id_idx/);
      assert.match(planText, /Index Cond/);
      assert.doesNotMatch(planText, /"Node Type":"Sort"/);
      console.log(
        'PostgreSQL cursor EXPLAIN uses invoices_organization_created_id_idx with no Sort.',
      );

      await db
        .insert(schema.invoices)
        .values({
          organizationId,
          vendorId,
          invoiceNumber: 'newer',
          internalNumber: `${organizationId}-new`,
          invoiceDate: new Date(),
          createdAt: new Date('2026-09-09'),
        });
      const seen = new Set(first.items.map((row) => row.id));
      let cursor: string | null = first.nextCursor;
      let pages = 1;
      while (cursor) {
        const result = await service.findAll(organizationId, { cursor, limit: 50 });
        for (const row of result.items) {
          assert.equal(seen.has(row.id), false);
          assert.notEqual(row.invoiceNumber, 'newer');
          seen.add(row.id);
        }
        if (pages === 1) await client`DELETE FROM invoices WHERE id = ${first.items[0].id}`;
        cursor = result.nextCursor;
        pages++;
      }
      assert.equal(seen.size, 2000);
      assert.equal(pages, 40);
    } finally {
      await client`DELETE FROM invoices WHERE organization_id = ${organizationId}`;
      await client`DELETE FROM vendors WHERE organization_id = ${organizationId}`;
      await client`DELETE FROM organizations WHERE id = ${organizationId}`;
      await client.end();
    }
  },
);
