import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationTag = '20260830211736_funny_metal_master';
const migrationPath = join(__dirname, 'migrations', `${migrationTag}.sql`);

test('lead-day migration preserves legacy rows while enforcing new writes', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE contract_obligations (
        id integer PRIMARY KEY,
        notification_lead_days integer NOT NULL DEFAULT 30
      );
      INSERT INTO contract_obligations (id, notification_lead_days) VALUES (1, -1);
    `);

    assert.match(migration, /contract_obligations_notification_lead_days_check/);
    assert.match(migration, /CHECK \([^;]+ >= 0\) NOT VALID/);
    assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE)\b/);

    await database.exec(migration);

    const existing = await database.query<{ notificationLeadDays: number }>(
      'SELECT notification_lead_days AS "notificationLeadDays" FROM contract_obligations WHERE id = 1',
    );
    assert.deepEqual(existing.rows, [{ notificationLeadDays: -1 }]);

    const constraints = await database.query<{ validated: boolean }>(
      `SELECT convalidated AS validated
       FROM pg_constraint
       WHERE conname = 'contract_obligations_notification_lead_days_check'`,
    );
    assert.deepEqual(constraints.rows, [{ validated: false }]);

    await assert.rejects(
      database.exec('INSERT INTO contract_obligations (id, notification_lead_days) VALUES (2, -2)'),
      /contract_obligations_notification_lead_days_check/,
    );
    await assert.rejects(
      database.exec('UPDATE contract_obligations SET notification_lead_days = -3 WHERE id = 1'),
      /contract_obligations_notification_lead_days_check/,
    );
  } finally {
    await database.close();
  }
});
