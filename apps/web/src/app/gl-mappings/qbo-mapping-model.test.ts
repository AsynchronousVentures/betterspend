import assert from 'node:assert/strict';
import test from 'node:test';
import type { QboExternalEntityMapping } from '@betterspend/shared';
import { mappingRows } from './qbo-mapping-model';

const BASE_MAPPING: QboExternalEntityMapping = {
  id: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  connectionId: '00000000-0000-4000-8000-000000000003',
  provider: 'qbo',
  externalEntity: 'Class',
  externalId: '42',
  displayName: 'Operations',
  syncToken: '1',
  localEntity: 'department',
  localId: null,
  direction: 'inbound',
  autoCreated: false,
  isActive: true,
  isDeleted: false,
  mergedIntoExternalId: null,
  payload: { Name: 'Operations' },
  syncedAt: '2026-08-29T18:00:00.000Z',
  createdAt: '2026-08-29T18:00:00.000Z',
  updatedAt: '2026-08-29T18:00:00.000Z',
};

test('puts unresolved local records first and picks an active name match', () => {
  const rows = mappingRows(
    [
      { id: 'local-linked', name: 'Engineering', code: 'ENG', active: true },
      { id: 'local-open', name: 'Operations', code: 'OPS', active: true },
    ],
    [
      BASE_MAPPING,
      {
        ...BASE_MAPPING,
        id: '00000000-0000-4000-8000-000000000004',
        externalId: '43',
        displayName: 'Engineering',
        localId: 'local-linked',
      },
    ],
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ['local-open', 'local-linked'],
  );
  assert.equal(rows[0].suggestion?.externalId, '42');
  assert.equal(rows[1].suggestion, null);
});

test('does not suggest inactive or already-linked QBO records', () => {
  const rows = mappingRows(
    [{ id: 'local-open', name: 'Operations', code: 'OPS', active: true }],
    [
      { ...BASE_MAPPING, isActive: false },
      {
        ...BASE_MAPPING,
        id: '00000000-0000-4000-8000-000000000005',
        localId: 'some-other-local-record',
      },
    ],
  );

  assert.equal(rows[0].mapping, null);
  assert.equal(rows[0].suggestion, null);
});

test('does not guess at weak matches or reuse a suggestion', () => {
  const rows = mappingRows(
    [
      { id: 'local-ops-one', name: 'Operations North', code: null, active: true },
      { id: 'local-ops-two', name: 'Operations South', code: null, active: true },
      { id: 'local-legal', name: 'Legal', code: null, active: true },
    ],
    [BASE_MAPPING],
  );

  const suggestions = rows.flatMap((row) => (row.suggestion ? [row.suggestion.id] : []));
  assert.deepEqual(suggestions, [BASE_MAPPING.id]);
  assert.equal(rows.find((row) => row.id === 'local-legal')?.suggestion, null);
});

test('does not treat a missing QBO display name as a match', () => {
  const rows = mappingRows(
    [{ id: 'local-open', name: 'Operations', code: null, active: true }],
    [{ ...BASE_MAPPING, displayName: null, payload: null }],
  );

  assert.equal(rows[0].suggestion, null);
});
