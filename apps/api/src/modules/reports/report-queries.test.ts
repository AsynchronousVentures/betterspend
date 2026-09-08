import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { ReportsService } from './reports.service';
import { SupplierScorecardService } from '../supplier-scorecard/supplier-scorecard.service';

const org = '00000000-0000-4000-8000-000000000001';
const vendor = '00000000-0000-4000-8000-000000000002';

test('reports and scorecards execute against migrated PostgreSQL schema', async () => {
  const database = new PGlite();
  try {
    const directory = join(process.cwd(), '../../packages/db/src/migrations');
    for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      await database.exec(await readFile(join(directory, file), 'utf8'));
    }
    await database.exec(`
      INSERT INTO organizations (id, name, slug) VALUES ('${org}', 'Report test', 'report-test');
      INSERT INTO vendors (id, organization_id, name, code) VALUES ('${vendor}', '${org}', 'Vendor', 'VEN');
      INSERT INTO purchase_orders (id, organization_id, vendor_id, number, status)
        VALUES ('00000000-0000-4000-8000-000000000003', '${org}', '${vendor}', 'PO-TEST', 'issued');
      INSERT INTO invoices (id, organization_id, vendor_id, purchase_order_id, internal_number, invoice_number, invoice_date, status, total_amount)
        VALUES ('00000000-0000-4000-8000-000000000004', '${org}', '${vendor}', '00000000-0000-4000-8000-000000000003', 'INV-TEST', 'SUP-TEST', CURRENT_DATE, 'approved', 100);
    `);
    await database.exec(`
      INSERT INTO users (id, organization_id, name, email) VALUES ('00000000-0000-4000-8000-000000000005', '${org}', 'User', 'report@example.test');
      INSERT INTO requisitions (id, organization_id, requester_id, number, title) VALUES ('00000000-0000-4000-8000-000000000006', '${org}', '00000000-0000-4000-8000-000000000005', 'REQ-TEST', 'Request');
      INSERT INTO catalog_items (id, organization_id, name, category) VALUES ('00000000-0000-4000-8000-000000000007', '${org}', 'Item', 'Hardware');
      INSERT INTO po_lines (id, purchase_order_id, catalog_item_id, line_number, description, quantity, unit_price, total_price) VALUES ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000007', 1, 'Item', 1, 100, 100);
      INSERT INTO invoice_lines (id, invoice_id, po_line_id, line_number, description, quantity, unit_price, total_price, base_total_price) VALUES ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000008', 1, 'Item', 1, 102, 102, 102);
      INSERT INTO goods_receipts (organization_id, purchase_order_id, number, received_by, received_date) VALUES ('${org}', '00000000-0000-4000-8000-000000000003', 'GRN-TEST', '00000000-0000-4000-8000-000000000005', CURRENT_TIMESTAMP);
    `);
    const db = {
      execute: async (statement: SQL) => {
        const query = new PgDialect().sqlToQuery(statement);
        return (await database.query(query.sql, query.params)).rows;
      },
    };
    const reports = new ReportsService(db as never);
    for (const reportType of [
      'spend_by_vendor',
      'spend_by_department',
      'spend_by_category',
      'po_status_summary',
      'invoice_aging',
      'approval_cycle_time',
    ]) {
      await reports.runCustomReport(org, { reportType });
    }
    assert.match(await reports.exportPOs(org), /PO-TEST/);
    assert.match(await reports.exportInvoices(org), /INV-TEST/);
    assert.match(await reports.exportRequisitions(org), /REQ-TEST/);
    await reports.exportSpendSummary(org);
    await reports.exportBudgets(org);
    await reports.exportDepartmentSpend(org);
    await reports.exportApAging(org);
    assert.match(await reports.exportGrnSummary(org), /GRN-TEST/);
    assert.deepEqual(await reports.runCustomReport(org, { reportType: 'spend_by_category' }), [
      { category: 'Hardware', lineCount: 1, totalSpend: '102.00' },
    ]);
    const scorecards = new SupplierScorecardService(db);
    const scores = await scorecards.listScores(org);
    assert.equal(scores.length, 1);
    assert.equal(scores[0].totalPos, 1);
    assert.equal(scores[0].deliveryScore, null);
    assert.equal(scores[0].qualityScore, null);
    assert.equal(scores[0].priceScore, null);
    assert.equal(scores[0].overallScore, null);
    const detail = await scorecards.getDetail(org, vendor);
    assert.equal(detail.recentPos[0].poNumber, 'PO-TEST');
    assert.equal(detail.recentPos[0].expectedDeliveryDate, null);
    assert.equal(detail.scores.priceScore, null);
    assert.equal(detail.trend[0].priceScore, null);
    await database.exec(
      `INSERT INTO match_results (invoice_line_id, po_line_id, price_variance) VALUES ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000008', 2)`,
    );
    assert.equal((await scorecards.listScores(org))[0].priceScore, 80);
    const priced = await scorecards.getDetail(org, vendor);
    assert.equal(priced.scores.priceScore, 80);
    assert.equal(priced.trend[0].priceScore, 80);
    const hidden = { scopeFor: () => ({ unrestricted: false, entityIds: [] }) } as never;
    assert.deepEqual(await scorecards.listScores(org, 50, hidden), []);
    await assert.rejects(scorecards.getDetail(org, vendor, hidden), /not found/);
    const noScope = {
      organizationId: org,
      userId: vendor,
      unrestricted: false,
      ownOnly: false,
      departmentIds: [],
      projectIds: [],
      entityIds: [],
    };
    assert.equal(await reports.exportPOs(org, undefined, noScope), '');
    assert.deepEqual(
      await reports.runCustomReport(org, { reportType: 'spend_by_category' }, noScope),
      [],
    );
    assert.deepEqual(await scorecards.listScores('00000000-0000-4000-8000-000000000099'), []);
  } finally {
    await database.close();
  }
});
