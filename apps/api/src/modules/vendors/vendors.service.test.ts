import assert from 'node:assert/strict';
import test from 'node:test';
import type { Db } from '@betterspend/db';
import type { EntitiesService } from '../entities/entities.service';
import { VendorsService } from './vendors.service';

const vendor = {
  id: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  name: 'Supplier One',
  punchoutEnabled: true,
  punchoutConfig: {
    environments: {
      test: { encryptedSharedSecret: 'ciphertext' },
      production: {},
    },
  },
};

test('vendor responses never include the encrypted PunchOut configuration', async () => {
  const db = {
    query: {
      vendors: {
        findFirst: async () => vendor,
        findMany: async () => [vendor],
      },
    },
  } as unknown as Db;
  const service = new VendorsService(db, undefined as unknown as EntitiesService);

  const one = await service.findOne(vendor.id, vendor.organizationId);
  const many = await service.findAll(vendor.organizationId);

  assert.equal('punchoutConfig' in one, false);
  assert.equal('punchoutConfig' in many[0]!, false);
  assert.equal(one.punchoutEnabled, true);
});
