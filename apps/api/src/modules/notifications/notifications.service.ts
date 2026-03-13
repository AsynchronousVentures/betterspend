import { Injectable, Inject } from '@nestjs/common';
import { eq, and, isNull, sql, asc } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { notificationPreferences, notifications } from '@betterspend/db';

const DEFAULT_NOTIFICATION_TYPES = [
  'approval_request',
  'po_issued',
  'invoice_exception',
  'invoice_approved',
  'spend_guard',
  'software_license',
];

export type NotificationPreferencesInput = {
  emailEnabled?: boolean;
  frequency?: 'instant' | 'daily' | 'weekly';
  enabledTypes?: string[];
};

function defaultPreferences(orgId: string, userId: string) {
  return {
    organizationId: orgId,
    userId,
    emailEnabled: true,
    frequency: 'instant' as const,
    enabledTypes: DEFAULT_NOTIFICATION_TYPES,
  };
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
  ) {}

  async create(
    orgId: string,
    userId: string,
    type: string,
    title: string,
    body?: string,
    entityType?: string,
    entityId?: string,
  ) {
    const [notification] = await this.db
      .insert(notifications)
      .values({
        organizationId: orgId,
        userId,
        type,
        title,
        body: body ?? null,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
      })
      .returning();
    return notification;
  }

  async list(
    orgId: string,
    userId: string,
    options?: {
      unreadOnly?: boolean;
      limit?: number;
      offset?: number;
      type?: string;
      status?: 'all' | 'read' | 'unread';
      sort?: 'newest' | 'oldest';
    },
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const filters = [
      eq(notifications.organizationId, orgId),
      eq(notifications.userId, userId),
    ];
    if (options?.unreadOnly || options?.status === 'unread') {
      filters.push(isNull(notifications.readAt));
    }
    if (options?.status === 'read') {
      filters.push(sql`${notifications.readAt} is not null`);
    }
    if (options?.type) {
      filters.push(eq(notifications.type, options.type));
    }

    const whereClause = and(...filters);
    const [rows, totalRows] = await Promise.all([
      this.db.query.notifications.findMany({
        where: whereClause,
        orderBy:
          options?.sort === 'oldest'
            ? (n, operators) => operators.asc(n.createdAt)
            : (n, operators) => operators.desc(n.createdAt),
        limit,
        offset,
      }),
      this.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(notifications)
        .where(whereClause),
    ]);
    return {
      items: rows,
      total: totalRows[0]?.count ?? 0,
      limit,
      offset,
    };
  }

  async getPreferences(orgId: string, userId: string) {
    const [stored] = await this.db
      .select()
      .from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.organizationId, orgId),
        eq(notificationPreferences.userId, userId),
      ))
      .limit(1);

    if (!stored) {
      return defaultPreferences(orgId, userId);
    }

    return {
      organizationId: stored.organizationId,
      userId: stored.userId,
      emailEnabled: stored.emailEnabled,
      frequency: (stored.frequency as 'instant' | 'daily' | 'weekly') ?? 'instant',
      enabledTypes: Array.isArray(stored.enabledTypes) ? stored.enabledTypes : DEFAULT_NOTIFICATION_TYPES,
    };
  }

  async upsertPreferences(orgId: string, userId: string, input: NotificationPreferencesInput) {
    const current = await this.getPreferences(orgId, userId);
    const nextEnabledTypes = Array.isArray(input.enabledTypes)
      ? input.enabledTypes
      : current.enabledTypes;

    const [updated] = await this.db
      .insert(notificationPreferences)
      .values({
        organizationId: orgId,
        userId,
        emailEnabled: input.emailEnabled ?? current.emailEnabled,
        frequency: input.frequency ?? current.frequency,
        enabledTypes: nextEnabledTypes,
      })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: {
          emailEnabled: input.emailEnabled ?? current.emailEnabled,
          frequency: input.frequency ?? current.frequency,
          enabledTypes: nextEnabledTypes,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      organizationId: updated.organizationId,
      userId: updated.userId,
      emailEnabled: updated.emailEnabled,
      frequency: updated.frequency as 'instant' | 'daily' | 'weekly',
      enabledTypes: Array.isArray(updated.enabledTypes) ? updated.enabledTypes : DEFAULT_NOTIFICATION_TYPES,
    };
  }

  async getAvailableTypes(orgId: string, userId: string) {
    const rows = await this.db
      .selectDistinct({ type: notifications.type })
      .from(notifications)
      .where(and(
        eq(notifications.organizationId, orgId),
        eq(notifications.userId, userId),
      ))
      .orderBy(asc(notifications.type));

    return rows
      .map((row) => row.type)
      .filter((value): value is string => Boolean(value));
  }

  async markRead(id: string, userId: string) {
    const [updated] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning();
    return updated;
  }

  async markAllRead(orgId: string, userId: string) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.organizationId, orgId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      );
    return { success: true };
  }

  async getUnreadCount(orgId: string, userId: string): Promise<{ count: number }> {
    const result = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, orgId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      );
    return { count: result[0]?.count ?? 0 };
  }
}
