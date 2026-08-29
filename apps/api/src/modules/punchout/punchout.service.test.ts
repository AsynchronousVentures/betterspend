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
const fixtureSharedSecret = 'x'.repeat(32);

const testInput = {
  setupUrl: 'https://supplier.example.test/punchout/setup',
  orderUrl: 'https://supplier.example.test/punchout/order',
  fromDomain: 'betterspend.example',
  fromIdentity: 'buyer@example.test',
  toDomain: 'supplier.example',
  toIdentity: 'catalog',
  senderIdentity: 'betterspend',
  sharedSecret: fixtureSharedSecret,
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
    sharedSecretHint: '••••••••xxxx',
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

type FakeVendor = {
  id: string;
  organizationId: string;
  name: string;
  punchoutEnabled: boolean;
  punchoutConfig: PunchoutStoredConfig | null;
};

function fakeDatabase(initialConfig: PunchoutStoredConfig | null, enabled = false) {
  let vendor: FakeVendor = {
    id: vendorId,
    organizationId,
    name: 'Supplier One',
    punchoutEnabled: enabled,
    punchoutConfig: initialConfig,
  };
  const updates: Array<Record<string, unknown>> = [];
  const transactionExecutors: unknown[] = [];

  function makeExecutor(state: { vendor: FakeVendor }) {
    return {
      query: {
        vendors: {
          findFirst: async () => state.vendor,
        },
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return {
            where: () => ({
              returning: async () => {
                state.vendor = { ...state.vendor, ...values } as FakeVendor;
                return [{ id: state.vendor.id, punchoutEnabled: state.vendor.punchoutEnabled }];
              },
            }),
          };
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            for: async () => [state.vendor],
            limit: async () => [{ id: adminId }],
          }),
          innerJoin: () => ({
            where: () => ({ limit: async () => [{ id: adminId }] }),
          }),
        }),
      }),
    };
  }

  const databaseState = { vendor };
  const db = {
    ...makeExecutor(databaseState),
    transaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
      const transactionState = { vendor: databaseState.vendor };
      const transactionExecutor = makeExecutor(transactionState);
      transactionExecutors.push(transactionExecutor);
      const result = await callback(transactionExecutor);
      databaseState.vendor = transactionState.vendor;
      vendor = databaseState.vendor;
      return result;
    },
  } as unknown as Db;

  return {
    db,
    getVendor: () => vendor,
    updates,
    transactionExecutors,
  };
}

function cryptoStub() {
  return {
    encrypt: (value: string) => `encrypted:${value}`,
  } as unknown as CredentialCryptoService;
}

function notificationsStub() {
  return {
    createIdempotent: async () => undefined,
  } as unknown as NotificationsService;
}

function auditStub(audits: Array<unknown[]>, fail = false) {
  return {
    log: async (...args: unknown[]) => {
      audits.push(args);
      if (fail) throw new Error('audit failed');
    },
  } as unknown as AuditService;
}

test('stores shared secrets encrypted and returns only masked configuration', async () => {
  const state = fakeDatabase(null);
  const audits: Array<unknown[]> = [];
  const service = new PunchoutService(
    state.db,
    cryptoStub(),
    notificationsStub(),
    auditStub(audits),
  );

  const response = await service.updateConfig(vendorId, organizationId, adminId, {
    enabled: false,
    environments: { test: testInput },
  });

  assert.equal(response.enabled, false);
  assert.equal(response.environments.test.sharedSecretConfigured, true);
  assert.equal(response.environments.test.sharedSecretMasked, '••••••••xxxx');
  assert.equal('sharedSecret' in response.environments.test, false);
  assert.equal('encryptedSharedSecret' in response.environments.test, false);

  const stored = state.getVendor().punchoutConfig as PunchoutStoredConfig;
  assert.equal(stored.environments.test.encryptedSharedSecret, `encrypted:${fixtureSharedSecret}`);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.[4], 'punchout_config_updated');
  assert.equal(state.transactionExecutors.includes(audits[0]?.[7]), true);

  const disabled = await service.updateConfig(vendorId, organizationId, adminId, {
    enabled: true,
  });
  assert.equal(disabled.enabled, true);
  assert.equal(
    (state.getVendor().punchoutConfig as PunchoutStoredConfig).environments.test
      .encryptedSharedSecret,
    `encrypted:${fixtureSharedSecret}`,
  );
  assert.equal(audits.length, 2);
  assert.equal(state.transactionExecutors.includes(audits[1]?.[7]), true);
});

test('does not enable an unconfigured vendor', async () => {
  const state = fakeDatabase(null);
  const service = new PunchoutService(state.db, cryptoStub(), notificationsStub(), auditStub([]));

  await assert.rejects(
    service.updateConfig(vendorId, organizationId, adminId, { enabled: true }),
    BadRequestException,
  );
  assert.equal(state.updates.length, 0);
});

test('rolls back a config mutation when its audit entry fails', async () => {
  const state = fakeDatabase(null);
  const audits: Array<unknown[]> = [];
  const service = new PunchoutService(
    state.db,
    cryptoStub(),
    notificationsStub(),
    auditStub(audits, true),
  );

  await assert.rejects(
    service.updateConfig(vendorId, organizationId, adminId, {
      enabled: false,
      environments: { test: testInput },
    }),
    /audit failed/,
  );

  assert.equal(state.getVendor().punchoutEnabled, false);
  assert.equal(state.getVendor().punchoutConfig, null);
  assert.equal(audits.length, 1);
  assert.equal(state.transactionExecutors.includes(audits[0]?.[7]), true);
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
    auditStub(audits),
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
  assert.equal(audits.length, 4);
  assert.equal(audits[0]?.[4], 'punchout_authentication_failed');
  assert.equal(audits[1]?.[4], 'punchout_authentication_failed');
  assert.equal(audits[2]?.[4], 'punchout_authentication_failed');
  assert.equal(audits[3]?.[4], 'punchout_auto_disabled');
  assert.equal(
    audits.every((audit) => state.transactionExecutors.includes(audit[7])),
    true,
  );

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
  assert.equal(audits.length, 6);
  assert.equal(audits[5]?.[4], 'punchout_authentication_succeeded');
  assert.equal(state.transactionExecutors.includes(audits[5]?.[7]), true);
});

test('does not auto-disable after three failures in an inactive environment', async () => {
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
    auditStub(audits),
  );

  const failed = await service.recordAuthenticationFailure(
    vendorId,
    organizationId,
    'production',
  );
  await service.recordAuthenticationFailure(vendorId, organizationId, 'production');
  const stillEnabled = await service.recordAuthenticationFailure(
    vendorId,
    organizationId,
    'production',
  );

  assert.equal(stillEnabled.enabled, true);
  assert.equal(stillEnabled.activeEnvironment, 'test');
  assert.equal(stillEnabled.environments.production.status, 'auth_failed');
  assert.equal(stillEnabled.environments.production.consecutiveAuthFailures, 3);
  assert.equal(failed.enabled, true);
  assert.equal(state.getVendor().punchoutEnabled, true);
  assert.equal(notifications.length, 0);
  assert.equal(audits.length, 3);
  assert.equal(audits.some((audit) => audit[4] === 'punchout_auto_disabled'), false);
});

test('rolls back a health mutation when its audit entry fails', async () => {
  const initialConfig = completeConfig();
  const state = fakeDatabase(initialConfig, true);
  const audits: Array<unknown[]> = [];
  const service = new PunchoutService(
    state.db,
    cryptoStub(),
    notificationsStub(),
    auditStub(audits, true),
  );

  await assert.rejects(
    service.recordAuthenticationSuccess(vendorId, organizationId, 'test'),
    /audit failed/,
  );

  assert.deepEqual(state.getVendor().punchoutConfig, initialConfig);
  assert.equal(state.getVendor().punchoutEnabled, true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.[4], 'punchout_authentication_succeeded');
  assert.equal(state.transactionExecutors.includes(audits[0]?.[7]), true);
});
