import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReleaseVersion, resolveReleaseVersion } from './release-version';

test('accepts a configured semantic version', () => {
  assert.equal(resolveReleaseVersion('0.2.4', '0.2.3'), '0.2.4');
});

test('removes the lowercase v from semantic version tags', () => {
  assert.equal(resolveReleaseVersion(' v0.2.4 ', '0.2.3'), '0.2.4');
});

test('preserves immutable SHA deployment tags', () => {
  assert.equal(
    resolveReleaseVersion('sha-0123456789abcdef0123456789abcdef01234567', '0.2.3'),
    'sha-0123456789abcdef0123456789abcdef01234567',
  );
});

test('uses the package fallback for blank or malformed runtime values', () => {
  assert.equal(resolveReleaseVersion('   ', '0.2.3'), '0.2.3');
  assert.equal(resolveReleaseVersion('release-0.2.4', '0.2.3'), '0.2.3');
});

test('uses a safe fallback when the package version is blank', () => {
  assert.equal(resolveReleaseVersion(undefined, '   '), '0.0.0');
});

test('keeps runtime values limited to the supported formats', () => {
  assert.equal(normalizeReleaseVersion('v01.2.3'), null);
  assert.equal(normalizeReleaseVersion('1.2.3-01'), null);
  assert.equal(normalizeReleaseVersion(`0.0.0-0.${'--.'.repeat(1_000)}`), null);
  assert.equal(normalizeReleaseVersion('sha-not-a-sha'), null);
  assert.equal(normalizeReleaseVersion('0.2.4-beta.1'), '0.2.4-beta.1');
});
