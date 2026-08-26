import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createChangeOrderSnapshot,
  purchaseOrderScopeEntityId,
  visibleRequisitionSummary,
} from './purchase-orders.service';

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

test('purchase-order requisition links require requisition access and expose only a summary', () => {
  const requisition = {
    id: 'req-1',
    number: 'REQ-001',
    requesterId: 'user-1',
    departmentId: 'department-1',
    projectId: 'project-1',
    description: 'private request details',
  };
  const deniedAccess = {
    can: () => false,
    scopeFor: () => ({
      organizationId: 'organization-1',
      userId: 'user-2',
      unrestricted: true,
      ownOnly: false,
      departmentIds: [],
      projectIds: [],
      entityIds: [],
    }),
    isGlobalBuiltInAdmin: () => false,
    toDocument: () => ({ permissions: [], scopes: {} }),
  } as Parameters<typeof visibleRequisitionSummary>[0];

  assert.equal(visibleRequisitionSummary(deniedAccess, requisition), null);
  assert.deepEqual(visibleRequisitionSummary(undefined, requisition), {
    id: 'req-1',
    number: 'REQ-001',
  });
});
