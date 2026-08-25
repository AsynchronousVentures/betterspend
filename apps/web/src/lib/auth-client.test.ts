import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { parseAuthResponse, signUp } from './auth-client';

describe('parseAuthResponse', () => {
  it('turns an empty non-JSON 500 into a server error', async () => {
    const result = await parseAuthResponse(new Response('', { status: 500 }));
    assert.equal(result.error, 'Authentication server error (500)');
  });

  it('preserves a JSON server message', async () => {
    const result = await parseAuthResponse(
      new Response(JSON.stringify({ message: 'Instance already initialized' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    assert.equal(result.error, 'Instance already initialized');
  });

  it('rejects a malformed successful response', async () => {
    await assert.rejects(
      parseAuthResponse(new Response('<html>proxy error</html>', { status: 200 })),
      /Invalid authentication response/,
    );
  });
});

describe('signUp', () => {
  it('marks bootstrap complete when automatic sign-in cannot finish', async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify({ organization: {}, user: {} }), { status: 201 });
      }
      throw new TypeError('connection closed');
    };

    try {
      const result = await signUp({
        organizationName: 'Acme',
        name: 'Admin',
        email: 'admin@example.test',
        password: randomBytes(24).toString('base64url'),
      });
      assert.equal(result.accountCreated, true);
      assert.equal(result.error, 'Account created. Sign in to continue.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
