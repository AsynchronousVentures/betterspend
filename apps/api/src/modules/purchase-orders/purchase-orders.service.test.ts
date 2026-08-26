import assert from 'node:assert/strict';
import test from 'node:test';
import { purchaseOrderScopeEntityId } from './purchase-orders.service';

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
