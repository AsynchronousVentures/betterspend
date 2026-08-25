import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAuthResponse } from './auth-client';

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
});
