import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import type { Db } from '@betterspend/db';
import {
  punchoutStoredConfigSchema,
  type PunchoutStoredConfig,
  type PunchoutStoredEnvironment,
} from '@betterspend/shared';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { CredentialCryptoService } from '../ai-providers/credential-crypto.service';
import { PunchoutService } from './punchout.service';

const vendorId = '00000000-0000-4000-8000-000000000001';
const organizationId = '00000000-0000-4000-8000-000000000002';
const adminId = '00000000-0000-4000-8000-000000000003';

const testInput = {
  setupUrl: 'https://supplier.example.test/punchout/setup',
  orderUrl: 'https://supplier.example.test/punchout/order',
  fromDomain: 'betterspend.example',
  fromIdentity: 'buyer@example.test',
  toDomain: 'supplier.example',
  toIdentity: 'catalog',
  senderIdentity: 'betterspend',
  sharedSecret: 'test-shared-secret',
};

function storedEnvironment(secret = 'ciphertext') {
  return {
    setupUrl: testInput.setupUrl,
    orderUrl: testInput.orderUrl,
    fromDomain: testInput.fromDomain,
    fromIdentity: testInput.fromIdentity,
    toDomain: testInput.toDomain,
    toIdentity: testInput.toIdentity,
    senderIdentity: testInput.senderIdentity,
    encryptedSharedSecret: secret,
    sharedSecretHint: '••••••••cret',
    status: 'unverified' as const,
    consecutiveAuthFailures: 0,
    lastCheckedAt: null,
    lastError: null,
  } satisfies PunchoutStoredEnvironment;
}

function completeConfig(): PunchoutStoredConfig {
  return punchoutStoredConfigSchema.parse({
    activeEnvironment: 'test',
    environments: {
      test: storedEnvironment(),
      production: storedEnvironment('production-ciphertext'),
    },
  });
}

function fakeDatabase(initialConfig: PunchoutStoredConfig | null, enabled = false) {
  let vendor = {
    id: vendorId,
    organizationId,
    name: 'Supplier One',
    punchoutEnabled: enabled,
    punchoutConfig: initialConfig,
  };
  const updates: Array<Record<string, unknown>> = [];

  const db = {
    query: {
      vendors: {
        findFirst: async () => vendor,
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: () => ({
            returning: async () => {
              vendor = { ...vendor, ...values };
              return [{ id: vendor.id, punchoutEnabled: vendor.punchoutEnabled }];
            },
          }),
        };
      },
    }),
    transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback(db),
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => [vendor],
          limit: async () => [{ id: adminId }],
        }),
        innerJoin: () => ({
          where: () => ({ limit: async () => [{ id: adminId }] }),
        }),
      }),
    }),
  } as unknown as Db;

  return {
    db,
    getVendor: () => vendor,
    updates,
  };
}

function cryptoStub() {
  return {
    encrypt: (value: string) => `encrypted:${value}`,
  } as unknown as CredentialCryptoService;
}

test('stores shared secrets encrypted and returns only masked configuration', async () => {
  const state = fakeDatabase(null);
  const service = new PunchoutService(state.db, cryptoStub());

  const response = await service.updateConfig(vendorId, organizationId, adminId, {
    enabled: false,
    environments: { test: testInput },
  });

  assert.equal(response.enabled, false);
  assert.equal(response.environments.test.sharedSecretConfigured, true);
  assert.equal(response.environments.test.sharedSecretMasked, '••••••••cret');
  assert.equal('sharedSecret' in response.environments.test, false);
  assert.equal('encryptedSharedSecret' in response.environments.test, false);

  const stored = state.getVendor().punchoutConfig as PunchoutStoredConfig;
  assert.equal(stored.environments.test.encryptedSharedSecret, 'encrypted:test-shared-secret');

  const disabled = await service.updateConfig(vendorId, organizationId, adminId, {
    enabled: true,
  });
  assert.equal(disabled.enabled, true);
  assert.equal(
    (state.getVendor().punchoutConfig as PunchoutStoredConfig).environments.test
      .encryptedSharedSecret,
    'encrypted:test-shared-secret',
  );
});

test('does not enable an unconfigured vendor', async () => {
  const state = fakeDatabase(null);
  const service = new PunchoutService(state.db, cryptoStub());

  await assert.rejects(
    service.updateConfig(vendorId, organizationId, adminId, { enabled: true }),
    BadRequestException,
  );
  assert.equal(state.updates.length, 0);
});

test('auto-disables after three failures, retains config, and notifies an admin once', async () => {
  const state = fakeDatabase(completeConfig(), true);
  const notifications: Array<unknown[]> = [];
  const audits: Array<unknown[]> = [];
  const service = new PunchoutService(
    state.db,
    cryptoStub(),
    {
      createIdempotent: async (...args: unknown[]) => {
        notifications.push(args);
      },
    } as unknown as NotificationsService,
    {
      log: async (...args: unknown[]) => {
        audits.push(args);
      },
    } as unknown as AuditService,
  );

  await service.recordAuthenticationFailure(vendorId, organizationId, 'test', 'supplier body');
  await service.recordAuthenticationFailure(vendorId, organizationId, 'test', 'secret value');
  const disabled = await service.recordAuthenticationFailure(
    vendorId,
    organizationId,
    'test',
    'supplier body',
  );

  assert.equal(disabled.enabled, false);
  assert.equal(disabled.environments.test.status, 'auth_failed');
  assert.equal(disabled.environments.test.consecutiveAuthFailures, 3);
  assert.equal(disabled.environments.test.lastError, 'Supplier authentication failed');
  assert.equal(notifications.length, 1);
  assert.equal(
    notifications[0]?.[0],
    `punchout-auth-failed:${vendorId}:test:${disabled.environments.test.lastCheckedAt}`,
  );
  assert.equal(notifications[0]?.[1], organizationId);
  assert.equal(notifications[0]?.[2], adminId);
  assert.equal(notifications[0]?.[3], 'punchout_auth_failed');
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.[4], 'punchout_auto_disabled');

  const retained = state.getVendor().punchoutConfig as PunchoutStoredConfig;
  assert.equal(retained.environments.test.encryptedSharedSecret, 'ciphertext');

  await service.recordAuthenticationFailure(vendorId, organizationId, 'test');
  assert.equal(notifications.length, 1);
  assert.equal(
    (state.getVendor().punchoutConfig as PunchoutStoredConfig).environments.test
      .consecutiveAuthFailures,
    4,
  );

  const healthy = await service.recordAuthenticationSuccess(vendorId, organizationId, 'test');
  assert.equal(healthy.enabled, false);
  assert.equal(healthy.environments.test.status, 'verified');
  assert.equal(healthy.environments.test.consecutiveAuthFailures, 0);
  assert.equal(healthy.environments.test.sharedSecretConfigured, true);
});
