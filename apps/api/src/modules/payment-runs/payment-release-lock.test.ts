import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { lockPaymentReleaseVendor, paymentReleaseVendorLockKey } from './payment-release-lock';

test('uses one transaction-scoped lock domain for every payment operation on a vendor', async () => {
  const queries: unknown[] = [];
  const transaction = {
    execute: async (query: unknown) => {
      queries.push(query);
      return [];
    },
  };

  await lockPaymentReleaseVendor(
    transaction as never,
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  );
  await lockPaymentReleaseVendor(
    transaction as never,
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  );

  assert.equal(
    paymentReleaseVendorLockKey('org-1', 'vendor-1'),
    paymentReleaseVendorLockKey('org-1', 'vendor-1'),
  );
  assert.notEqual(
    paymentReleaseVendorLockKey('org-1', 'vendor-1'),
    paymentReleaseVendorLockKey('org-1', 'vendor-2'),
  );
  assert.equal(queries.length, 2);
  const rendered = queries.map((query) => new PgDialect().sqlToQuery(query as never));
  assert.ok(rendered.every((query) => query.sql.includes('pg_advisory_xact_lock')));
  assert.deepEqual(rendered[0]?.params, rendered[1]?.params);
});
