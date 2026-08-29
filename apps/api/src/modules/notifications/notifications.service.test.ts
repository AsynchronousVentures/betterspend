import assert from 'node:assert/strict';
import test from 'node:test';
import { notifications } from '@betterspend/db';
import type { Db } from '@betterspend/db';
import { NotificationsService } from './notifications.service';

test('idempotent notification retries retain one internal notification', async () => {
  const rows: Array<Record<string, unknown>> = [];
  let pending: Record<string, unknown> = {};
  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        pending = values;
        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              if (
                rows.some(
                  (row) =>
                    row.organizationId === pending.organizationId &&
                    row.idempotencyKey === pending.idempotencyKey,
                )
              )
                return [];
              const row = { id: 'notification-1', ...pending };
              rows.push(row);
              return [row];
            },
          }),
        };
      },
    }),
    query: {
      notifications: {
        findFirst: async () => rows[0],
      },
    },
  } as unknown as Db;
  const service = new NotificationsService(db);

  await service.createIdempotent(
    'artifact-stable@betterspend.local',
    'org-1',
    'user-1',
    'new_message',
    'New message',
  );
  await service.createIdempotent(
    'artifact-stable@betterspend.local',
    'org-1',
    'user-1',
    'new_message',
    'New message',
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.idempotencyKey, 'artifact-stable@betterspend.local');
});

test('the same notification identity is independent across organizations', async () => {
  const rows: Array<Record<string, unknown>> = [];
  let pending: Record<string, unknown> = {};
  let conflictTarget: unknown[] | undefined;
  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        pending = values;
        return {
          onConflictDoNothing: (config: { target?: unknown[] }) => {
            conflictTarget = config.target;
            return {
              returning: async () => {
                if (
                  rows.some(
                    (row) =>
                      row.organizationId === pending.organizationId &&
                      row.idempotencyKey === pending.idempotencyKey,
                  )
                )
                  return [];
                const row = { id: `notification-${rows.length + 1}`, ...pending };
                rows.push(row);
                return [row];
              },
            };
          },
        };
      },
    }),
    query: {
      notifications: {
        findFirst: async () =>
          rows.find(
            (row) =>
              row.organizationId === pending.organizationId &&
              row.idempotencyKey === pending.idempotencyKey,
          ),
      },
    },
  } as unknown as Db;
  const service = new NotificationsService(db);

  await service.createIdempotent('shared-key', 'org-1', 'user-1', 'new_message', 'One');
  await service.createIdempotent('shared-key', 'org-2', 'user-2', 'new_message', 'Two');

  assert.deepEqual(
    rows.map((row) => row.organizationId),
    ['org-1', 'org-2'],
  );
  assert.deepEqual(conflictTarget, [notifications.organizationId, notifications.idempotencyKey]);
});

const durableNotification = {
  id: 'notification-1',
  organizationId: 'org-1',
  userId: 'user-1',
  type: 'new_message',
  title: 'New message',
  body: null,
  entityType: 'message',
  entityId: 'message-1',
  readAt: null,
  createdAt: new Date('2026-08-29T00:00:00.000Z'),
  idempotencyKey: 'artifact-stable@betterspend.local',
};

test('notification list responses hide durable delivery identities', async () => {
  const db = {
    query: {
      notifications: {
        findMany: async () => [durableNotification],
      },
    },
    select: () => ({
      from: () => ({
        where: async () => [{ count: 1 }],
      }),
    }),
  } as unknown as Db;
  const service = new NotificationsService(db);

  const response = await service.list('org-1', 'user-1');

  assert.equal(response.items.length, 1);
  assert.equal('idempotencyKey' in response.items[0]!, false);
  assert.equal(response.items[0]?.id, 'notification-1');
});

test('mark-read responses hide durable delivery identities', async () => {
  const db = {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [{ ...durableNotification, readAt: new Date() }],
        }),
      }),
    }),
  } as unknown as Db;
  const service = new NotificationsService(db);

  const response = await service.markRead('notification-1', 'user-1');

  assert.ok(response);
  assert.equal('idempotencyKey' in response, false);
  assert.equal(response.id, 'notification-1');
});
