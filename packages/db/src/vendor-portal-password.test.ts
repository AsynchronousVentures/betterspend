import assert from 'node:assert/strict';
import test from 'node:test';
import { hashVendorPortalPassword, verifyVendorPortalPassword } from './vendor-portal-password';

test('hashes vendor portal passwords with a fresh salt and verifies them', async () => {
  const first = await hashVendorPortalPassword('correct horse battery');
  const second = await hashVendorPortalPassword('correct horse battery');

  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await verifyVendorPortalPassword('correct horse battery', first), true);
  assert.equal(await verifyVendorPortalPassword('correct horse battery', second), true);
  assert.equal(await verifyVendorPortalPassword('wrong', first), false);
});

test('rejects malformed stored hashes without throwing', async () => {
  assert.equal(await verifyVendorPortalPassword('anything', ''), false);
  assert.equal(await verifyVendorPortalPassword('anything', 'bcrypt$nope'), false);
  assert.equal(await verifyVendorPortalPassword('anything', 'scrypt$16384$8$1$salt'), false);
});
