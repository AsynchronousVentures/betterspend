import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { isPublicPath, proxy } from './proxy';

test('keeps runtime release metadata public', () => {
  assert.equal(isPublicPath('/runtime-version'), true);
  assert.equal(isPublicPath('/runtime-version/details'), false);
  assert.equal(isPublicPath('/workspace-settings'), false);
});

test('allows public requests through the proxy', () => {
  const response = proxy(new NextRequest('https://example.test/login'));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-middleware-next'), '1');
});

test('redirects protected requests without a token', () => {
  const response = proxy(new NextRequest('https://example.test/workspace-settings'));

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get('location'),
    'https://example.test/login?next=%2Fworkspace-settings',
  );
});

test('allows protected requests with a token', () => {
  const response = proxy(
    new NextRequest('https://example.test/workspace-settings', {
      headers: { cookie: 'bs_token=token' },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-middleware-next'), '1');
});

for (const path of [
  '/forgot-password',
  '/reset-password?token=synthetic',
  '/account/verify-email?token=synthetic',
  '/vendor-portal?token=synthetic',
  '/punchout/session',
]) {
  test(`allows anonymous ${path} without redirecting or dropping query parameters`, () => {
    const response = proxy(new NextRequest(`https://example.test${path}`));
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.equal(response.headers.get('location'), null);
  });
}

test('public path matching respects path segment boundaries', () => {
  for (const path of ['/login-admin', '/vendor-portals', '/reset-password-admin', '/account']) {
    assert.equal(isPublicPath(path), false);
  }
});

test('keeps query parameters when redirecting a protected page to login', () => {
  const response = proxy(new NextRequest('https://example.test/invoices?status=pending'));
  const location = new URL(response.headers.get('location')!);
  assert.equal(location.searchParams.get('next'), '/invoices?status=pending');
});
