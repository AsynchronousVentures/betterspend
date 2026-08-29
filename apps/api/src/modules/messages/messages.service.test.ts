import assert from 'node:assert/strict';
import test from 'node:test';
import { messages } from '@betterspend/db';
import type { Db } from '@betterspend/db';
import { MessagesService } from './messages.service';

test('message owner inserts target the organization-scoped idempotency key', async () => {
  const conflictTargets: unknown[][] = [];
  const db = {
    transaction: async <T>(callback: (tx: unknown) => Promise<T>) =>
      callback({
        execute: async () => [],
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({ limit: async () => [] }),
              limit: async () => [],
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: async () => [{ id: 'audit-1' }],
            onConflictDoNothing: (config?: { target?: unknown[] }) => {
              assert.ok(config?.target);
              conflictTargets.push(config.target);
              return {
                returning: async () => [{ id: 'message-1' }],
              };
            },
          }),
        }),
      }),
  } as unknown as Db;
  const service = new MessagesService(
    db,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  const methods = service as unknown as {
    createUserMessage: (input: {
      organizationId: string;
      userId: string;
      threadType: 'po';
      threadId: string;
      recipientVendorId: string | null;
      authorName: string;
      body: string;
      attachments: [];
      ownerIdempotencyKey: string;
    }) => Promise<unknown>;
    createVendorMessage: (input: {
      organizationId: string;
      vendorId: string;
      threadType: 'po';
      threadId: string;
      authorName: string;
      body: string;
      attachments: [];
      ownerIdempotencyKey: string;
    }) => Promise<unknown>;
  };

  await methods.createUserMessage({
    organizationId: '00000000-0000-4000-8000-000000000001',
    userId: 'user-1',
    threadType: 'po',
    threadId: 'po-1',
    recipientVendorId: null,
    authorName: 'Buyer',
    body: 'Hello',
    attachments: [],
    ownerIdempotencyKey: 'artifact-operation:user',
  });
  await methods.createVendorMessage({
    organizationId: '00000000-0000-4000-8000-000000000001',
    vendorId: 'vendor-1',
    threadType: 'po',
    threadId: 'po-1',
    authorName: 'Supplier',
    body: 'Hello',
    attachments: [],
    ownerIdempotencyKey: 'artifact-operation:vendor',
  });

  assert.equal(conflictTargets.length, 2);
  for (const target of conflictTargets) {
    assert.equal(target[0], messages.organizationId);
    assert.equal(target[1], messages.idempotencyKey);
  }
});
