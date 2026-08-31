import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { invoiceReviewNotificationIntents, type Db, type DbTransaction } from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';

export const INVOICE_REVIEW_NOTIFICATION_QUEUE = 'invoice-review-notification';
const RECONCILE_JOB_ID = 'invoice-review-notification-reconcile';
const RECONCILE_INTERVAL_MS = 60_000;

export async function enqueueInvoiceReviewNotification(
  queue: Queue,
  intentId: string,
): Promise<void> {
  await queue.add(
    'deliver',
    { intentId },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      jobId: `invoice-review-notification-${intentId}`,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

@Injectable()
export class InvoiceReviewNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvoiceReviewNotificationsService.name);
  private scheduleRecoveryTimer?: ReturnType<typeof setInterval>;
  private scheduleRecoveryRunning = false;

  constructor(
    @InjectQueue(INVOICE_REVIEW_NOTIFICATION_QUEUE) private readonly queue: Queue,
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recoverSchedule();
    await this.enqueuePending().catch((error: unknown) =>
      this.logger.error(`Could not recover invoice review notification intents: ${String(error)}`),
    );
  }

  onModuleDestroy(): void {
    this.stopScheduleRecovery();
  }

  async createIntent(
    transaction: DbTransaction,
    input: {
      organizationId: string;
      caseId: string;
      recipientUserId: string;
      action: string;
      version: number;
    },
  ): Promise<string | null> {
    const idempotencyKey = `${input.caseId}:${input.version}:${input.action}:${input.recipientUserId}`;
    const [intent] = await transaction
      .insert(invoiceReviewNotificationIntents)
      .values({ ...input, idempotencyKey })
      .onConflictDoNothing({
        target: [
          invoiceReviewNotificationIntents.organizationId,
          invoiceReviewNotificationIntents.idempotencyKey,
        ],
      })
      .returning({ id: invoiceReviewNotificationIntents.id });
    return intent?.id ?? null;
  }

  /** Queue after commit only. A broker failure leaves the durable intent pending. */
  async enqueue(intentIds: readonly string[]): Promise<void> {
    await Promise.all(
      intentIds.map(async (intentId) => {
        try {
          await enqueueInvoiceReviewNotification(this.queue, intentId);
        } catch (error: unknown) {
          this.logger.error(
            `Could not enqueue invoice review notification ${intentId}: ${String(error)}`,
          );
        }
      }),
    );
  }

  private async recoverSchedule(): Promise<void> {
    if (this.scheduleRecoveryRunning) return;
    this.scheduleRecoveryRunning = true;
    try {
      await this.queue.add(
        'reconcile',
        { kind: 'reconcile' },
        {
          jobId: RECONCILE_JOB_ID,
          repeat: { every: RECONCILE_INTERVAL_MS, key: RECONCILE_JOB_ID },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
      this.stopScheduleRecovery();
    } catch (error: unknown) {
      this.logger.warn(`Could not register invoice review reconciliation: ${String(error)}`);
      this.startScheduleRecovery();
    } finally {
      this.scheduleRecoveryRunning = false;
    }
  }

  private startScheduleRecovery(): void {
    if (this.scheduleRecoveryTimer) return;
    this.scheduleRecoveryTimer = setInterval(() => {
      void this.recoverSchedule();
    }, RECONCILE_INTERVAL_MS);
    this.scheduleRecoveryTimer.unref();
  }

  private stopScheduleRecovery(): void {
    if (!this.scheduleRecoveryTimer) return;
    clearInterval(this.scheduleRecoveryTimer);
    this.scheduleRecoveryTimer = undefined;
  }

  async enqueuePending(pageSize = 100): Promise<void> {
    let cursor: { createdAt: string; id: string } | undefined;
    while (true) {
      const pending = await this.db
        .select({
          id: invoiceReviewNotificationIntents.id,
          createdAt: sql<string>`${invoiceReviewNotificationIntents.createdAt}::text`,
        })
        .from(invoiceReviewNotificationIntents)
        .where(
          cursor
            ? and(
                eq(invoiceReviewNotificationIntents.status, 'pending'),
                or(
                  gt(
                    invoiceReviewNotificationIntents.createdAt,
                    sql`${cursor.createdAt}::timestamptz`,
                  ),
                  and(
                    eq(
                      invoiceReviewNotificationIntents.createdAt,
                      sql`${cursor.createdAt}::timestamptz`,
                    ),
                    gt(invoiceReviewNotificationIntents.id, cursor.id),
                  ),
                ),
              )
            : eq(invoiceReviewNotificationIntents.status, 'pending'),
        )
        .orderBy(
          asc(invoiceReviewNotificationIntents.createdAt),
          asc(invoiceReviewNotificationIntents.id),
        )
        .limit(pageSize);
      if (pending.length === 0) return;
      const lastIntent = pending.at(-1);
      if (!lastIntent) return;
      cursor = lastIntent;
      await this.enqueue(pending.map((intent) => intent.id));
      if (pending.length < pageSize) return;
    }
  }

  async deliver(intentId: string): Promise<void> {
    const [intent] = await this.db
      .select()
      .from(invoiceReviewNotificationIntents)
      .where(eq(invoiceReviewNotificationIntents.id, intentId))
      .limit(1);
    if (!intent || intent.status === 'delivered') return;

    try {
      await this.notifications.createIdempotent(
        intent.idempotencyKey,
        intent.organizationId,
        intent.recipientUserId,
        'invoice_exception',
        'Invoice review updated',
        'An invoice review case assigned to you changed.',
        'invoice_review_case',
        intent.caseId,
      );
      await this.db
        .update(invoiceReviewNotificationIntents)
        .set({
          status: 'delivered',
          attempts: sql`${invoiceReviewNotificationIntents.attempts} + 1`,
          deliveredAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(invoiceReviewNotificationIntents.id, intent.id),
            eq(invoiceReviewNotificationIntents.status, 'pending'),
          ),
        );
    } catch (error: unknown) {
      await this.db
        .update(invoiceReviewNotificationIntents)
        .set({
          attempts: sql`${invoiceReviewNotificationIntents.attempts} + 1`,
          lastError: String(error).slice(0, 1_000),
          updatedAt: new Date(),
        })
        .where(eq(invoiceReviewNotificationIntents.id, intent.id));
      throw error;
    }
  }
}
