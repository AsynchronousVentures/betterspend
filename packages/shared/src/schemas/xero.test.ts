import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { xeroGrantQuerySchema, xeroTenantSchema, xeroTenantSelectionSchema } from './xero';

describe('Xero OAuth request schemas', () => {
  it('parses the tenant response contract', () => {
    assert.deepEqual(xeroTenantSchema.parse({ tenantId: ' tenant-1 ', tenantName: 'Northwind' }), {
      tenantId: 'tenant-1',
      tenantName: 'Northwind',
    });
    assert.deepEqual(xeroTenantSchema.parse({ tenantId: 'tenant-2', tenantName: null }), {
      tenantId: 'tenant-2',
      tenantName: null,
    });
  });

  it('normalizes grant and tenant identifiers at the request boundary', () => {
    assert.deepEqual(xeroGrantQuerySchema.parse({ grantId: '  grant-1  ' }), {
      grantId: 'grant-1',
    });
    assert.deepEqual(
      xeroTenantSelectionSchema.parse({ grantId: ' grant-1 ', tenantId: ' tenant-1 ' }),
      { grantId: 'grant-1', tenantId: 'tenant-1' },
    );
  });

  it('rejects missing, blank, non-string, and oversized identifiers', () => {
    assert.equal(xeroGrantQuerySchema.safeParse({}).success, false);
    assert.equal(xeroGrantQuerySchema.safeParse({ grantId: '   ' }).success, false);
    assert.equal(xeroGrantQuerySchema.safeParse({ grantId: ['grant-1'] }).success, false);
    assert.equal(xeroGrantQuerySchema.safeParse({ grantId: 'g'.repeat(129) }).success, false);

    assert.equal(xeroTenantSelectionSchema.safeParse({ grantId: 'grant-1' }).success, false);
    assert.equal(
      xeroTenantSelectionSchema.safeParse({ grantId: 'grant-1', tenantId: 't'.repeat(256) })
        .success,
      false,
    );
  });
});
