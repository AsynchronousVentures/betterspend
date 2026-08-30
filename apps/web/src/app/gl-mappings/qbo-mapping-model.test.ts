import assert from 'node:assert/strict';
import test from 'node:test';
import type { QboExternalEntityMapping } from '@betterspend/shared';
import { catalogSearchText, mappingRows, normalizeMappingText } from './qbo-mapping-model';

const BASE_MAPPING: QboExternalEntityMapping = {
  id: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  connectionId: '00000000-0000-4000-8000-000000000003',
  realmId: '1234567890',
  provider: 'qbo',
  externalEntity: 'Class',
  externalId: '42',
  displayName: 'Operations',
  syncToken: '1',
  localEntity: 'department',
  localId: null,
  direction: 'inbound',
  autoCreated: false,
  isDefault: false,
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

test('does not promote partial-name matches to one-action suggestions', () => {
  const rows = mappingRows(
    [
      { id: 'local-ops-one', name: 'Operations North', code: null, active: true },
      { id: 'local-ops-two', name: 'Operations South', code: null, active: true },
      { id: 'local-legal', name: 'Legal', code: null, active: true },
    ],
    [BASE_MAPPING],
  );

  assert.equal(
    rows.every((row) => row.suggestion === null),
    true,
  );
});

test('does not reuse an exact-match suggestion', () => {
  const rows = mappingRows(
    [
      { id: 'local-ops-one', name: 'Operations', code: null, active: true },
      { id: 'local-ops-two', name: 'Operations', code: null, active: true },
    ],
    [BASE_MAPPING],
  );

  assert.equal(rows.filter((row) => row.suggestion?.id === BASE_MAPPING.id).length, 1);
  assert.equal(rows.find((row) => row.id === 'local-ops-one')?.suggestion?.id, BASE_MAPPING.id);
});

test('does not treat a missing QBO display name as a match', () => {
  const rows = mappingRows(
    [{ id: 'local-open', name: 'Operations', code: null, active: true }],
    [{ ...BASE_MAPPING, displayName: null, payload: null }],
  );

  assert.equal(rows[0].suggestion, null);
});

test('keeps an exact code match ahead of a long token overlap', () => {
  const exactCode = {
    ...BASE_MAPPING,
    id: '00000000-0000-4000-8000-000000000006',
    displayName: 'General Operations',
    payload: { AcctNum: 'OPS-100' },
  };
  const rows = mappingRows(
    [
      {
        id: 'local-token-overlap',
        name: 'General Operations Administration Services',
        code: null,
        active: true,
      },
      { id: 'local-exact-code', name: 'Field Team', code: 'OPS-100', active: true },
    ],
    [exactCode],
  );

  assert.equal(rows.find((row) => row.id === 'local-exact-code')?.suggestion?.id, exactCode.id);
  assert.equal(rows.find((row) => row.id === 'local-token-overlap')?.suggestion, null);
});

test('normalizes punctuation and whitespace when searching the QBO catalog', () => {
  const searchText = catalogSearchText({
    ...BASE_MAPPING,
    displayName: 'Operations: North',
    payload: { AcctNum: 'OPS-100' },
  });

  assert.equal(searchText.includes(normalizeMappingText('OPS 100')), true);
  assert.equal(searchText.includes(normalizeMappingText('operations north')), true);
});

test('indexes each QBO candidate once instead of comparing every local-candidate pair', () => {
  let payloadReads = 0;
  const mapping = { ...BASE_MAPPING };
  Object.defineProperty(mapping, 'payload', {
    get() {
      payloadReads += 1;
      return { AcctNum: 'OPS-100' };
    },
  });

  mappingRows(
    [
      { id: 'local-one', name: 'Field Team', code: 'OPS-100', active: true },
      { id: 'local-two', name: 'Operations', code: 'OPS-200', active: true },
    ],
    [mapping],
  );

  assert.equal(payloadReads, 1);
});
