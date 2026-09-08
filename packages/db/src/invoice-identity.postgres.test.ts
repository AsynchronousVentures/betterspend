import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import postgres from 'postgres';
import { prepareInvoiceIdentityIndex } from './invoice-identity-migration';

const url = process.env.FINANCIAL_TEST_DATABASE_URL;
// Requires a disposable PostgreSQL instance with CREATEDB. No existing tables
// are changed: the test owns and removes a separate synthetic database.
test(
  'concurrent invoice index retries invalid builds and keeps writes available',
  { skip: !url, timeout: 30_000 },
  async () => {
    const admin = postgres(url!, { max: 1 });
    const name = `identity_test_${randomUUID().replaceAll('-', '')}`;
    const testUrl = new URL(url!);
    testUrl.pathname = `/${name}`;
    let created = false;
    const builder = postgres(testUrl.toString(), { max: 1 });
    const writer = postgres(testUrl.toString(), { max: 2 });
    try {
      await admin`CREATE DATABASE ${admin(name)}`;
      created = true;
      await builder`CREATE TABLE invoices (id integer PRIMARY KEY, organization_id text NOT NULL, vendor_id text NOT NULL, invoice_number text NOT NULL)`;
      await builder`INSERT INTO invoices VALUES (1, 'org', 'vendor', 'one'), (2, 'org', 'vendor', 'one')`;
      await assert.rejects(
        builder`CREATE UNIQUE INDEX CONCURRENTLY invoices_org_vendor_number_unique ON invoices (organization_id, vendor_id, invoice_number)`,
        (error: unknown) => (error as { code?: string }).code === '23505',
      );
      const [failed] =
        await builder`SELECT indisvalid FROM pg_index WHERE indexrelid = 'invoices_org_vendor_number_unique'::regclass`;
      assert.equal(failed.indisvalid, false);
      await builder`DELETE FROM invoices WHERE id = 2`;
      await prepareInvoiceIdentityIndex(builder);
      const [repaired] =
        await builder`SELECT indexrelid::text AS id, indisvalid FROM pg_index WHERE indexrelid = 'invoices_org_vendor_number_unique'::regclass`;
      assert.equal(repaired.indisvalid, true);
      await prepareInvoiceIdentityIndex(builder);
      const [again] =
        await builder`SELECT indexrelid::text AS id FROM pg_index WHERE indexrelid = 'invoices_org_vendor_number_unique'::regclass`;
      assert.equal(again.id, repaired.id);

      await builder`DROP INDEX CONCURRENTLY invoices_org_vendor_number_unique`;
      let building: Promise<void> | undefined;
      try {
        await writer.begin(async (held) => {
          await held`INSERT INTO invoices VALUES (3, 'org', 'vendor', 'three')`;
          building = prepareInvoiceIdentityIndex(builder);
          // Observe the real concurrent-build phase instead of guessing when its
          // lock is held. The open writer makes this phase deterministic.
          let waiting = false;
          for (let attempt = 0; attempt < 300; attempt++) {
            const rows =
              await writer`SELECT phase FROM pg_stat_progress_create_index WHERE relid = 'invoices'::regclass`;
            if (rows.some((row) => row.phase === 'waiting for writers before build')) {
              waiting = true;
              break;
            }
            await setTimeout(10);
          }
          assert.ok(waiting, 'concurrent builder must wait for the existing writer');
          await writer`SET statement_timeout = '5s'`;
          await writer`INSERT INTO invoices VALUES (4, 'org', 'vendor', 'four')`;
        });
      } finally {
        await building;
      }
      await assert.rejects(
        writer`INSERT INTO invoices VALUES (5, 'org', 'vendor', 'four')`,
        (error: unknown) => (error as { code?: string }).code === '23505',
      );
    } finally {
      await Promise.all([builder.end({ timeout: 5 }), writer.end({ timeout: 5 })]);
      if (created) await admin`DROP DATABASE ${admin(name)}`;
      await admin.end({ timeout: 5 });
    }
  },
);
