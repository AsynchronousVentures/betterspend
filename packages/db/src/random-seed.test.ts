import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RANDOM_COUNT,
  DEFAULT_RANDOM_SEED,
  MAX_RANDOM_COUNT,
  assertRandomSeedMetadataMatches,
  assertRandomSeedCountMatches,
  decodeRandomSeedMetadata,
  encodeRandomSeedMetadata,
  generateRandomSeedDataset,
  parseRandomSeedArgs,
  randomSeedMetadataKey,
  randomSeedRequisitionPrefix,
  stableBusinessNumber,
  stableFraction,
  stableSeedDigest,
  stableSeedToken,
  stableUuid,
} from './random-seed';
import { materializeEmailIntakeTokens, materializeWebhookSecrets } from './random-seed-secrets';
import {
  DEMO_ORG_ID,
  DEMO_USER_ROLE_FIXTURES,
  DEMO_VENDOR_FIXTURES,
  DEMO_VENDOR_IDS,
  demoUserRoleNaturalKey,
  demoVendorNaturalKey,
} from './demo-fixtures';

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
  assert.equal(randomSeedRequisitionPrefix('42'), 'REQ-73475CB40A568E8DA8A045CED110137E-');
  assert.doesNotThrow(() => assertRandomSeedCountMatches('42', 100, 0));
  assert.doesNotThrow(() => assertRandomSeedCountMatches('42', 100, 100));
  assert.throws(
    () => assertRandomSeedCountMatches('42', 500, 100),
    /already has 100 generated requisitions.*requested 500.*new --seed/,
  );
});

test('uses durable metadata as the authority for repair reruns', () => {
  const seed = 'metadata-test';
  const digest = stableSeedDigest(seed);
  const key = randomSeedMetadataKey(seed);
  assert.equal(digest.length, 64);
  assert.equal(stableSeedToken(seed).length, 32);
  assert.equal(key, `random_seed_v1_${digest}`);
  assert.equal(key.length <= 100, true);
  const encoded = encodeRandomSeedMetadata(42);
  assert.deepEqual(decodeRandomSeedMetadata(encoded), { schemaVersion: 1, count: 42 });
  // The marker check intentionally has no current-row count. Missing rows are repaired by inserts.
  assert.doesNotThrow(() => assertRandomSeedMetadataMatches(seed, 42, encoded));
  assert.throws(
    () => assertRandomSeedMetadataMatches(seed, 43, encoded),
    /original count 42.*requested 43/,
  );
});

test('keeps seeded fractions in a half-open interval', () => {
  for (let index = 0; index < 100; index += 1) {
    const fraction = stableFraction('fraction-test', 'value', index);
    assert.equal(fraction >= 0 && fraction < 1, true);
  }
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

test('materializes email intake tokens outside the deterministic graph', () => {
  const dataset = generateRandomSeedDataset({ count: 4, seed: 'email-token-test' });
  const source = dataset.emailIntakeAddresses[0];
  assert.ok(source);
  assert.equal(Object.prototype.hasOwnProperty.call(source, 'token'), false);
  const materialized = materializeEmailIntakeTokens(dataset.emailIntakeAddresses, () =>
    'b'.repeat(40),
  );
  assert.equal(Object.prototype.hasOwnProperty.call(materialized[0], 'token'), true);
  assert.equal(materialized[0]?.token, 'b'.repeat(40));
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

  const invoiceAudits = dataset.auditLog.filter((row) => row.entityType === 'invoice');
  assert.equal(invoiceAudits.length, dataset.invoices.length);
  assert.deepEqual(
    new Set(invoiceAudits.map((row) => row.entityId)),
    new Set(dataset.invoices.map((row) => row.id)),
  );

  for (const contract of dataset.contracts) {
    const start = dateValue(contract.startDate);
    const end = dateValue(contract.endDate);
    assert.equal(end > start, true);
    if (contract.status === 'expired') assert.equal(end <= Date.UTC(2026, 7, 25), true);
    if (contract.status === 'expiring_soon') {
      assert.equal(end > Date.UTC(2026, 7, 25), true);
      assert.equal(end <= Date.UTC(2026, 9, 25), true);
    }
    if (contract.status === 'active' || contract.status === 'draft')
      assert.equal(end > Date.UTC(2026, 7, 25), true);
  }
});

test('normalizes every generated created and updated timestamp pair', () => {
  const dataset = generateRandomSeedDataset({ count: 250, seed: 'timestamp-pairs' });
  for (const tableRows of Object.values(dataset)) {
    if (!Array.isArray(tableRows)) continue;
    for (const row of tableRows) {
      const timestamped = row as { createdAt?: unknown; updatedAt?: unknown };
      if (timestamped.createdAt instanceof Date && timestamped.updatedAt instanceof Date)
        assert.equal(timestamped.updatedAt.getTime() >= timestamped.createdAt.getTime(), true);
    }
  }
});

test('keeps RFQ award state consistent with cancellation and responses', () => {
  const dataset = generateRandomSeedDataset({ count: 120, seed: 'rfq-state-test' });
  for (const rfq of dataset.rfqRequests) {
    const responses = dataset.rfqResponses.filter((response) => response.rfqId === rfq.id);
    const awardedResponses = responses.filter((response) => response.awarded);
    if (rfq.status === 'cancelled') {
      assert.equal(rfq.awardedVendorId, undefined);
      assert.equal(awardedResponses.length, 0);
    } else if (rfq.status === 'awarded') {
      assert.ok(rfq.awardedVendorId);
      assert.equal(awardedResponses.length, 1);
      assert.equal(awardedResponses[0]?.vendorId, rfq.awardedVendorId);
    } else {
      assert.equal(rfq.awardedVendorId, undefined);
      assert.equal(awardedResponses.length, 0);
    }
  }
});

test('keeps generated money references and vendor fixture reconciliation keys coherent', () => {
  const dataset = generateRandomSeedDataset({ count: 500, seed: 'secondary-coherence-test' });
  const cents = (value: string | number | null | undefined): number =>
    Math.round(Number(value ?? 0) * 100);
  const toBaseCents = (amountCents: number, currency: string): number =>
    Math.round(amountCents * (currency === 'EUR' ? 1.09 : currency === 'GBP' ? 1.27 : 1));
  const requisitionsById = new Map(dataset.requisitions.map((row) => [row.id, row]));
  const purchaseOrdersById = new Map(dataset.purchaseOrders.map((row) => [row.id, row]));
  const invoicesById = new Map(dataset.invoices.map((row) => [row.id, row]));

  const receiptIds = new Set(dataset.goodsReceipts.map((row) => row.id));
  const purchaseOrderIds = new Set(dataset.purchaseOrders.map((row) => row.id));
  const receiptMovements = dataset.inventoryMovements.filter(
    (row) => row.referenceType === 'goods_receipt',
  );
  assert.equal(receiptMovements.length > 0, true);
  for (const movement of dataset.inventoryMovements) {
    if (movement.referenceType === 'goods_receipt')
      assert.equal(receiptIds.has(movement.referenceId ?? ''), true);
    if (movement.referenceType === 'purchase_order')
      assert.equal(purchaseOrderIds.has(movement.referenceId ?? ''), true);
  }

  for (const event of dataset.budgetCommitmentEvents) {
    const requisition = requisitionsById.get(event.requisitionId ?? '');
    const purchaseOrder = purchaseOrdersById.get(event.purchaseOrderId ?? '');
    const invoice = invoicesById.get(event.invoiceId ?? '');
    if (event.eventType === 'requisition_reserved' && requisition) {
      assert.equal(
        cents(event.baseReservedDelta),
        toBaseCents(cents(requisition.totalAmount), requisition.currency ?? 'USD'),
      );
    }
    if (event.eventType === 'purchase_order_committed' && purchaseOrder) {
      assert.equal(
        cents(event.baseCommittedDelta),
        toBaseCents(cents(purchaseOrder.totalAmount), purchaseOrder.currency ?? 'USD'),
      );
      if (requisition)
        assert.equal(
          cents(event.baseReservedDelta),
          -toBaseCents(cents(requisition.totalAmount), requisition.currency ?? 'USD'),
        );
    }
    if (event.eventType === 'invoice_expended' && invoice) {
      assert.equal(
        cents(event.baseExpendedDelta),
        toBaseCents(cents(invoice.totalAmount), invoice.currency ?? 'USD'),
      );
      if (purchaseOrder)
        assert.equal(
          cents(event.baseCommittedDelta),
          -toBaseCents(cents(purchaseOrder.totalAmount), purchaseOrder.currency ?? 'USD'),
        );
    }
  }

  const rfqLinesById = new Map(dataset.rfqLines.map((row) => [row.id, row]));
  for (const response of dataset.rfqResponses) {
    const total = dataset.rfqResponseLines
      .filter((line) => line.responseId === response.id)
      .reduce((sum, line) => {
        const rfqLine = rfqLinesById.get(line.rfqLineId);
        return sum + Number(rfqLine?.quantity ?? 0) * cents(line.unitPrice);
      }, 0);
    assert.equal(cents(response.totalAmount), total);
  }

  assert.equal(
    dataset.invoices.some((invoice) => invoice.status === 'paid'),
    true,
  );
  assert.equal(
    dataset.invoices.some((invoice) => invoice.status === 'approved'),
    true,
  );
  assert.equal(
    dataset.invoices.some((invoice) => invoice.status === 'rejected'),
    true,
  );
  assert.equal(
    dataset.paymentRuns.some((run) => run.status === 'paid'),
    true,
  );
  assert.equal(
    dataset.glExportJobs.some((job) => job.status === 'exported'),
    true,
  );

  const invoiceNotifications = dataset.notifications.filter(
    (notification) => notification.entityType === 'invoice',
  );
  assert.equal(invoiceNotifications.length, dataset.invoices.length);
  for (const notification of invoiceNotifications) {
    const invoice = invoicesById.get(notification.entityId ?? '');
    assert.ok(invoice);
    if (invoice.status === 'pending_match') {
      assert.equal(notification.type, 'invoice_exception');
      assert.equal(notification.title, 'Invoice match requires review');
    } else if (invoice.status === 'rejected') {
      assert.equal(notification.type, 'invoice_exception');
      assert.equal(notification.title, 'Invoice rejected');
    } else {
      assert.equal(notification.type, 'invoice_approved');
      assert.equal(notification.title, 'Invoice approved');
    }
  }
  for (const card of dataset.vendorVirtualCards) {
    const invoice = invoicesById.get(card.invoiceId ?? '');
    assert.ok(invoice);
    assert.equal(card.currency, 'USD');
    assert.equal(
      cents(card.limitAmount),
      toBaseCents(cents(invoice.totalAmount), invoice.currency ?? 'USD'),
    );
  }

  const vendorByKey = new Map(
    DEMO_VENDOR_FIXTURES.map((vendor) => [demoVendorNaturalKey(vendor), vendor.id]),
  );
  assert.equal(
    vendorByKey.get(
      demoVendorNaturalKey({
        organizationId: DEMO_ORG_ID,
        code: 'ACME-SUP',
        name: 'legacy vendor row',
      }),
    ),
    DEMO_VENDOR_IDS[0],
  );
  const roleByKey = new Map(
    DEMO_USER_ROLE_FIXTURES.map((role) => [demoUserRoleNaturalKey(role), role.id]),
  );
  assert.equal(
    roleByKey.get(demoUserRoleNaturalKey(DEMO_USER_ROLE_FIXTURES[0])),
    '00000000-0000-0000-0000-000000000040',
  );
});

test('converts payable invoices to base-currency payment amounts and omits empty runs', () => {
  const dataset = generateRandomSeedDataset({ count: 500, seed: 'payment-currency-test' });
  const invoicesById = new Map(dataset.invoices.map((invoice) => [invoice.id, invoice]));
  const cents = (value: string | number | null | undefined): number =>
    Math.round(Number(value ?? 0) * 100);
  let checkedEurInvoice = false;
  for (const payment of dataset.paymentRunInvoices) {
    const invoice = invoicesById.get(payment.invoiceId);
    assert.ok(invoice);
    if (invoice.currency === 'EUR') {
      checkedEurInvoice = true;
      assert.equal(cents(payment.amount), Math.round(cents(invoice.totalAmount) * 1.09));
    }
  }
  assert.equal(checkedEurInvoice, true);
  for (const run of dataset.paymentRuns) {
    const payments = dataset.paymentRunInvoices.filter(
      (payment) => payment.paymentRunId === run.id,
    );
    assert.equal(
      cents(run.totalAmount),
      payments.reduce((sum, payment) => sum + cents(payment.amount), 0),
    );
  }

  const noPayables = generateRandomSeedDataset({ count: 1, seed: 'payment-empty-test' });
  assert.equal(noPayables.paymentRuns.length, 0);
  assert.equal(noPayables.paymentRunInvoices.length, 0);
});
