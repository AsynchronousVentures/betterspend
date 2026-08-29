import assert from 'node:assert/strict';
import test from 'node:test';
import { idempotencyForMessageIntent, messageIntentFingerprint } from './message-thread';

test('an unchanged message retry keeps its idempotency key', () => {
  const fingerprint = messageIntentFingerprint({ body: 'Please confirm delivery' });
  const first = idempotencyForMessageIntent(null, fingerprint, () => 'key-1');
  const retry = idempotencyForMessageIntent(first, fingerprint, () => 'key-2');

  assert.equal(retry.idempotencyKey, 'key-1');
});

test('editing a failed message rotates its idempotency key', () => {
  const first = idempotencyForMessageIntent(
    null,
    messageIntentFingerprint({ body: 'Please confirm delivery' }),
    () => 'key-1',
  );
  const revised = idempotencyForMessageIntent(
    first,
    messageIntentFingerprint({ body: 'Please confirm delivery tomorrow' }),
    () => 'key-2',
  );

  assert.equal(revised.idempotencyKey, 'key-2');
});

test('editing attachments rotates the key while an unchanged attachment retry keeps it', () => {
  const originalFingerprint = messageIntentFingerprint({
    body: 'See attached',
    attachments: [{ documentId: 'document-1', name: 'quote.pdf' }],
  });
  const first = idempotencyForMessageIntent(null, originalFingerprint, () => 'key-1');
  const retry = idempotencyForMessageIntent(first, originalFingerprint, () => 'key-2');
  const revised = idempotencyForMessageIntent(
    retry,
    messageIntentFingerprint({
      body: 'See attached',
      attachments: [{ documentId: 'document-2', name: 'revised-quote.pdf' }],
    }),
    () => 'key-3',
  );

  assert.equal(retry.idempotencyKey, 'key-1');
  assert.equal(revised.idempotencyKey, 'key-3');
});
