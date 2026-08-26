import assert from 'node:assert/strict';
import test from 'node:test';
import { recordHref } from './record-links';

test('resolves workflow requisition and RFQ references to canonical routes', () => {
  assert.equal(recordHref({ kind: 'requisition', id: 'req-1' }), '/requisitions/req-1');
  assert.equal(recordHref({ kind: 'rfq', id: 'rfq-1' }), '/rfq/rfq-1');
});

test('encodes record identifiers before constructing a route', () => {
  assert.equal(recordHref({ kind: 'rfq', id: 'rfq/with spaces' }), '/rfq/rfq%2Fwith%20spaces');
});
