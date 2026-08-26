import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { WebhookDnsAddress } from './webhook-url-policy';
import {
  MAX_RESPONSE_BYTES,
  requestPinnedWebhook,
  resolveSafeWebhookTarget,
  WebhookUrlPolicyError,
} from './webhook-url-policy';

const publicAddresses: WebhookDnsAddress[] = [
  { address: '93.184.216.34', family: 4 },
  { address: '2001:4860:4860::8888', family: 6 },
];

test('accepts a public HTTPS destination and returns a pinned address', async () => {
  const target = await resolveSafeWebhookTarget(
    'https://Example.com/hooks?event=created',
    async () => publicAddresses,
  );

  assert.deepEqual(target, {
    protocol: 'https:',
    hostname: 'example.com',
    hostHeader: 'example.com',
    address: '93.184.216.34',
    family: 4,
    port: 443,
    path: '/hooks?event=created',
  });
});

test('rejects unsafe schemes, credentials, fragments, and non-default ports', async () => {
  await assert.rejects(
    resolveSafeWebhookTarget('file:///etc/passwd'),
    (error: unknown) => error instanceof WebhookUrlPolicyError,
  );
  await assert.rejects(
    resolveSafeWebhookTarget('https://user:secret@example.com'),
    (error: unknown) => error instanceof WebhookUrlPolicyError,
  );
  await assert.rejects(
    resolveSafeWebhookTarget('https://example.com/#fragment', async () => publicAddresses),
    (error: unknown) => error instanceof WebhookUrlPolicyError,
  );
  await assert.rejects(
    resolveSafeWebhookTarget('https://example.com:8443', async () => publicAddresses),
    (error: unknown) => error instanceof WebhookUrlPolicyError,
  );
});

test('rejects literal loopback, private, link-local, and metadata addresses', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '::1',
    'fd00:ec2::254',
    '[4000::1]',
  ]) {
    await assert.rejects(
      resolveSafeWebhookTarget(`http://${address}`),
      (error: unknown) => error instanceof WebhookUrlPolicyError,
    );
  }
});

test('rejects DNS answers that include a non-public address', async () => {
  await assert.rejects(
    resolveSafeWebhookTarget('https://webhook.example', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]),
    (error: unknown) => error instanceof WebhookUrlPolicyError,
  );
});

test('caps streamed webhook responses before buffering them', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(Buffer.alloc(MAX_RESPONSE_BYTES + 1, 'x'));
  });

  await once(server.listen(0, '127.0.0.1'), 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await assert.rejects(
      requestPinnedWebhook(
        {
          protocol: 'http:',
          hostname: 'public.example',
          hostHeader: 'public.example',
          address: '127.0.0.1',
          family: 4,
          port: address.port,
          path: '/',
        },
        { method: 'POST', headers: {}, body: 'payload' },
      ),
      /exceeded/,
    );
  } finally {
    await closeServer(server);
  }
});

test('enforces an absolute deadline while the peer keeps streaming', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    const interval = setInterval(() => response.write('x'), 5);
    response.on('close', () => clearInterval(interval));
  });

  await once(server.listen(0, '127.0.0.1'), 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await assert.rejects(
      requestPinnedWebhook(
        {
          protocol: 'http:',
          hostname: 'public.example',
          hostHeader: 'public.example',
          address: '127.0.0.1',
          family: 4,
          port: address.port,
          path: '/',
        },
        { method: 'POST', headers: {}, body: 'payload', timeoutMs: 50 },
      ),
      /timed out/,
    );
  } finally {
    await closeServer(server);
  }
});

async function closeServer(server: Server): Promise<void> {
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
}
