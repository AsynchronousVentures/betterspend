import assert from 'node:assert/strict';
import test from 'node:test';
import { demoVendorPortalEmail, materializeVendorPortalUsers } from './vendor-portal-seed';
import { verifyVendorPortalPassword } from './vendor-portal-password';

test('derives a portal login email from the vendor contact, else from its code', () => {
  assert.equal(
    demoVendorPortalEmail({ code: 'ACME', contactInfo: { email: 'Sales@Acme.com' } }),
    'sales@acme.com',
  );
  assert.equal(
    demoVendorPortalEmail({ code: 'VND-X_1', contactInfo: {} }),
    'portal-vnd-x-1@vendor.example.invalid',
  );
});

test('materializes one shared hash for every seeded login outside the deterministic graph', async () => {
  const rows = await materializeVendorPortalUsers(
    [
      { organizationId: 'org', vendorId: 'v1', email: 'a@example.invalid' },
      { organizationId: 'org', vendorId: 'v2', email: 'b@example.invalid' },
    ],
    'seed-password',
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.passwordHash, rows[1]!.passwordHash);
  assert.equal(await verifyVendorPortalPassword('seed-password', rows[0]!.passwordHash), true);
  assert.deepEqual(await materializeVendorPortalUsers([]), []);
});
