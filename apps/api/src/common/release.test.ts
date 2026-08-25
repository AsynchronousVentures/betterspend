import assert from 'node:assert/strict';
import test from 'node:test';
import { getAppVersion } from './release';

test('getAppVersion prefers valid runtime metadata', () => {
  assert.equal(getAppVersion('v0.2.4', '0.2.3'), '0.2.4');
  assert.equal(
    getAppVersion('sha-0123456789abcdef0123456789abcdef01234567', '0.2.3'),
    'sha-0123456789abcdef0123456789abcdef01234567',
  );
});

test('getAppVersion falls back for blank or malformed runtime metadata', () => {
  assert.equal(getAppVersion('  ', '0.2.3'), '0.2.3');
  assert.equal(getAppVersion('not-a-release', '0.2.3'), '0.2.3');
});
