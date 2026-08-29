import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbTransaction } from './client';
import { auditLog } from './schema';

/** @internal The hash payload version stays private to this module's public API. */
export const AUDIT_HASH_VERSION = 1 as const;

/** @internal Shared lock namespace used by appenders and the migration backfill. */
export const AUDIT_HASH_LOCK_SEED = 0x41554449;

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

/** @internal Complete row shape consumed by the local hash implementation. */
export type AuditHashFields = {
  id: string;
  organizationId: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown;
  metadata: unknown;
  createdAt: Date;
  prevHash: string | null;
};

type JsonObject = { [key: string]: JsonValue };
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

function sortJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(sortJson);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.keys(object)
      .sort()
      .reduce<JsonObject>(
        (sorted, key) => {
          sorted[key] = sortJson(object[key]);
          return sorted;
        },
        Object.create(null) as JsonObject,
      );
  }
  return null;
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
    changes: sortJson(fields.changes),
    metadata: sortJson(fields.metadata),
    createdAt: fields.createdAt.toISOString(),
    prevHash: fields.prevHash,
  });
}

/** @internal Compute a digest for migration code without exposing canonicalization. */
export function computeAuditEntryHash(fields: AuditHashFields): string {
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
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.organizationId}, ${AUDIT_HASH_LOCK_SEED}))`,
  );

  const [previous] = await transaction
    .select({ id: auditLog.id, entryHash: auditLog.entryHash, createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(eq(auditLog.organizationId, input.organizationId))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(1);

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
  const entryHash = computeAuditEntryHash({
    id,
    organizationId: input.organizationId,
    userId: input.userId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    changes,
    metadata,
    createdAt,
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
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.organizationId}, ${AUDIT_HASH_LOCK_SEED}))`,
  );
  const [existing] = await transaction
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.id, input.id), eq(auditLog.organizationId, input.organizationId)))
    .limit(1);
  if (existing) return existing;
  return appendAuditLog(transaction, input);
}

export type AuditChainRow = AuditHashFields & {
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
