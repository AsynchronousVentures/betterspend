import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  qboExternalEntityMappingSchema,
  qboMappingLinkInputSchema,
  qboSyncRequestSchema,
} from './qbo';

describe('QBO integration schemas', () => {
  it('accepts an empty sync request or a bounded non-empty entity selection', () => {
    assert.deepEqual(qboSyncRequestSchema.parse({}), {});
    assert.deepEqual(qboSyncRequestSchema.parse({ entityTypes: ['Account', 'TaxRate'] }), {
      entityTypes: ['Account', 'TaxRate'],
    });
    assert.equal(qboSyncRequestSchema.safeParse({ entityTypes: [] }).success, false);
    assert.equal(qboSyncRequestSchema.safeParse({ entityTypes: ['Employee'] }).success, false);
  });

  it('requires a UUID or null for mapping links and rejects extra fields', () => {
    assert.deepEqual(
      qboMappingLinkInputSchema.parse({
        localId: '00000000-0000-4000-8000-000000000001',
        autoCreated: false,
      }),
      { localId: '00000000-0000-4000-8000-000000000001', autoCreated: false },
    );
    assert.deepEqual(qboMappingLinkInputSchema.parse({ localId: null }), { localId: null });
    assert.equal(qboMappingLinkInputSchema.safeParse({ localId: 'not-a-uuid' }).success, false);
    assert.equal(
      qboMappingLinkInputSchema.safeParse({ localId: null, organizationId: 'other-org' }).success,
      false,
    );
  });

  it('parses the mapping response contract used by integration screens', () => {
    const timestamp = '2026-08-29T20:00:00.000Z';
    const mapping = qboExternalEntityMappingSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      organizationId: '00000000-0000-4000-8000-000000000002',
      connectionId: '00000000-0000-4000-8000-000000000003',
      realmId: 'realm-1',
      provider: 'qbo',
      externalEntity: 'Vendor',
      externalId: '42',
      displayName: 'Acme',
      syncToken: '3',
      localEntity: 'vendor',
      localId: null,
      direction: 'inbound',
      autoCreated: false,
      isActive: true,
      isDeleted: false,
      mergedIntoExternalId: null,
      payload: { Id: '42' },
      syncedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    assert.equal(mapping.externalEntity, 'Vendor');
    assert.equal(mapping.externalId, '42');
  });
});
