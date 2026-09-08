import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { rethrowInvoiceIdentityConflict } from './invoice-identity';

test('driver and wrapped invoice unique violations become a useful conflict', () => {
  for (const key of ['constraint', 'constraint_name']) {
    const driver = { code: '23505', [key]: 'invoices_org_vendor_number_unique' };
    for (const error of [driver, new Error('query failed', { cause: driver })]) {
      assert.throws(
        () => rethrowInvoiceIdentityConflict(error),
        (result: unknown) => {
          assert.ok(result instanceof ConflictException);
          assert.equal(result.getStatus(), 409);
          assert.match(result.message, /invoice number already exists for this vendor/);
          return true;
        },
      );
    }
  }
});

test('unrelated database errors retain original diagnostics', () => {
  const error = { code: '23505', constraint: 'invoices_internal_number_unique' };
  assert.throws(
    () => rethrowInvoiceIdentityConflict(error),
    (result: unknown) => result === error,
  );
});
