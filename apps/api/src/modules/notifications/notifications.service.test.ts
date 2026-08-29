import assert from 'node:assert/strict';
import test from 'node:test';
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
              if (rows.some((row) => row.idempotencyKey === pending.idempotencyKey)) return [];
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
