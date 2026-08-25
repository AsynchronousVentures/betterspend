import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RANDOM_COUNT,
  DEFAULT_RANDOM_SEED,
  MAX_RANDOM_COUNT,
  assertRandomSeedCountMatches,
  generateRandomSeedDataset,
  parseRandomSeedArgs,
  randomSeedRequisitionPrefix,
  stableBusinessNumber,
  stableUuid,
} from './random-seed';
import { materializeWebhookSecrets } from './random-seed-secrets';

test('parses defaults and explicit workload options', () => {
  assert.deepEqual(parseRandomSeedArgs([]), {
    count: DEFAULT_RANDOM_COUNT,
    seed: DEFAULT_RANDOM_SEED,
    help: false,
  });
  assert.deepEqual(parseRandomSeedArgs(['--count', '12', '--seed', '42']), {
    count: 12,
    seed: '42',
    help: false,
  });
  assert.deepEqual(parseRandomSeedArgs(['--count=12', '--seed=42', '--help']), {
    count: 12,
    seed: '42',
    help: true,
  });
});

test('rejects malformed and unknown options', () => {
  assert.throws(() => parseRandomSeedArgs(['--count', '0']), /between/);
  assert.throws(() => parseRandomSeedArgs(['--count', String(MAX_RANDOM_COUNT + 1)]), /between/);
  assert.throws(() => parseRandomSeedArgs(['--count', 'nope']), /positive integer/);
  assert.throws(() => parseRandomSeedArgs(['--seed']), /requires a value/);
  assert.throws(() => parseRandomSeedArgs(['--wat', '1']), /Unknown option/);
});

test('requires an existing seed namespace to keep its original count', () => {
  assert.equal(randomSeedRequisitionPrefix('42'), 'REQ-73475CB4-');
  assert.doesNotThrow(() => assertRandomSeedCountMatches('42', 100, 0));
  assert.doesNotThrow(() => assertRandomSeedCountMatches('42', 100, 100));
  assert.throws(
    () => assertRandomSeedCountMatches('42', 500, 100),
    /already has 100 generated requisitions.*requested 500.*new --seed/,
  );
});

test('generates identical graphs for the same seed and count', () => {
  const first = generateRandomSeedDataset({ count: 12, seed: '42' });
  const second = generateRandomSeedDataset({ count: 12, seed: '42' });
  assert.deepEqual(first, second);
  assert.equal(first.requisitions.length, 12);
  assert.equal(first.requisitionLines.length > first.requisitions.length, true);
});

test('changes generated values for a different seed', () => {
  const first = generateRandomSeedDataset({ count: 8, seed: 'alpha' });
  const second = generateRandomSeedDataset({ count: 8, seed: 'beta' });
  assert.notEqual(first.requisitions[0]?.id, second.requisitions[0]?.id);
  assert.notEqual(first.requisitions[0]?.number, second.requisitions[0]?.number);
});

test('keeps IDs and business numbers unique', () => {
  const dataset = generateRandomSeedDataset({ count: 50, seed: 'unique-test' });
  const ids = dataset.requisitions.map((row) => row.id as string);
  const numbers = dataset.requisitions.map((row) => row.number as string);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(numbers).size, numbers.length);
  assert.equal(stableUuid('x', 'requisition', 1), stableUuid('x', 'requisition', 1));
  assert.notEqual(stableUuid('x', 'requisition', 1), stableUuid('x', 'requisition', 2));
  assert.equal(stableBusinessNumber('x', 'REQ', 1), stableBusinessNumber('x', 'REQ', 1));
});

test('keeps requisition totals and cross references coherent', () => {
  const dataset = generateRandomSeedDataset({ count: 30, seed: 'integrity-test' });
  for (const requisition of dataset.requisitions) {
    const lines = dataset.requisitionLines.filter((line) => line.requisitionId === requisition.id);
    const total = lines.reduce((sum, line) => sum + Number(line.totalPrice), 0);
    assert.equal(Number(requisition.totalAmount), Number(total.toFixed(2)));
  }
  const requisitionIds = new Set(dataset.requisitions.map((row) => row.id));
  for (const line of dataset.requisitionLines)
    assert.equal(requisitionIds.has(line.requisitionId), true);
  const poIds = new Set(dataset.purchaseOrders.map((row) => row.id));
  for (const line of dataset.poLines) assert.equal(poIds.has(line.purchaseOrderId), true);
  const invoiceIds = new Set(dataset.invoices.map((row) => row.id));
  for (const line of dataset.invoiceLines) assert.equal(invoiceIds.has(line.invoiceId), true);
  const dates = dataset.requisitions.map((row) => (row.createdAt as Date).getTime());
  assert.equal(Math.min(...dates) < Date.UTC(2026, 7, 25), true);
  assert.equal(
    dataset.requisitions.some((row) => (row.neededBy as Date).getTime() > Date.UTC(2026, 7, 25)),
    true,
  );
});

test('uses migration-safe budget enforcement modes', () => {
  const allowedModes = new Set(['hard_stop', 'owner_approval', 'visibility_only']);
  const dataset = generateRandomSeedDataset({ count: 12, seed: 'budget-mode-test' });
  for (const budget of dataset.budgets)
    assert.equal(allowedModes.has(budget.enforcementMode ?? ''), true);
});

test('materializes webhook secrets outside the deterministic graph', () => {
  const dataset = generateRandomSeedDataset({ count: 4, seed: 'webhook-secret-test' });
  const source = dataset.webhookEndpoints[0];
  assert.ok(source);
  assert.equal(Object.prototype.hasOwnProperty.call(source, 'secret'), false);
  const materialized = materializeWebhookSecrets(dataset.webhookEndpoints, () => 'a'.repeat(64));
  assert.equal(Object.prototype.hasOwnProperty.call(materialized[0], 'secret'), true);
  assert.equal(materialized[0]?.secret, 'a'.repeat(64));
});

test('keeps core lifecycle timestamps and money allocations coherent', () => {
  const dataset = generateRandomSeedDataset({ count: 500, seed: 'temporal-money-test' });
  const requisitionsById = new Map(dataset.requisitions.map((row) => [row.id, row]));
  const purchaseOrdersById = new Map(dataset.purchaseOrders.map((row) => [row.id, row]));
  const receiptsByPoId = new Map(dataset.goodsReceipts.map((row) => [row.purchaseOrderId, row]));
  const invoicesById = new Map(dataset.invoices.map((row) => [row.id, row]));
  const approvalAtByRequisitionId = new Map<string, number>();
  const dateValue = (value: Date | string | null | undefined): number =>
    value instanceof Date ? value.getTime() : value ? new Date(value).getTime() : 0;
  const cents = (value: string | number | null | undefined): number =>
    Math.round(Number(value ?? 0) * 100);

  for (const requisition of dataset.requisitions) {
    const created = dateValue(requisition.createdAt);
    assert.equal(dateValue(requisition.updatedAt) >= created, true);
    if (requisition.submittedAt) assert.equal(dateValue(requisition.submittedAt) >= created, true);
  }
  for (const approval of dataset.approvalRequests) {
    const requisition = requisitionsById.get(approval.approvableId);
    if (approval.approvableType !== 'requisition' || !requisition) continue;
    assert.equal(dateValue(approval.createdAt) >= dateValue(requisition.createdAt), true);
    assert.equal(dateValue(approval.updatedAt) >= dateValue(approval.createdAt), true);
    if (approval.status !== 'pending') {
      const action = dataset.approvalActions.find(
        (candidate) => candidate.approvalRequestId === approval.id,
      );
      if (action && requisition.id)
        approvalAtByRequisitionId.set(requisition.id, dateValue(action.actedAt));
    }
  }
  for (const purchaseOrder of dataset.purchaseOrders) {
    const requisition = requisitionsById.get(purchaseOrder.requisitionId ?? '');
    if (!requisition) throw new Error(`Missing requisition ${purchaseOrder.requisitionId}`);
    if (!requisition.id) throw new Error('Requisition is missing an ID');
    if (!purchaseOrder.id) throw new Error('Purchase order is missing an ID');
    const requisitionMilestone =
      approvalAtByRequisitionId.get(requisition.id) || dateValue(requisition.submittedAt);
    assert.equal(
      dateValue(purchaseOrder.createdAt) >=
        Math.max(requisitionMilestone, dateValue(requisition.createdAt)),
      true,
    );
    assert.equal(dateValue(purchaseOrder.updatedAt) >= dateValue(purchaseOrder.createdAt), true);
    if (purchaseOrder.issuedAt)
      assert.equal(dateValue(purchaseOrder.issuedAt) >= dateValue(purchaseOrder.createdAt), true);

    const lines = dataset.poLines.filter((line) => line.purchaseOrderId === purchaseOrder.id);
    assert.equal(
      cents(purchaseOrder.subtotal),
      lines.reduce((sum, line) => sum + cents(line.totalPrice), 0),
    );
    assert.equal(
      cents(purchaseOrder.taxAmount),
      lines.reduce((sum, line) => sum + cents(line.taxAmount), 0),
    );
    assert.equal(
      cents(purchaseOrder.totalAmount),
      cents(purchaseOrder.subtotal) + cents(purchaseOrder.taxAmount),
    );

    const receipt = receiptsByPoId.get(purchaseOrder.id);
    if (receipt) {
      assert.equal(
        dateValue(receipt.receivedDate) >=
          dateValue(purchaseOrder.issuedAt ?? purchaseOrder.createdAt),
        true,
      );
      assert.equal(dateValue(receipt.updatedAt) >= dateValue(receipt.createdAt), true);
    }
  }
  for (const invoice of dataset.invoices) {
    const purchaseOrder = purchaseOrdersById.get(invoice.purchaseOrderId ?? '');
    if (!purchaseOrder) throw new Error(`Missing purchase order ${invoice.purchaseOrderId}`);
    if (!purchaseOrder.id) throw new Error('Purchase order is missing an ID');
    const receipt = receiptsByPoId.get(purchaseOrder.id);
    assert.equal(
      dateValue(invoice.createdAt) >=
        dateValue(receipt?.receivedDate ?? purchaseOrder.issuedAt ?? purchaseOrder.createdAt),
      true,
    );
    assert.equal(dateValue(invoice.updatedAt) >= dateValue(invoice.createdAt), true);
    if (invoice.approvedAt)
      assert.equal(dateValue(invoice.approvedAt) >= dateValue(invoice.createdAt), true);
    if (invoice.paidAt)
      assert.equal(
        dateValue(invoice.paidAt) >= dateValue(invoice.approvedAt ?? invoice.createdAt),
        true,
      );

    const lines = dataset.invoiceLines.filter((line) => line.invoiceId === invoice.id);
    assert.equal(
      cents(invoice.subtotal),
      lines.reduce((sum, line) => sum + cents(line.totalPrice), 0),
    );
    assert.equal(
      cents(invoice.taxAmount),
      lines.reduce((sum, line) => sum + cents(line.taxAmount), 0),
    );
    assert.equal(cents(invoice.totalAmount), cents(invoice.subtotal) + cents(invoice.taxAmount));
    assert.equal(invoicesById.get(invoice.id)?.id, invoice.id);
  }

  for (const run of dataset.paymentRuns) {
    const links = dataset.paymentRunInvoices.filter((link) => link.paymentRunId === run.id);
    assert.equal(
      cents(run.totalAmount),
      links.reduce((sum, link) => sum + cents(link.amount), 0),
    );
    assert.equal(dateValue(run.updatedAt) >= dateValue(run.createdAt), true);
    for (const link of links) {
      const invoice = invoicesById.get(link.invoiceId);
      assert.ok(invoice);
      assert.equal(
        dateValue(run.createdAt) >=
          dateValue(invoice.paidAt ?? invoice.approvedAt ?? invoice.createdAt),
        true,
      );
    }
  }
});
