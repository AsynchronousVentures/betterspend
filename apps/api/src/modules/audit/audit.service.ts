import { Injectable, Inject } from '@nestjs/common';
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db, DbTransaction } from '@betterspend/db';
import { appendAuditLog, auditLog, verifyAuditChain, type AuditChainRange } from '@betterspend/db';

@Injectable()
export class AuditService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async findAll(
    organizationId: string,
    filters?: { entityType?: string; entityId?: string; limit?: number },
  ) {
    const limit = filters?.limit ?? 200;
    return this.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, organizationId),
          filters?.entityType ? eq(auditLog.entityType, filters.entityType) : undefined,
          filters?.entityId ? eq(auditLog.entityId, filters.entityId) : undefined,
        ),
      )
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(limit);
  }

  async verifyChain(organizationId: string, range: AuditChainRange = {}) {
    const rows = await this.db
      .select({
        id: auditLog.id,
        organizationId: auditLog.organizationId,
        userId: auditLog.userId,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        action: auditLog.action,
        changes: auditLog.changes,
        metadata: auditLog.metadata,
        prevHash: auditLog.prevHash,
        entryHash: auditLog.entryHash,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, organizationId),
          range.to ? lte(auditLog.createdAt, range.to) : undefined,
        ),
      )
      .orderBy(asc(auditLog.createdAt), asc(auditLog.id));

    return {
      organizationId,
      from: range.from?.toISOString() ?? null,
      to: range.to?.toISOString() ?? null,
      ...verifyAuditChain(rows, range),
    };
  }

  async log(
    organizationId: string,
    userId: string | null,
    entityType: string,
    entityId: string,
    action: string,
    changes?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
    executor?: DbTransaction,
  ) {
    const input = {
      organizationId,
      userId: userId ?? null,
      entityType,
      entityId,
      action,
      changes: changes ?? {},
      metadata: metadata ?? {},
    };
    return executor
      ? appendAuditLog(executor, input)
      : this.db.transaction((transaction) => appendAuditLog(transaction, input));
  }
}
