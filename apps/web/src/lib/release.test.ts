import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRuntimeReleaseVersion } from './release';

test('parses a valid runtime web release payload', () => {
  assert.equal(parseRuntimeReleaseVersion({ version: 'v0.2.4' }), '0.2.4');
  assert.equal(
    parseRuntimeReleaseVersion({ version: 'sha-0123456789abcdef0123456789abcdef01234567' }),
    'sha-0123456789abcdef0123456789abcdef01234567',
  );
});

test('retains the package fallback for malformed runtime payloads', () => {
  assert.equal(parseRuntimeReleaseVersion(null), null);
  assert.equal(parseRuntimeReleaseVersion({ version: 'not-a-release' }), null);
  assert.equal(parseRuntimeReleaseVersion({}), null);
});
