import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { and, asc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { InvoiceReviewNotificationIntentKind } from '@betterspend/shared';
import {
  invoiceReviewNotificationIntents,
  invoices,
  messages,
  vendors,
  type Db,
  type DbTransaction,
} from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { MailService } from '../../common/mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';

export const INVOICE_REVIEW_DELIVERY_QUEUE = 'invoice-review-notification';
const RECONCILE_JOB_ID = 'invoice-review-notification-reconcile';
const RECONCILE_INTERVAL_MS = 60_000;
const LEASE_DURATION_MS = 5 * 60_000;

type InvoiceReviewDeliveryFieldsByKind = {
  internal_notification: { recipientUserId: string; action: string };
  supplier_message_email: { messageId: string; action: 'request_supplier_info' };
};

type InvoiceReviewDeliveryRecordBase = {
  organizationId: string;
  caseId: string;
  version: number;
};

export type InvoiceReviewDeliveryRecord = {
  [Kind in InvoiceReviewNotificationIntentKind]: InvoiceReviewDeliveryRecordBase &
    InvoiceReviewDeliveryFieldsByKind[Kind] & { intentKind: Kind };
}[InvoiceReviewNotificationIntentKind];

export type InvoiceReviewDeliveryErrorCode =
  | 'INTERNAL_NOTIFICATION_DELIVERY_FAILED'
  | 'SUPPLIER_MESSAGE_MISSING'
  | 'INVOICE_VENDOR_MISSING'
  | 'SUPPLIER_CONTACT_MISSING'
  | 'SMTP_NOT_CONFIGURED'
  | 'SMTP_DELIVERY_FAILED'
  | 'DELIVERY_LEASE_LOST';

class DeliveryError extends Error {
  constructor(readonly code: InvoiceReviewDeliveryErrorCode) {
    super(code);
  }
}

function idempotencyKey(input: InvoiceReviewDeliveryRecord): string {
  if (input.intentKind === 'internal_notification') {
    return `${input.caseId}:${input.version}:${input.action}:internal:${input.recipientUserId}`;
  }
  return `${input.caseId}:${input.version}:${input.action}:supplier:${input.messageId}`;
}

function extractContactEmail(contactInfo: unknown): string | undefined {
  if (!contactInfo || typeof contactInfo !== 'object') return undefined;
  const email = (contactInfo as Record<string, unknown>)['email'];
  if (typeof email !== 'string' || /[,;\r\n]/.test(email)) return undefined;
  const parsed = z.string().trim().email().safeParse(email);
  return parsed.success ? parsed.data : undefined;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character] ?? character;
  });
}

/** Remove control characters before interpolating untrusted text into an SMTP header. */
function sanitizeEmailSubjectText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, '');
}

export async function enqueueInvoiceReviewDelivery(queue: Queue, intentId: string): Promise<void> {
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

/**
 * Durable boundary between invoice-review commands and their independent
 * delivery effects. Commands only record/enqueue; this service owns retries.
 */
@Injectable()
export class InvoiceReviewDeliveries implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvoiceReviewDeliveries.name);
  private scheduleRecoveryTimer?: ReturnType<typeof setInterval>;
  private scheduleRecoveryRunning = false;

  constructor(
    @InjectQueue(INVOICE_REVIEW_DELIVERY_QUEUE) private readonly queue: Queue,
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recoverSchedule();
    await this.enqueuePending().catch((error: unknown) =>
      this.logger.error(`Could not recover invoice review delivery intents: ${String(error)}`),
    );
  }

  onModuleDestroy(): void {
    this.stopScheduleRecovery();
  }

  /** Record all effects in the caller's business transaction. */
  async record(
    transaction: DbTransaction,
    input: readonly InvoiceReviewDeliveryRecord[],
  ): Promise<string[]> {
    const intentIds: string[] = [];
    for (const current of input) {
      const key = idempotencyKey(current);
      const [intent] = await transaction
        .insert(invoiceReviewNotificationIntents)
        .values({
          organizationId: current.organizationId,
          caseId: current.caseId,
          intentKind: current.intentKind,
          recipientUserId:
            current.intentKind === 'internal_notification' ? current.recipientUserId : null,
          messageId: current.intentKind === 'supplier_message_email' ? current.messageId : null,
          action: current.action,
          idempotencyKey: key,
        })
        .onConflictDoNothing({
          target: [
            invoiceReviewNotificationIntents.organizationId,
            invoiceReviewNotificationIntents.idempotencyKey,
          ],
        })
        .returning({ id: invoiceReviewNotificationIntents.id });
      if (intent) {
        intentIds.push(intent.id);
        continue;
      }
      const [existing] = await transaction
        .select({ id: invoiceReviewNotificationIntents.id })
        .from(invoiceReviewNotificationIntents)
        .where(
          and(
            eq(invoiceReviewNotificationIntents.organizationId, current.organizationId),
            eq(invoiceReviewNotificationIntents.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (!existing)
        throw new Error('Invoice review delivery intent was not returned after insert');
      intentIds.push(existing.id);
    }
    return intentIds;
  }

  /** Queue after commit only. A broker failure leaves the durable intents pending. */
  async enqueue(intentIds: readonly string[]): Promise<void> {
    await Promise.all(
      intentIds.map(async (intentId) => {
        try {
          await enqueueInvoiceReviewDelivery(this.queue, intentId);
        } catch (error: unknown) {
          this.logger.error(
            `Could not enqueue invoice review delivery ${intentId}: ${String(error)}`,
          );
        }
      }),
    );
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
      cursor = pending.at(-1);
      if (!cursor) return;
      await this.enqueue(pending.map((intent) => intent.id));
      if (pending.length < pageSize) return;
    }
  }

  async deliver(intentId: string): Promise<void> {
    const leaseToken = randomUUID();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
    const intent = await this.db.transaction(async (transaction) => {
      const [claimed] = await transaction
        .update(invoiceReviewNotificationIntents)
        .set({ leaseToken, leaseExpiresAt, updatedAt: now })
        .where(
          and(
            eq(invoiceReviewNotificationIntents.id, intentId),
            eq(invoiceReviewNotificationIntents.status, 'pending'),
            or(
              isNull(invoiceReviewNotificationIntents.leaseExpiresAt),
              lt(invoiceReviewNotificationIntents.leaseExpiresAt, now),
            ),
          ),
        )
        .returning();
      return claimed;
    });
    if (!intent) return;

    try {
      if (intent.intentKind === 'internal_notification') {
        if (!intent.recipientUserId) throw new DeliveryError('DELIVERY_LEASE_LOST');
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
      } else {
        await this.deliverSupplierMessage(intent);
      }
      const [completed] = await this.db
        .update(invoiceReviewNotificationIntents)
        .set({
          status: 'delivered',
          attempts: sql`${invoiceReviewNotificationIntents.attempts} + 1`,
          deliveredAt: new Date(),
          lastError: null,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(invoiceReviewNotificationIntents.id, intent.id),
            eq(invoiceReviewNotificationIntents.status, 'pending'),
            eq(invoiceReviewNotificationIntents.leaseToken, leaseToken),
          ),
        )
        .returning({ id: invoiceReviewNotificationIntents.id });
      if (!completed) throw new DeliveryError('DELIVERY_LEASE_LOST');
    } catch (error: unknown) {
      const code =
        error instanceof DeliveryError
          ? error.code
          : intent.intentKind === 'internal_notification'
            ? 'INTERNAL_NOTIFICATION_DELIVERY_FAILED'
            : 'SMTP_DELIVERY_FAILED';
      const [released] = await this.db
        .update(invoiceReviewNotificationIntents)
        .set({
          attempts: sql`${invoiceReviewNotificationIntents.attempts} + 1`,
          lastError: code,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(invoiceReviewNotificationIntents.id, intent.id),
            eq(invoiceReviewNotificationIntents.status, 'pending'),
            eq(invoiceReviewNotificationIntents.leaseToken, leaseToken),
          ),
        )
        .returning({ id: invoiceReviewNotificationIntents.id });
      if (!released) throw new DeliveryError('DELIVERY_LEASE_LOST');
      throw new DeliveryError(code);
    }
  }

  private async deliverSupplierMessage(
    intent: typeof invoiceReviewNotificationIntents.$inferSelect,
  ): Promise<void> {
    if (!intent.messageId) throw new DeliveryError('SUPPLIER_MESSAGE_MISSING');
    const [message] = await this.db
      .select({
        threadType: messages.threadType,
        threadId: messages.threadId,
        authorName: messages.authorName,
        body: messages.body,
      })
      .from(messages)
      .where(
        and(eq(messages.id, intent.messageId), eq(messages.organizationId, intent.organizationId)),
      )
      .limit(1);
    if (!message || message.threadType !== 'invoice') {
      throw new DeliveryError('SUPPLIER_MESSAGE_MISSING');
    }
    const [invoice] = await this.db
      .select({ vendorId: invoices.vendorId })
      .from(invoices)
      .where(
        and(eq(invoices.id, message.threadId), eq(invoices.organizationId, intent.organizationId)),
      )
      .limit(1);
    if (!invoice?.vendorId) throw new DeliveryError('INVOICE_VENDOR_MISSING');
    const [vendor] = await this.db
      .select({ name: vendors.name, contactInfo: vendors.contactInfo })
      .from(vendors)
      .where(
        and(eq(vendors.id, invoice.vendorId), eq(vendors.organizationId, intent.organizationId)),
      )
      .limit(1);
    if (!vendor) throw new DeliveryError('INVOICE_VENDOR_MISSING');
    const recipient = extractContactEmail(vendor.contactInfo);
    if (!recipient) throw new DeliveryError('SUPPLIER_CONTACT_MISSING');

    const settings = await this.settings.getAll(intent.organizationId);
    const host = settings['smtp_host']?.trim() ?? '';
    if (!host) throw new DeliveryError('SMTP_NOT_CONFIGURED');
    const configuredAppName = settings['app_name'] || 'BetterSpend';
    const appName = escapeHtml(configuredAppName);
    const subjectAppName = sanitizeEmailSubjectText(configuredAppName) || 'BetterSpend';
    const authorName = escapeHtml(message.authorName);
    const vendorName = escapeHtml(vendor.name);
    const body = escapeHtml(message.body);
    const sent = await this.mail.sendMail(
      {
        host,
        port: Number.parseInt(settings['smtp_port'] || '587', 10),
        secure: settings['smtp_secure'] === 'true',
        user: settings['smtp_user'] || '',
        pass: settings['smtp_pass'] || '',
        from: settings['smtp_from'] || `noreply@${host}`,
        targetPolicy: 'public-only',
      },
      {
        to: recipient,
        subject: `[${subjectAppName}] New message on your INVOICE`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#0f172a">New Message</h2>
            <p>Dear ${vendorName},</p>
            <p>${authorName} sent you a message on your INVOICE record:</p>
            <blockquote style="border-left:3px solid #e2e8f0;margin:16px 0;padding:4px 16px;color:#334155">${body}</blockquote>
            <p>Log in to the vendor portal to read the full thread and reply.</p>
            <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
            <p style="color:#94a3b8;font-size:12px">This is an automated notification from ${appName}.</p>
          </div>
        `,
        text: `New message from ${message.authorName}: ${message.body}\n\nLog in to the vendor portal to read the full thread and reply.`,
        messageId: `invoice-review-delivery-${intent.id}@betterspend.invalid`,
      },
    );
    if (!sent) throw new DeliveryError('SMTP_DELIVERY_FAILED');
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
}
