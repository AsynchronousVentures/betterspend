import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = join(__dirname, 'migrations', '20260830222943_chief_invisible_woman.sql');

const organizationId = '00000000-0000-4000-8000-000000000001';
const invoiceId = '00000000-0000-4000-8000-000000000002';
const vendorId = '00000000-0000-4000-8000-000000000003';
const userId = '00000000-0000-4000-8000-000000000004';
const alertId = '00000000-0000-4000-8000-000000000005';
const ocrId = '00000000-0000-4000-8000-000000000006';
const intakeId = '00000000-0000-4000-8000-000000000007';

async function createSourceDatabase(): Promise<PGlite> {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE users (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      UNIQUE (id, organization_id)
    );
    CREATE TABLE vendors (id uuid PRIMARY KEY);
    CREATE TABLE invoices (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      vendor_id uuid NOT NULL,
      status varchar(30) NOT NULL,
      match_status varchar(20) NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (id, organization_id)
    );
    CREATE TABLE spend_guard_alerts (
      id uuid PRIMARY KEY,
      org_id uuid NOT NULL,
      alert_type varchar(50) NOT NULL,
      severity varchar(20) NOT NULL,
      record_type varchar(50) NOT NULL,
      record_id uuid NOT NULL,
      details jsonb NOT NULL,
      status varchar(20) NOT NULL
    );
    CREATE TABLE ocr_jobs (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      invoice_id uuid,
      status varchar(20) NOT NULL
    );
    CREATE TABLE email_intake_items (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      created_draft_id uuid,
      created_draft_type varchar(30),
      status varchar(30) NOT NULL
    );
    INSERT INTO organizations (id) VALUES ('${organizationId}');
    INSERT INTO users (id, organization_id) VALUES ('${userId}', '${organizationId}');
    INSERT INTO vendors (id) VALUES ('${vendorId}');
    INSERT INTO invoices (
      id, organization_id, vendor_id, status, match_status, created_at, updated_at
    ) VALUES (
      '${invoiceId}', '${organizationId}', '${vendorId}', 'approved', 'exception',
      '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z'
    );
    INSERT INTO spend_guard_alerts (
      id, org_id, alert_type, severity, record_type, record_id, details, status
    ) VALUES (
      '${alertId}', '${organizationId}', 'duplicate_invoice', 'high', 'invoice',
      '${invoiceId}', '{}', 'open'
    );
    INSERT INTO ocr_jobs (id, organization_id, invoice_id, status)
      VALUES ('${ocrId}', '${organizationId}', '${invoiceId}', 'processing');
    INSERT INTO email_intake_items (
      id, organization_id, created_draft_id, created_draft_type, status
    ) VALUES ('${intakeId}', '${organizationId}', '${invoiceId}', 'invoice', 'pending_review');
  `);
  return database;
}

test('invoice review migration backfills active exceptions idempotently without changing invoices', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  const backfill = migration.slice(
    migration.indexOf('-- Seed only active unpaid exception sources.'),
  );
  const database = await createSourceDatabase();
  try {
    await database.exec(migration);

    const invoiceBeforeRerun = await database.query<{
      status: string;
      matchStatus: string;
    }>(`SELECT status, match_status AS "matchStatus" FROM invoices WHERE id = '${invoiceId}'`);
    const firstCounts = await database.query<{ cases: string; signals: string }>(
      `SELECT
         (SELECT count(*)::text FROM invoice_review_cases) AS cases,
         (SELECT count(*)::text FROM invoice_review_signals) AS signals`,
    );
    assert.deepEqual(firstCounts.rows, [{ cases: '1', signals: '4' }]);

    await database.exec(backfill);

    const secondCounts = await database.query<{ cases: string; signals: string }>(
      `SELECT
         (SELECT count(*)::text FROM invoice_review_cases) AS cases,
         (SELECT count(*)::text FROM invoice_review_signals) AS signals`,
    );
    assert.deepEqual(secondCounts.rows, firstCounts.rows);
    assert.deepEqual(invoiceBeforeRerun.rows, [{ status: 'approved', matchStatus: 'exception' }]);

    const state = await database.query<{ state: string; blocking: string }>(
      `SELECT
         state,
         (SELECT count(*)::text FROM invoice_review_signals
          WHERE status = 'open' AND severity = 'blocking') AS blocking
       FROM invoice_review_cases`,
    );
    assert.deepEqual(state.rows, [{ state: 'open', blocking: '4' }]);
  } finally {
    await database.close();
  }
});
