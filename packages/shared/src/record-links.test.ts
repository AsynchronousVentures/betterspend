import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPROVABLE_RECORD_KINDS,
  RECORD_ROUTES,
  isApprovableRecordKind,
  isRecordKind,
  recordHref,
} from './record-links';

test('resolves workflow requisition and RFQ references to canonical routes', () => {
  assert.equal(recordHref({ kind: 'requisition', id: 'req-1' }), '/requisitions/req-1');
  assert.equal(recordHref({ kind: 'rfq', id: 'rfq-1' }), '/rfq/rfq-1');
});

test('keeps every approval type on the shared canonical route map', () => {
  for (const [kind, route] of Object.entries(RECORD_ROUTES)) {
    assert.equal(isRecordKind(kind), true);
    assert.equal(recordHref({ kind, id: `${kind}-1` }), `/${route}/${kind}-1`);
  }

  for (const kind of APPROVABLE_RECORD_KINDS) {
    assert.equal(isApprovableRecordKind(kind), true);
  }
  assert.equal(isApprovableRecordKind('rfq'), false);
  assert.equal(isRecordKind('goods_receipt'), false);
});

test('encodes record identifiers before constructing a route', () => {
  assert.equal(recordHref({ kind: 'rfq', id: 'rfq/with spaces' }), '/rfq/rfq%2Fwith%20spaces');
});
