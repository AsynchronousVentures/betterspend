import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbTransaction } from './client';
import { auditLog } from './schema';

/** @internal The hash payload version stays private to this module's public API. */
export const AUDIT_HASH_VERSION = 1 as const;

/** @internal Stable signed lock pair used by appenders and the migration backfill. */
export function auditAdvisoryLockKeys(organizationId: string): readonly [number, number] {
  const normalized = organizationId.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(normalized)) {
    throw new TypeError('Audit organizationId must be a UUID');
  }
  return [toSignedInt32(normalized.slice(0, 8)), toSignedInt32(normalized.slice(24, 32))];
}

function toSignedInt32(hex: string): number {
  const value = Number.parseInt(hex, 16);
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

export type AuditEntryInput = {
  id?: string;
  organizationId: string;
  userId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes?: unknown;
  metadata?: unknown;
  createdAt?: Date;
};

/** @internal Exact database projections consumed by the local hash implementation. */
export type AuditHashFields = {
  id: string;
  organizationId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changesJson: string;
  metadataJson: string;
  createdAtText: string;
  prevHash: string | null;
};

export const AUDIT_HASH_TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

type AuditPersistedProjection = {
  changesJson: string;
  metadataJson: string;
  createdAtText: string;
};

function rawQueryRows<T>(result: unknown): readonly T[] {
  if (Array.isArray(result)) return result as T[];
  if (typeof result === 'object' && result !== null && 'rows' in result) {
    const rows = result.rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  throw new Error('Audit entry projection returned an unexpected result');
}

function jsonParameter(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 'null' : serialized;
}

async function projectAuditInput(
  transaction: DbTransaction,
  changes: unknown,
  metadata: unknown,
  createdAt: Date,
): Promise<AuditPersistedProjection> {
  const result = await transaction.execute<AuditPersistedProjection>(sql`
    SELECT
      COALESCE(${jsonParameter(changes)}::jsonb::text, 'null') AS "changesJson",
      COALESCE(${jsonParameter(metadata)}::jsonb::text, 'null') AS "metadataJson",
      to_char(
        ${createdAt.toISOString()}::timestamptz AT TIME ZONE 'UTC',
        ${AUDIT_HASH_TIMESTAMP_FORMAT}
      ) AS "createdAtText"
  `);
  const [projection] = rawQueryRows<AuditPersistedProjection>(result);
  if (!projection) throw new Error('Audit entry projection was not returned');
  return projection;
}

function canonicalPayload(fields: AuditHashFields): string {
  return JSON.stringify({
    version: AUDIT_HASH_VERSION,
    id: fields.id,
    organizationId: fields.organizationId,
    userId: fields.userId,
    entityType: fields.entityType,
    entityId: fields.entityId,
    action: fields.action,
    changes: fields.changesJson,
    metadata: fields.metadataJson,
    createdAt: fields.createdAtText,
    prevHash: fields.prevHash,
  });
}

/** @internal Compute a digest for migration code without exposing canonicalization. */
export function computeAuditEntryHash(fields: AuditHashFields): string {
  // This is an audit integrity digest, not password storage.
  // codeql[js/insufficient-password-hash]
  return createHash('sha256').update(canonicalPayload(fields)).digest('hex');
}

/**
 * Append an audit entry inside an existing business transaction.
 *
 * The transaction must remain open until the business mutation commits. A
 * transaction-scoped advisory lock serializes only entries for this tenant,
 * while the latest-row query keeps tenant chains independent.
 */
export async function appendAuditLog(
  transaction: DbTransaction,
  input: AuditEntryInput,
): Promise<typeof auditLog.$inferSelect> {
  await lockAuditChain(transaction, input.organizationId);

  const [previous] = await transaction
    .select({ id: auditLog.id, entryHash: auditLog.entryHash, createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(eq(auditLog.organizationId, input.organizationId))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(1);
  if (previous && !previous.entryHash) {
    throw new Error('Audit hash backfill is incomplete for this organization');
  }

  const id = input.id ?? randomUUID();
  const requestedCreatedAt = input.createdAt ?? new Date();
  if (Number.isNaN(requestedCreatedAt.getTime())) {
    throw new Error('Audit entry createdAt must be a valid date');
  }
  const createdAt = previous
    ? new Date(Math.max(requestedCreatedAt.getTime(), previous.createdAt.getTime() + 1))
    : requestedCreatedAt;
  const prevHash = previous?.entryHash ?? null;
  const changes = input.changes === undefined ? {} : input.changes;
  const metadata = input.metadata === undefined ? {} : input.metadata;
  const projection = await projectAuditInput(transaction, changes, metadata, createdAt);
  const entryHash = computeAuditEntryHash({
    id,
    organizationId: input.organizationId,
    userId: input.userId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    ...projection,
    prevHash,
  });

  const [entry] = await transaction
    .insert(auditLog)
    .values({
      id,
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      changes,
      metadata,
      prevHash,
      entryHash,
      createdAt,
    })
    .returning();

  if (!entry) throw new Error('Audit entry was not returned after insert');
  return entry;
}

/** Append a stable, retry-safe audit entry without creating a second row. */
export async function appendAuditLogIfAbsent(
  transaction: DbTransaction,
  input: AuditEntryInput & { id: string },
): Promise<typeof auditLog.$inferSelect | undefined> {
  await lockAuditChain(transaction, input.organizationId);
  const [existing] = await transaction
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.id, input.id), eq(auditLog.organizationId, input.organizationId)))
    .limit(1);
  if (existing) {
    if (!existing.entryHash) {
      throw new Error('Audit hash backfill is incomplete for this organization');
    }
    return existing;
  }
  return appendAuditLog(transaction, input);
}

async function lockAuditChain(transaction: DbTransaction, organizationId: string): Promise<void> {
  const [lockKeyA, lockKeyB] = auditAdvisoryLockKeys(organizationId);
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(${lockKeyA}, ${lockKeyB})`);
}

export type AuditChainRow = AuditHashFields & {
  createdAt: Date;
  entryHash: string | null;
};

export type AuditChainFailure = {
  entryId: string;
  previousEntryId: string | null;
  reason: 'missing-prev-hash' | 'prev-hash-mismatch' | 'entry-hash-mismatch';
  expectedPrevHash: string | null;
  actualPrevHash: string | null;
  expectedEntryHash: string;
  actualEntryHash: string | null;
};

export type AuditChainVerification = {
  valid: boolean;
  checkedEntries: number;
  firstBrokenLink: AuditChainFailure | null;
};

export type AuditChainRange = {
  from?: Date;
  to?: Date;
};

/** Verify rows already scoped to one organization and ordered oldest first. */
export function verifyAuditChain(
  rows: readonly AuditChainRow[],
  range: AuditChainRange = {},
): AuditChainVerification {
  let previous: AuditChainRow | undefined;
  let checkedEntries = 0;
  for (const row of rows) {
    const inRange =
      (!range.from || row.createdAt >= range.from) && (!range.to || row.createdAt <= range.to);
    if (inRange) checkedEntries += 1;
    const expectedPrevHash = previous?.entryHash ?? null;
    const expectedEntryHash = computeAuditEntryHash(row);
    let reason: AuditChainFailure['reason'] | undefined;
    if (row.prevHash !== expectedPrevHash) {
      reason = row.prevHash === null ? 'missing-prev-hash' : 'prev-hash-mismatch';
    } else if (row.entryHash !== expectedEntryHash) {
      reason = 'entry-hash-mismatch';
    }
    if (reason && inRange) {
      return {
        valid: false,
        checkedEntries,
        firstBrokenLink: {
          entryId: row.id,
          previousEntryId: previous?.id ?? null,
          reason,
          expectedPrevHash,
          actualPrevHash: row.prevHash,
          expectedEntryHash,
          actualEntryHash: row.entryHash,
        },
      };
    }
    previous = row;
  }
  return { valid: true, checkedEntries, firstBrokenLink: null };
}
