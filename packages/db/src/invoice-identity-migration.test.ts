import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = join(__dirname, 'migrations', '20260907231212_invoice_identity.sql');

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
    await assert.rejects(db.exec(await readFile(migrationPath, 'utf8')), (error: unknown) => {
      assert.match(String(error), /Duplicate vendor invoice identities/);
      assert.match((error as { hint: string }).hint, /reconcile historical records with finance/);
      return true;
    });
    assert.equal((await db.query('SELECT * FROM invoices')).rows.length, 2);
  } finally {
    await db.close();
  }
});
