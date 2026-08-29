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
  AUDIT_HASH_TIMESTAMP_FORMAT,
  computeAuditEntryHash,
  verifyAuditChain,
  type AuditHashFields,
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
      entry_hash varchar(64),
      created_at timestamptz NOT NULL
    )
  `);
  return { database, db: drizzle(database, { schema }) };
}

const auditChainSelection = {
  id: schema.auditLog.id,
  organizationId: schema.auditLog.organizationId,
  userId: schema.auditLog.userId,
  entityType: schema.auditLog.entityType,
  entityId: schema.auditLog.entityId,
  action: schema.auditLog.action,
  changes: schema.auditLog.changes,
  metadata: schema.auditLog.metadata,
  prevHash: schema.auditLog.prevHash,
  entryHash: schema.auditLog.entryHash,
  createdAt: schema.auditLog.createdAt,
  changesJson: sql<string>`COALESCE(${schema.auditLog.changes}::text, 'null')`,
  metadataJson: sql<string>`COALESCE(${schema.auditLog.metadata}::text, 'null')`,
  createdAtText: sql<string>`to_char(
    ${schema.auditLog.createdAt} AT TIME ZONE 'UTC',
    ${AUDIT_HASH_TIMESTAMP_FORMAT}
  )`,
};

function hashFields(overrides: Partial<AuditHashFields> = {}): AuditHashFields {
  return {
    id: '00000000-0000-4000-8000-000000000041',
    organizationId,
    userId: null,
    entityType: 'invoice',
    entityId: '00000000-0000-4000-8000-000000000042',
    action: 'updated',
    changesJson: '{"a":1,"b":2}',
    metadataJson: '{"a":{"b":false,"y":true},"z":1}',
    createdAtText: '2026-08-29T12:00:00.000000Z',
    prevHash: null,
    ...overrides,
  };
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
      .select(auditChainSelection)
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
      .select(auditChainSelection)
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

test('computeAuditEntryHash uses canonical persisted JSONB text', () => {
  const fields = hashFields();
  assert.equal(computeAuditEntryHash(fields), computeAuditEntryHash(hashFields()));
});

test('computeAuditEntryHash distinguishes neighboring persisted JSONB numbers', () => {
  assert.notEqual(
    computeAuditEntryHash(hashFields({ metadataJson: '{"value":9007199254740992}' })),
    computeAuditEntryHash(hashFields({ metadataJson: '{"value":9007199254740993}' })),
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
      .select(auditChainSelection)
      .from(schema.auditLog)
      .where(eq(schema.auditLog.organizationId, organizationId));

    assert.deepEqual(rows[0]?.metadata, { ip: '127.0.0.1' });
    assert.equal(verifyAuditChain(rows as AuditChainRow[]).valid, true);
  } finally {
    await database.close();
  }
});

test('canonicalizes UUID spellings before hashing and persistence', async () => {
  const { database, db } = await createDatabase();
  try {
    const id = '00000000000040008000000000000052';
    const userId = '{10000000-0000-4000-8000-000000000052}'.toUpperCase();
    const entityId = '20000000000040008000000000000052';
    const nonCanonicalOrganizationId = organizationId.replaceAll('-', '').toUpperCase();

    const entry = await db.transaction((transaction) =>
      appendAuditLog(asTransaction(transaction), {
        ...input(id, nonCanonicalOrganizationId),
        userId,
        entityId,
      }),
    );

    assert.equal(entry.id, '00000000-0000-4000-8000-000000000052');
    assert.equal(entry.organizationId, organizationId);
    assert.equal(entry.userId, '10000000-0000-4000-8000-000000000052');
    assert.equal(entry.entityId, '20000000-0000-4000-8000-000000000052');

    const rows = await db
      .select(auditChainSelection)
      .from(schema.auditLog)
      .where(eq(schema.auditLog.organizationId, organizationId));
    assert.equal(verifyAuditChain(rows as AuditChainRow[]).valid, true);
  } finally {
    await database.close();
  }
});

test('verifyAuditChain detects sub-millisecond timestamp tampering', async () => {
  const { database, db } = await createDatabase();
  try {
    const entry = await db.transaction((transaction) =>
      appendAuditLog(asTransaction(transaction), input('00000000-0000-4000-8000-000000000061')),
    );
    await database.exec(
      `UPDATE audit_log
       SET created_at = created_at + INTERVAL '1 microsecond'
       WHERE id = '${entry.id}'`,
    );

    const rows = await db
      .select(auditChainSelection)
      .from(schema.auditLog)
      .where(eq(schema.auditLog.organizationId, organizationId))
      .orderBy(asc(schema.auditLog.createdAt), asc(schema.auditLog.id));
    const report = verifyAuditChain(rows as AuditChainRow[]);

    assert.equal(report.valid, false);
    assert.equal(report.firstBrokenLink?.entryId, entry.id);
    assert.equal(report.firstBrokenLink?.reason, 'entry-hash-mismatch');
  } finally {
    await database.close();
  }
});

test('appendAuditLogIfAbsent fails closed for a rollback-era NULL hash row', async () => {
  const { database, db } = await createDatabase();
  try {
    const stableId = '00000000-0000-4000-8000-000000000071';
    await database.exec(`
      INSERT INTO audit_log (
        id, organization_id, entity_type, entity_id, action, created_at
      ) VALUES (
        '${stableId}', '${organizationId}', 'requisition', '${stableId}',
        'created', '2026-08-29T12:00:00.000000Z'
      )
    `);

    await assert.rejects(
      db.transaction((transaction) =>
        appendAuditLogIfAbsent(asTransaction(transaction), input(stableId)),
      ),
      /Audit hash backfill is incomplete/,
    );
  } finally {
    await database.close();
  }
});

test('audit advisory lock keys are stable and tenant-specific signed integers', () => {
  const first = auditAdvisoryLockKeys(organizationId);
  assert.deepEqual(first, auditAdvisoryLockKeys(organizationId));
  assert.deepEqual(first, auditAdvisoryLockKeys(organizationId.replaceAll('-', '').toUpperCase()));
  assert.notDeepEqual(first, auditAdvisoryLockKeys(otherOrganizationId));
  assert.equal(first.every(Number.isInteger), true);
  assert.throws(() => auditAdvisoryLockKeys('not-a-uuid'), TypeError);
});
