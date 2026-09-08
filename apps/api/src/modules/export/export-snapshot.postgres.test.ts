import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ExportService } from './export.service';

const url = process.env.EXPORT_TEST_DATABASE_URL;
// The supplied isolated server must allow CREATEDB; this fixture owns and drops
// its database and never changes the supplied database's tables.
test(
  'exports retain one snapshot under writes and release cancelled cursors',
  {
    skip: !url,
    timeout: 60_000,
  },
  async () => {
    const admin = postgres(url!, { max: 1 });
    const name = `export_test_${randomUUID().replaceAll('-', '')}`;
    const testUrl = new URL(url!);
    testUrl.pathname = `/${name}`;
    const reader = postgres(testUrl.toString(), { max: 1 });
    const writer = postgres(testUrl.toString(), { max: 1 });
    let created = false;
    try {
      await admin`CREATE DATABASE ${admin(name)}`;
      created = true;
      const directory = join(process.cwd(), '../../packages/db/src/migrations');
      for (const file of (await readdir(directory))
        .filter((value) => value.endsWith('.sql'))
        .sort()) {
        await writer.unsafe(await readFile(join(directory, file), 'utf8'));
      }
      const org = randomUUID();
      const vendor = randomUUID();
      await writer`INSERT INTO organizations (id, name, slug) VALUES (${org}, 'Export', 'export')`;
      await writer`INSERT INTO vendors (id, organization_id, name) VALUES (${vendor}, ${org}, 'Vendor')`;
      await writer`INSERT INTO invoices (organization_id, vendor_id, internal_number, invoice_number, invoice_date, created_at)
      SELECT ${org}, ${vendor}, 'INV-' || n, 'SUP-' || n, '2026-01-01', '2026-01-01' FROM generate_series(1, 1105) n`;
      const database = drizzle(reader);
      let changed = false;
      const service = new ExportService({
        $client: reader,
        transaction: (
          run: Parameters<typeof database.transaction>[0],
          config: Parameters<typeof database.transaction>[1],
        ) =>
          database.transaction(
            async (tx) =>
              run(
                new Proxy(tx, {
                  get(target, key, receiver) {
                    if (key !== 'execute') return Reflect.get(target, key, receiver);
                    return async (...args: Parameters<typeof tx.execute>) => {
                      const result = await tx.execute(...args);
                      if (!changed) {
                        changed = true;
                        await writer`INSERT INTO invoices (organization_id, vendor_id, internal_number, invoice_number, invoice_date)
                  VALUES (${org}, ${vendor}, 'NEW', 'NEW', '2026-01-02')`;
                      }
                      return result;
                    };
                  },
                }),
              ),
            config,
          ),
      } as never);
      const page = await service.getPage('invoices', org, { limit: 1000 });
      assert.equal(page.total, 1105, 'total must share the rows snapshot before concurrent insert');
      assert.equal(page.data.length, 1000);
      assert.equal(page.pages, 2);
      assert.equal((await service.getPage('invoices', org, { page: 10 })).total, 1106);
      await writer`DELETE FROM invoices WHERE invoice_number = 'NEW'`;

      const expected = await writer<
        { internal_number: string }[]
      >`SELECT internal_number FROM invoices ORDER BY created_at DESC, id`;
      const chunks = service.csvChunks('invoices', org, { from: '2026-01-01' });
      await chunks.next(); // Header; no database connection is held yet.
      const first = await chunks.next();
      assert.equal(first.value!.trimEnd().split('\n').length, 1000);
      // Remove a returned row and an unread row, and add a row before the next
      // fetch. OFFSET pagination would omit or replace an original snapshot row.
      await writer`DELETE FROM invoices WHERE internal_number IN (${expected[0].internal_number}, ${expected[1001].internal_number})`;
      await writer`INSERT INTO invoices (organization_id, vendor_id, internal_number, invoice_number, invoice_date)
      VALUES (${org}, ${vendor}, 'NEW', 'NEW', '2026-01-02')`;
      const lines = first.value!.trimEnd().split('\n');
      for await (const chunk of chunks) {
        const batch = chunk.trimEnd().split('\n');
        assert.ok(batch.length <= 1000);
        lines.push(...batch);
      }
      // CSV's second column is internalNumber.
      assert.deepEqual(
        lines.map((line) => line.split(',')[1]),
        expected.map((row) => row.internal_number),
      );

      const cancelled = service.csvChunks('invoices', org, {});
      await cancelled.next();
      await cancelled.next();
      await cancelled.return();
      // max:1 forces reuse of the cursor's connection. A leaked portal would
      // block this query until the test deadline.
      assert.equal((await reader`SELECT 1 AS released`)[0].released, 1);
      const portals = await reader`SELECT statement FROM pg_cursors`;
      assert.ok(portals.every((portal) => !portal.statement.includes('FROM invoices i')));
    } finally {
      await Promise.all([reader.end({ timeout: 5 }), writer.end({ timeout: 5 })]);
      if (created) await admin`DROP DATABASE ${admin(name)}`;
      await admin.end({ timeout: 5 });
    }
  },
);
