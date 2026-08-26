import assert from 'node:assert/strict';
import test from 'node:test';
import { relatedRecordLink } from './receiving';

test('builds links for populated receiving relations', () => {
  assert.deepEqual(relatedRecordLink({ id: 'po-1', label: 'PO-2026-0001' }, 'purchase-orders'), {
    href: '/purchase-orders/po-1',
    label: 'PO-2026-0001',
  });
});

test('returns an explicit unavailable state for missing receiving relations', () => {
  assert.deepEqual(relatedRecordLink(null, 'purchase-orders'), {
    href: null,
    label: 'Unavailable',
  });
  assert.deepEqual(relatedRecordLink({ id: '', label: 'PO-2026-0001' }, 'purchase-orders'), {
    href: null,
    label: 'Unavailable',
  });
});
