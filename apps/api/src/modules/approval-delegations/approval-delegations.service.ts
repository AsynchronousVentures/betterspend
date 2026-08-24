import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, lte, gte } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db, DbTransaction } from '@betterspend/db';
import { approvalDelegations } from '@betterspend/db';
import { sql } from 'drizzle-orm';

@Injectable()
export class ApprovalDelegationsService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async list(orgId: string, activeOnly?: boolean) {
    const rows = await this.db.query.approvalDelegations.findMany({
      where: (d, { and, eq }) => {
        if (activeOnly) {
          return and(eq(d.organizationId, orgId), eq(d.active, true));
        }
        return eq(d.organizationId, orgId);
      },
      orderBy: (d, { desc }) => desc(d.createdAt),
    });
    return this.enrichWithUsers(rows);
  }

  async myDelegations(orgId: string, userId: string) {
    const rows = await this.db.query.approvalDelegations.findMany({
      where: (d, { and, eq }) =>
        and(eq(d.organizationId, orgId), eq(d.delegatorId, userId), eq(d.active, true)),
      orderBy: (d, { desc }) => desc(d.createdAt),
    });
    return this.enrichWithUsers(rows);
  }

  async delegateForMe(orgId: string, userId: string) {
    const rows = await this.db.query.approvalDelegations.findMany({
      where: (d, { and, eq }) =>
        and(eq(d.organizationId, orgId), eq(d.delegateeId, userId), eq(d.active, true)),
      orderBy: (d, { desc }) => desc(d.createdAt),
    });
    return this.enrichWithUsers(rows);
  }

  async create(
    orgId: string,
    delegatorId: string,
    data: { delegateeId: string; startDate: string; endDate: string; reason?: string },
  ) {
    if (delegatorId === data.delegateeId) {
      throw new BadRequestException('Cannot delegate to yourself');
    }
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (end <= start) {
      throw new BadRequestException('End date must be after start date');
    }

    const [delegation] = await this.db
      .insert(approvalDelegations)
      .values({
        organizationId: orgId,
        delegatorId,
        delegateeId: data.delegateeId,
        startDate: start,
        endDate: end,
        reason: data.reason ?? null,
        active: true,
      })
      .returning();

    return delegation;
  }

  async cancel(orgId: string, id: string, userId: string) {
    const delegation = await this.db.query.approvalDelegations.findFirst({
      where: (d, { and, eq }) => and(eq(d.id, id), eq(d.organizationId, orgId)),
    });

    if (!delegation) {
      throw new NotFoundException(`Delegation ${id} not found`);
    }

    // Only the delegator (or admin) can cancel
    if (delegation.delegatorId !== userId) {
      throw new BadRequestException('Only the delegator can cancel a delegation');
    }

    await this.db
      .update(approvalDelegations)
      .set({ active: false })
      .where(eq(approvalDelegations.id, id));

    return { success: true };
  }

  /**
   * Returns the active delegatee user ID for a given delegator, if an active
   * delegation exists covering the current timestamp.
   */
  async getActiveDelegatee(
    orgId: string,
    delegatorId: string,
    executor: Db | DbTransaction = this.db,
  ): Promise<string | null> {
    const now = new Date();
    const result = await executor.query.approvalDelegations.findFirst({
      where: (d, { and, eq, lte, gte }) =>
        and(
          eq(d.organizationId, orgId),
          eq(d.delegatorId, delegatorId),
          eq(d.active, true),
          lte(d.startDate, now),
          gte(d.endDate, now),
        ),
    });
    return result?.delegateeId ?? null;
  }

  private async enrichWithUsers(rows: any[]) {
    if (!rows.length) return rows;

    const allUserIds = new Set<string>();
    for (const row of rows) {
      allUserIds.add(row.delegatorId);
      allUserIds.add(row.delegateeId);
    }

    const ids = Array.from(allUserIds);
    const userRows = (await this.db.execute(
      sql`SELECT id, name, email FROM users WHERE id = ANY(${sql.raw(`ARRAY[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]`)})`,
    )) as any[];

    const userMap: Record<string, { id: string; name: string; email: string }> = {};
    for (const u of userRows) {
      userMap[u.id] = u;
    }

    return rows.map((row) => ({
      ...row,
      delegator: userMap[row.delegatorId] ?? null,
      delegatee: userMap[row.delegateeId] ?? null,
    }));
  }
}
