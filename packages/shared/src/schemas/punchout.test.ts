import assert from 'node:assert/strict';
import test from 'node:test';
import {
  punchoutConfigInputSchema,
  punchoutConfigResponseSchema,
  punchoutStoredConfigSchema,
} from './punchout';

const environment = {
  setupUrl: 'https://supplier.example.test/punchout/setup',
  orderUrl: 'https://supplier.example.test/punchout/order',
  fromDomain: 'betterspend.example',
  fromIdentity: 'buyer@example.test',
  toDomain: 'supplier.example',
  toIdentity: 'catalog',
  senderIdentity: 'betterspend',
  sharedSecret: 'test-shared-secret',
};

test('accepts independent test and production PunchOut credentials', () => {
  const parsed = punchoutConfigInputSchema.parse({
    enabled: true,
    dialect: 'cxml',
    activeEnvironment: 'test',
    environments: {
      test: environment,
      production: { ...environment, sharedSecret: 'production-shared-secret' },
    },
  });

  assert.equal(parsed.environments?.test?.sharedSecret, 'test-shared-secret');
  assert.equal(parsed.environments?.production?.sharedSecret, 'production-shared-secret');
});

test('does not accept persisted secret fields at the write boundary', () => {
  const result = punchoutConfigInputSchema.safeParse({
    environments: { test: { encryptedSharedSecret: 'ciphertext' } },
  });

  assert.equal(result.success, false);
});

test('requires HTTP(S) endpoints without embedded credentials or fragments', () => {
  const result = punchoutConfigInputSchema.safeParse({
    environments: {
      test: {
        setupUrl: 'ftp://supplier.example.test/setup',
        orderUrl: 'https://user:password@supplier.example.test/order#fragment',
      },
    },
  });

  assert.equal(result.success, false);
});

test('provides independent environment state defaults', () => {
  const parsed = punchoutStoredConfigSchema.parse({ environments: {} });

  assert.equal(parsed.dialect, 'cxml');
  assert.equal(parsed.activeEnvironment, 'test');
  assert.equal(parsed.environments.test.status, 'unverified');
  assert.equal(parsed.environments.production.status, 'unverified');
  assert.equal(parsed.environments.test.consecutiveAuthFailures, 0);
  assert.equal(parsed.environments.production.consecutiveAuthFailures, 0);
});

test('response contract has masked secret fields only', () => {
  const parsed = punchoutConfigResponseSchema.parse({
    vendorId: '00000000-0000-4000-8000-000000000001',
    enabled: false,
    dialect: 'cxml',
    activeEnvironment: 'production',
    environments: {
      test: {
        setupUrl: null,
        orderUrl: null,
        fromDomain: null,
        fromIdentity: null,
        toDomain: null,
        toIdentity: null,
        senderIdentity: null,
        sharedSecretConfigured: true,
        sharedSecretMasked: '••••••••cret',
        status: 'unverified',
        consecutiveAuthFailures: 0,
        lastCheckedAt: null,
        lastError: null,
      },
      production: {
        setupUrl: null,
        orderUrl: null,
        fromDomain: null,
        fromIdentity: null,
        toDomain: null,
        toIdentity: null,
        senderIdentity: null,
        sharedSecretConfigured: false,
        sharedSecretMasked: null,
        status: 'unverified',
        consecutiveAuthFailures: 0,
        lastCheckedAt: null,
        lastError: null,
      },
    },
  });

  assert.equal('encryptedSharedSecret' in parsed.environments.test, false);
  assert.equal('sharedSecret' in parsed.environments.test, false);

  assert.equal(
    punchoutConfigResponseSchema.safeParse({
      ...parsed,
      environments: {
        ...parsed.environments,
        test: { ...parsed.environments.test, encryptedSharedSecret: 'ciphertext' },
      },
    }).success,
    false,
  );
});
