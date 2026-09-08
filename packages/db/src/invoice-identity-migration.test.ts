import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type postgres from 'postgres';
import { prepareInvoiceIdentityIndex } from './invoice-identity-migration';

const migrationPath = join(__dirname, 'migrations', '20260907231212_invoice_identity.sql');

function pgliteSql(db: PGlite): postgres.Sql {
  return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    assert.equal(values.length, 0);
    return (await db.query(strings.join('').replace(/\bCONCURRENTLY\b/g, ''))).rows;
  }) as unknown as postgres.Sql;
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE invoices (
    id integer PRIMARY KEY, organization_id text NOT NULL, vendor_id text NOT NULL,
    invoice_number text NOT NULL, status text NOT NULL DEFAULT 'pending_match'
  )`);
  return db;
}

test('invoice identity migration preserves exact identity across vendors and organizations', async () => {
  const db = await fixture();
  try {
    await db.exec(await readFile(migrationPath, 'utf8'));
    await prepareInvoiceIdentityIndex(pgliteSql(db));
    await prepareInvoiceIdentityIndex(pgliteSql(db));
    await db.exec("INSERT INTO invoices VALUES (1, 'org', 'vendor', 'INV-1')");
    for (const status of ['pending_match', 'paid', 'cancelled', 'rejected']) {
      await assert.rejects(
        db.query("INSERT INTO invoices VALUES (2, 'org', 'vendor', 'INV-1', $1)", [status]),
        (error: unknown) => (error as { code?: string }).code === '23505',
      );
    }
    await db.exec(`INSERT INTO invoices VALUES
      (2, 'org', 'other', 'INV-1'), (3, 'other', 'vendor', 'INV-1'),
      (4, 'org', 'vendor', 'inv-1'), (5, 'org', 'vendor', 'INV-1 ');
      INSERT INTO invoices VALUES (6, 'org', 'other', 'INV-2');`);
    await assert.rejects(
      db.exec("UPDATE invoices SET vendor_id = 'vendor' WHERE id = 2"),
      (error: unknown) => (error as { code?: string }).code === '23505',
    );
    assert.equal((await db.query('SELECT * FROM invoices')).rows.length, 6);
  } finally {
    await db.close();
  }
});

test('existing duplicates stop migration with a reconciliation hint and preserve records', async () => {
  const db = await fixture();
  try {
    await db.exec(
      "INSERT INTO invoices VALUES (1, 'org', 'vendor', 'INV-1'), (2, 'org', 'vendor', 'INV-1')",
    );
    await assert.rejects(prepareInvoiceIdentityIndex(pgliteSql(db)), (error: unknown) => {
      assert.match(String(error), /Duplicate vendor invoice identities/);
      assert.match((error as { hint: string }).hint, /reconcile historical records with finance/);
      return true;
    });
    assert.equal((await db.query('SELECT * FROM invoices')).rows.length, 2);
  } finally {
    await db.close();
  }
});

test('invoice identity marker is backed by the concurrent runner and verifier', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  const runner = await readFile(join(__dirname, 'migrate.ts'), 'utf8');
  const helper = await readFile(join(__dirname, 'invoice-identity-migration.ts'), 'utf8');
  const verifier = await readFile(join(__dirname, 'verify-migrations.ts'), 'utf8');
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX/i);
  assert.ok(
    runner.indexOf('await prepareInvoiceIdentityIndex(client)') >
      runner.indexOf('await migrate(db,'),
  );
  assert.match(helper, /CREATE UNIQUE INDEX CONCURRENTLY/);
  assert.match(helper, /DROP INDEX CONCURRENTLY/);
  assert.match(verifier, /invoices_org_vendor_number_unique/);
});

test('unexpected same-name index fails closed rather than accepting partial uniqueness', async () => {
  const db = await fixture();
  try {
    await db.exec(
      "CREATE UNIQUE INDEX invoices_org_vendor_number_unique ON invoices (organization_id, vendor_id, invoice_number) WHERE status <> 'cancelled'",
    );
    await assert.rejects(prepareInvoiceIdentityIndex(pgliteSql(db)), /unexpected definition/);
  } finally {
    await db.close();
  }
});
