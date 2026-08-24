import { Injectable, Inject } from '@nestjs/common';
import { desc, eq, and } from 'drizzle-orm';
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

    return this.db.query.auditLog.findMany({
      where: (a, { and, eq }) => {
        const conditions = [eq(a.organizationId, organizationId)];
        if (filters?.entityType) conditions.push(eq(a.entityType, filters.entityType));
        if (filters?.entityId) conditions.push(eq(a.entityId, filters.entityId));
        return and(...conditions);
      },
      orderBy: (a, { desc }) => desc(a.createdAt),
      limit,
    });
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
