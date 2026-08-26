import assert from 'node:assert/strict';
import test from 'node:test';
import type { WebhookDnsAddress } from './webhook-url-policy';
import { resolveSafeWebhookTarget, WebhookUrlPolicyError } from './webhook-url-policy';

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
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', 'fd00:ec2::254']) {
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
