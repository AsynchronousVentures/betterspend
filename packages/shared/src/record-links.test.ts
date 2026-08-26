import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPROVABLE_RECORD_KINDS,
  RECORD_ROUTES,
  type RecordKind,
  isApprovableRecordKind,
  isRecordKind,
  recordHref,
} from './record-links';

test('resolves workflow requisition and RFQ references to canonical routes', () => {
  assert.equal(recordHref({ kind: 'requisition', id: 'req-1' }), '/requisitions/req-1');
  assert.equal(recordHref({ kind: 'rfq', id: 'rfq-1' }), '/rfq/rfq-1');
});

test('keeps every record type on the shared canonical route map', () => {
  for (const [kind, route] of Object.entries(RECORD_ROUTES)) {
    assert.equal(isRecordKind(kind), true);
    const href = recordHref({ kind: kind as RecordKind, id: `${kind}-1` });
    assert.equal(
      href,
      kind === 'payment_run'
        ? `/payment-runs?run=${kind}-1`
        : kind === 'gl_export_job'
          ? `/gl-mappings?view=export-history&job=${kind}-1`
          : `/${route}/${kind}-1`,
    );
  }

  for (const kind of APPROVABLE_RECORD_KINDS) {
    assert.equal(isApprovableRecordKind(kind), true);
  }
  assert.equal(isApprovableRecordKind('rfq'), false);
  assert.equal(isRecordKind('goods_receipt'), false);
});

test('encodes record identifiers before constructing a route', () => {
  assert.equal(recordHref({ kind: 'rfq', id: 'rfq/with spaces' }), '/rfq/rfq%2Fwith%20spaces');
  assert.equal(recordHref({ kind: 'payment_run', id: 'run/with spaces' }), '/payment-runs?run=run%2Fwith%20spaces');
});

test('fails explicitly when a caller tries to link a record without an id', () => {
  assert.throws(() => recordHref({ kind: 'invoice', id: '' }), /without an id/);
});
