import assert from 'node:assert/strict';
import test from 'node:test';
import { createChangeOrderSnapshot, purchaseOrderScopeEntityId } from './purchase-orders.service';

test('purchase-order create scope uses the linked requisition entity', () => {
  assert.equal(
    purchaseOrderScopeEntityId(
      { entityId: 'caller-entity', requisitionId: 'requisition-1' },
      { entityId: 'requisition-entity' },
    ),
    'requisition-entity',
  );
  assert.equal(
    purchaseOrderScopeEntityId({ entityId: 'caller-entity', requisitionId: 'requisition-1' }, {}),
    null,
  );
  assert.equal(
    purchaseOrderScopeEntityId({ entityId: 'caller-entity', requisitionId: undefined }, null),
    'caller-entity',
  );
});

test('change-order snapshots omit caller-filtered related records', () => {
  const snapshot = createChangeOrderSnapshot({
    id: 'po-1',
    number: 'PO-001',
    lines: [{ id: 'line-1', description: 'Paper', matchedContract: { id: 'contract-1' } }],
    goodsReceipts: [{ id: 'receipt-1' }],
    invoices: [{ id: 'invoice-1' }],
    commitmentEvents: [{ id: 'event-1' }],
  });

  assert.deepEqual(snapshot, {
    po: { id: 'po-1', number: 'PO-001' },
    lines: [{ id: 'line-1', description: 'Paper' }],
  });
});
