import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import type { DbTransaction } from './client';
import {
  appendAuditLog,
  appendAuditLogIfAbsent,
  auditAdvisoryLockKeys,
  computeAuditEntryHash,
  verifyAuditChain,
  type AuditChainRow,
} from './audit-integrity';
import * as schema from './schema';

const organizationId = '00000000-0000-4000-8000-000000000001';
const otherOrganizationId = '00000000-0000-4000-8000-000000000002';

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
      entry_hash varchar(64) NOT NULL,
      created_at timestamptz NOT NULL
    )
  `);
  return { database, db: drizzle(database, { schema }) };
}

function asTransaction(transaction: unknown): DbTransaction {
  return transaction as DbTransaction;
}

function input(
  id: string,
  organization = organizationId,
  createdAt = new Date('2026-08-29T12:00:00.000Z'),
) {
  return {
    id,
    organizationId: organization,
    userId: null,
    entityType: 'requisition',
    entityId: id,
    action: 'created',
    changes: { z: 1, a: 2 },
    metadata: { source: 'test' },
    createdAt,
  };
}

test('appendAuditLog serializes one tenant chain and isolates other tenants', async () => {
  const { database, db } = await createDatabase();
  try {
    const first = await db.transaction((transaction) =>
      appendAuditLog(asTransaction(transaction), input('00000000-0000-4000-8000-000000000011')),
    );
    const second = await db.transaction((transaction) =>
      appendAuditLog(asTransaction(transaction), input('00000000-0000-4000-8000-000000000012')),
    );
    const other = await db.transaction((transaction) =>
      appendAuditLog(
        asTransaction(transaction),
        input('00000000-0000-4000-8000-000000000013', otherOrganizationId),
      ),
    );

    assert.equal(first.prevHash, null);
    assert.equal(second.prevHash, first.entryHash);
    assert.equal(other.prevHash, null);
    assert.ok(first.entryHash);
    assert.ok(second.entryHash);
    assert.ok(other.entryHash);
    assert.equal(second.createdAt.getTime(), first.createdAt.getTime() + 1);
  } finally {
    await database.close();
  }
});

test('appendAuditLogIfAbsent makes stable retries a no-op', async () => {
  const { database, db } = await createDatabase();
  try {
    const stableInput = input('00000000-0000-4000-8000-000000000021');
    const first = await db.transaction((transaction) =>
      appendAuditLogIfAbsent(asTransaction(transaction), stableInput),
    );
    const retry = await db.transaction((transaction) =>
      appendAuditLogIfAbsent(asTransaction(transaction), stableInput),
    );
    assert.ok(first);
    assert.deepEqual(retry, first);
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.organizationId, organizationId));
    assert.equal(rows.length, 1);
  } finally {
    await database.close();
  }
});

test('verifyAuditChain reports the first tampered entry in a date range', async () => {
  const { database, db } = await createDatabase();
  try {
    const first = await db.transaction((transaction) =>
      appendAuditLog(
        asTransaction(transaction),
        input(
          '00000000-0000-4000-8000-000000000031',
          organizationId,
          new Date('2026-08-28T12:00:00Z'),
        ),
      ),
    );
    const second = await db.transaction((transaction) =>
      appendAuditLog(
        asTransaction(transaction),
        input(
          '00000000-0000-4000-8000-000000000032',
          organizationId,
          new Date('2026-08-29T12:00:00Z'),
        ),
      ),
    );
    await db
      .update(schema.auditLog)
      .set({ changes: { tampered: true } })
      .where(eq(schema.auditLog.id, first.id));

    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.organizationId, organizationId),
          sql`${schema.auditLog.createdAt} <= ${second.createdAt}`,
        ),
      )
      .orderBy(asc(schema.auditLog.createdAt), asc(schema.auditLog.id));
    const report = verifyAuditChain(rows as AuditChainRow[], {
      from: new Date('2026-08-29T00:00:00Z'),
      to: second.createdAt,
    });

    assert.equal(report.valid, true);
    assert.equal(report.firstBrokenLink, null);

    const fullReport = verifyAuditChain(rows as AuditChainRow[]);
    assert.equal(fullReport.valid, false);
    assert.equal(fullReport.firstBrokenLink?.entryId, first.id);
    assert.equal(fullReport.firstBrokenLink?.reason, 'entry-hash-mismatch');
  } finally {
    await database.close();
  }
});

test('computeAuditEntryHash is independent of JSON object insertion order', () => {
  const fields = {
    id: '00000000-0000-4000-8000-000000000041',
    organizationId,
    userId: null,
    entityType: 'invoice',
    entityId: '00000000-0000-4000-8000-000000000042',
    action: 'updated',
    metadata: { z: 1, a: { y: true, b: false } },
    changes: { b: 2, a: 1 },
    createdAt: new Date('2026-08-29T12:00:00.000Z'),
    prevHash: null,
  };
  assert.equal(
    computeAuditEntryHash(fields),
    computeAuditEntryHash({
      ...fields,
      changes: { a: 1, b: 2 },
      metadata: { a: { b: false, y: true }, z: 1 },
    }),
  );
});

test('hashes the same JSON representation that PostgreSQL persists', async () => {
  const { database, db } = await createDatabase();
  try {
    await db.transaction((transaction) =>
      appendAuditLog(asTransaction(transaction), {
        ...input('00000000-0000-4000-8000-000000000051'),
        metadata: { ip: '127.0.0.1', userAgent: undefined },
      }),
    );
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.organizationId, organizationId));

    assert.deepEqual(rows[0]?.metadata, { ip: '127.0.0.1' });
    assert.equal(verifyAuditChain(rows as AuditChainRow[]).valid, true);
  } finally {
    await database.close();
  }
});

test('audit advisory lock keys are stable and tenant-specific signed integers', () => {
  const first = auditAdvisoryLockKeys(organizationId);
  assert.deepEqual(first, auditAdvisoryLockKeys(organizationId));
  assert.notDeepEqual(first, auditAdvisoryLockKeys(otherOrganizationId));
  assert.equal(first.every(Number.isInteger), true);
  assert.throws(() => auditAdvisoryLockKeys('not-a-uuid'), TypeError);
});
