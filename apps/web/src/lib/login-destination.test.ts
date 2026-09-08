import assert from 'node:assert/strict';
import test from 'node:test';
import { loginDestination } from './login-destination';

test('preserves local path, query and hash destinations', () => {
  for (const value of [
    '/',
    '/invoices?status=pending#list',
    '/invoices?q=hello%20world',
    '/vendors/../invoices',
  ]) {
    assert.equal(
      loginDestination(value),
      new URL(value, 'https://example.test').pathname +
        new URL(value, 'https://example.test').search +
        new URL(value, 'https://example.test').hash,
    );
  }
});

test('rejects external, scheme, protocol-relative and normalization bypasses', () => {
  for (const value of [
    null,
    '',
    'invoices',
    'https://example.invalid',
    '//example.invalid',
    '/\\example.invalid',
    '\\example.invalid',
    'javascript:alert(1)',
    'data:text/html,hi',
    '/\n/example.invalid',
    '/\t/example.invalid',
    '/a/..//example.invalid',
    '/%2e%2e//example.invalid',
  ]) {
    assert.equal(loginDestination(value), '/', String(value));
  }
});
