import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import type { DbTransaction } from './client';
import { insertAuditRows } from './random-seed-persist';
import * as schema from './schema';

const organizationId = '00000000-0000-0000-0000-000000000001';
const entityId = '00000000-0000-0000-0000-000000000010';

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE audit_log (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      user_id uuid,
      entity_type varchar(50) NOT NULL,
      entity_id uuid NOT NULL,
      action varchar(50) NOT NULL,
      changes jsonb DEFAULT '{}'::jsonb,
      metadata jsonb DEFAULT '{}'::jsonb,
      prev_hash varchar(64),
      entry_hash varchar(64),
      created_at timestamptz NOT NULL
    )
  `);
  return { database, db: drizzle(database, { schema }) };
}

function asTransaction(transaction: unknown): DbTransaction {
  return transaction as DbTransaction;
}

function auditInput(id: string, createdAt?: Date) {
  return {
    id,
    organizationId,
    userId: null,
    entityType: 'requisition',
    entityId,
    action: 'created',
    changes: { id },
    metadata: { source: 'random-seed-test' },
    ...(createdAt ? { createdAt } : {}),
  };
}

test('persists seed audit rows chronologically with deterministic ties', async () => {
  const { database, db } = await createDatabase();
  try {
    const base = new Date(Date.now() - 60_000);
    const tiedAt = new Date(base.getTime() + 1_000);
    const laterAt = new Date(base.getTime() + 2_000);
    const values = [
      auditInput('00000000-0000-4000-8000-000000000014', tiedAt),
      auditInput('00000000-0000-4000-8000-000000000012', laterAt),
      auditInput('00000000-0000-4000-8000-000000000015'),
      auditInput('00000000-0000-4000-8000-000000000011', base),
      auditInput('00000000-0000-4000-8000-000000000013', tiedAt),
    ];
    const originalValues = values.map((row) => ({ ...row }));

    await db.transaction((transaction) => insertAuditRows(asTransaction(transaction), values));

    assert.deepEqual(values, originalValues);
    const persisted = await db
      .select({
        id: schema.auditLog.id,
        createdAt: schema.auditLog.createdAt,
        prevHash: schema.auditLog.prevHash,
        entryHash: schema.auditLog.entryHash,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.organizationId, organizationId))
      .orderBy(asc(schema.auditLog.createdAt), asc(schema.auditLog.id));

    assert.deepEqual(
      persisted.map((row) => row.id),
      [
        '00000000-0000-4000-8000-000000000011',
        '00000000-0000-4000-8000-000000000013',
        '00000000-0000-4000-8000-000000000014',
        '00000000-0000-4000-8000-000000000012',
        '00000000-0000-4000-8000-000000000015',
      ],
    );
    assert.equal(persisted[1]?.createdAt.getTime(), tiedAt.getTime());
    assert.equal(persisted[2]?.createdAt.getTime(), tiedAt.getTime() + 1);
    assert.equal(persisted[0]?.prevHash, null);
    for (let index = 1; index < persisted.length; index += 1) {
      assert.equal(persisted[index]?.prevHash, persisted[index - 1]?.entryHash);
    }
  } finally {
    await database.close();
  }
});
