import { Injectable, Inject } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db, DbTransaction } from '@betterspend/db';
import { auditLog } from '@betterspend/db';

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
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);
  }

  async log(
    organizationId: string,
    userId: string | null,
    entityType: string,
    entityId: string,
    action: string,
    changes?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
    executor: Db | DbTransaction = this.db,
  ) {
    const [entry] = await executor
      .insert(auditLog)
      .values({
        organizationId,
        userId: userId ?? null,
        entityType,
        entityId,
        action,
        changes: changes ?? {},
        metadata: metadata ?? {},
      })
      .returning();
    return entry;
  }
}
