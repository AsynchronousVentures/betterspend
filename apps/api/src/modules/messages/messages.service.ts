import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import {
  auditLog,
  messages,
  purchaseOrders,
  invoices,
  rfqRequests,
  goodsReceipts,
  rfqInvitations,
} from '@betterspend/db';
import {
  MESSAGE_THREAD_TYPES,
  type MessageThreadType,
  type PostMessageInput,
} from '@betterspend/shared';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../../common/mail/mail.service';
import { SettingsService } from '../settings/settings.service';

export const THREAD_TYPES = MESSAGE_THREAD_TYPES;
export type ThreadType = MessageThreadType;

export function parseThreadType(threadType: string): ThreadType {
  if (!(THREAD_TYPES as readonly string[]).includes(threadType)) {
    throw new BadRequestException(`Unsupported thread type "${threadType}"`);
  }
  return threadType as ThreadType;
}

interface ThreadContext {
  vendorId: string | null;
  internalUserId: string | null;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly settingsService: SettingsService,
  ) {}

  async list(organizationId: string, threadType: ThreadType, threadId: string) {
    await this.assertThreadExists(organizationId, threadType, threadId);
    // Latest window of the thread, returned in ascending order for rendering.
    const rows = await this.db.query.messages.findMany({
      where: (m, { and, eq }) =>
        and(
          eq(m.organizationId, organizationId),
          eq(m.threadType, threadType),
          eq(m.threadId, threadId),
        ),
      orderBy: (m, { desc }) => desc(m.createdAt),
      limit: 500,
    });
    return rows.reverse();
  }

  /**
   * Vendor-facing read path for the portal. Enforces the same access rules as
   * posting and hides competing vendors' messages on RFQ threads: a vendor
   * sees its own messages plus the buyer's replies, never other vendors'.
   */
  async listAsVendor(
    organizationId: string,
    vendorId: string,
    threadType: ThreadType,
    threadId: string,
  ) {
    const context = await this.getThreadContext(organizationId, threadType, threadId);
    if (!context) throw new NotFoundException('Thread not found');
    await this.assertVendorAccess(organizationId, vendorId, threadType, threadId, context);

    const all = await this.list(organizationId, threadType, threadId);
    if (threadType !== 'rfq') return all;
    // Vendors see their own messages plus buyer messages that are broadcast
    // (no recipient) or addressed specifically to them. Buyer messages
    // addressed to a different vendor are excluded.
    return all.filter(
      (message) =>
        message.vendorId === vendorId ||
        (message.senderType === 'user' &&
          (message.recipientVendorId == null || message.recipientVendorId === vendorId)),
    );
  }

  /** Post a message as the signed-in internal user and email the supplier contact. */
  async postAsUser(
    organizationId: string,
    userId: string,
    threadType: ThreadType,
    threadId: string,
    input: PostMessageInput,
  ) {
    const trimmedBody = input.body?.trim();
    if (!trimmedBody) throw new BadRequestException('Message body is required');
    const threadContext = await this.getThreadContext(organizationId, threadType, threadId);
    if (!threadContext) throw new NotFoundException(`Thread ${threadType}/${threadId} not found`);
    const user = await this.db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, userId) });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    // RFQ threads can address a message to a single invited vendor; anything
    // else is broadcast. Recipient must hold an invitation to receive one.
    let recipientVendorId: string | null = null;
    if (threadType === 'rfq' && input.recipientVendorId) {
      const invitation = await this.db.query.rfqInvitations.findFirst({
        where: (inv, { and, eq }) =>
          and(eq(inv.rfqId, threadId), eq(inv.vendorId, input.recipientVendorId!)),
      });
      if (!invitation) {
        throw new BadRequestException('Recipient vendor is not invited to this RFQ');
      }
      recipientVendorId = input.recipientVendorId;
    }

    const message = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(messages)
        .values({
          organizationId,
          threadType,
          threadId,
          senderType: 'user',
          senderId: userId,
          recipientVendorId,
          authorName: user.name,
          body: trimmedBody,
          attachments: input.attachments ?? [],
        })
        .returning();
      await tx.insert(auditLog).values({
        organizationId,
        userId,
        entityType: 'message',
        entityId: created.id,
        action: 'created',
        changes: { threadType, threadId },
      });
      return created;
    });

    // Email the addressed vendor on addressed RFQ messages; broadcast RFQ
    // messages go to every invited vendor. Other threads have a single
    // supplier counterpart resolved inside.
    if (threadType === 'rfq' && recipientVendorId === null) {
      const invitations = await this.db.query.rfqInvitations.findMany({
        where: (inv, { eq }) => eq(inv.rfqId, threadId),
      });
      const invitedVendorIds = new Set(invitations.map((inv) => inv.vendorId));
      if (threadContext.vendorId) {
        invitedVendorIds.add(threadContext.vendorId);
      }
      for (const vendorIdToNotify of invitedVendorIds) {
        await this.emailVendorContact(
          organizationId,
          threadType,
          threadId,
          user.name,
          message.body,
          vendorIdToNotify,
        );
      }
    } else {
      await this.emailVendorContact(
        organizationId,
        threadType,
        threadId,
        user.name,
        message.body,
        recipientVendorId ?? undefined,
      );
    }
    return message;
  }

  /**
   * Post a message as a vendor via portal token. The thread must belong to the
   * vendor (POs/invoices directly, GRNs through their PO, RFQs when the vendor
   * holds an invitation), so vendors cannot post into arbitrary threads.
   */
  async postAsVendor(
    organizationId: string,
    vendorId: string,
    threadType: ThreadType,
    threadId: string,
    input: PostMessageInput,
  ) {
    const trimmedBody = input.body?.trim();
    if (!trimmedBody) throw new BadRequestException('Message body is required');
    const context = await this.getThreadContext(organizationId, threadType, threadId);
    if (!context) throw new NotFoundException('Thread not found');
    await this.assertVendorAccess(organizationId, vendorId, threadType, threadId, context);

    const vendor = await this.db.query.vendors.findFirst({
      where: (v, { and, eq }) => and(eq(v.id, vendorId), eq(v.organizationId, organizationId)),
    });
    if (!vendor) throw new NotFoundException(`Vendor ${vendorId} not found`);

    const message = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(messages)
        .values({
          organizationId,
          threadType,
          threadId,
          senderType: 'vendor',
          vendorId,
          authorName: vendor.name,
          body: trimmedBody,
          attachments: input.attachments ?? [],
        })
        .returning();
      await tx.insert(auditLog).values({
        organizationId,
        userId: null,
        entityType: 'message',
        entityId: created.id,
        action: 'created',
        changes: { threadType, threadId, senderType: 'vendor', vendorId },
      });
      return created;
    });

    if (context.internalUserId) {
      this.notificationsService
        .create(
          organizationId,
          context.internalUserId,
          'new_message',
          `New message from ${vendor.name}`,
          message.body.length > 140 ? `${message.body.slice(0, 140)}...` : message.body,
          threadType,
          threadId,
        )
        .catch((error) =>
          this.logger.warn(
            `Notification failed for message ${message.id}: ${error instanceof Error ? error.message : error}`,
          ),
        );
    }
    return message;
  }

  private async assertThreadExists(
    organizationId: string,
    threadType: ThreadType,
    threadId: string,
  ) {
    const context = await this.getThreadContext(organizationId, threadType, threadId);
    if (!context) throw new NotFoundException(`Thread ${threadType}/${threadId} not found`);
  }

  /** Resolve the supplier counterpart and the internal owner to notify, proving the thread exists in this org. */
  private async getThreadContext(
    organizationId: string,
    threadType: ThreadType,
    threadId: string,
  ): Promise<ThreadContext | null> {
    switch (threadType) {
      case 'po': {
        const po = await this.db.query.purchaseOrders.findFirst({
          where: (p, { and, eq }) => and(eq(p.id, threadId), eq(p.organizationId, organizationId)),
        });
        return po ? { vendorId: po.vendorId, internalUserId: po.issuedBy } : null;
      }
      case 'invoice': {
        const invoice = await this.db.query.invoices.findFirst({
          where: (i, { and, eq }) => and(eq(i.id, threadId), eq(i.organizationId, organizationId)),
        });
        return invoice ? { vendorId: invoice.vendorId, internalUserId: invoice.approvedBy } : null;
      }
      case 'rfq': {
        const rfq = await this.db.query.rfqRequests.findFirst({
          where: (r, { and, eq }) => and(eq(r.id, threadId), eq(r.organizationId, organizationId)),
        });
        return rfq ? { vendorId: rfq.awardedVendorId, internalUserId: rfq.requesterId } : null;
      }
      case 'grn': {
        const grn = await this.db.query.goodsReceipts.findFirst({
          where: (g, { and, eq }) => and(eq(g.id, threadId), eq(g.organizationId, organizationId)),
        });
        if (!grn) return null;
        const po = await this.db.query.purchaseOrders.findFirst({
          where: (p, { eq }) => eq(p.id, grn.purchaseOrderId),
        });
        return po ? { vendorId: po.vendorId, internalUserId: grn.receivedBy } : null;
      }
      default:
        return null;
    }
  }

  private async assertVendorAccess(
    organizationId: string,
    vendorId: string,
    threadType: ThreadType,
    threadId: string,
    context: ThreadContext,
  ) {
    let allowed = false;
    if (threadType === 'rfq') {
      // Any vendor invited to quote may participate in the RFQ thread.
      const invitation = await this.db.query.rfqInvitations.findFirst({
        where: (inv, { and, eq }) => and(eq(inv.rfqId, threadId), eq(inv.vendorId, vendorId)),
      });
      allowed = !!invitation || context.vendorId === vendorId;
    } else {
      allowed = context.vendorId === vendorId;
    }
    if (!allowed) {
      throw new ForbiddenException('This conversation does not belong to your vendor account');
    }
  }

  /** Best-effort email to the supplier contact so replies do not require portal polling. */
  private async emailVendorContact(
    organizationId: string,
    threadType: ThreadType,
    threadId: string,
    authorName: string,
    messageBody: string,
    recipientVendorOverride?: string,
  ) {
    try {
      const context = await this.getThreadContext(organizationId, threadType, threadId);
      const vendorIdForThread = recipientVendorOverride ?? context?.vendorId ?? null;
      if (!vendorIdForThread) return;

      const vendor = await this.db.query.vendors.findFirst({
        where: (v, { eq }) => eq(v.id, vendorIdForThread),
      });
      const contactInfo = vendor?.contactInfo as Record<string, unknown> | null | undefined;
      const email =
        typeof contactInfo?.['email'] === 'string' && contactInfo['email'].includes('@')
          ? contactInfo['email']
          : undefined;
      if (!vendor || !email) return;

      const settings = await this.settingsService.getAll(organizationId);
      const smtpHost = settings['smtp_host'] || '';
      if (!smtpHost) return;
      const appName = escapeHtml(settings['app_name'] || 'BetterSpend');
      const escapedAuthor = escapeHtml(authorName);
      const escapedVendorName = escapeHtml(vendor.name);
      const escapedBody = escapeHtml(messageBody);

      await this.mailService.sendMail(
        {
          host: smtpHost,
          port: parseInt(settings['smtp_port'] || '587', 10),
          secure: settings['smtp_secure'] === 'true',
          user: settings['smtp_user'] || '',
          pass: settings['smtp_pass'] || '',
          from: settings['smtp_from'] || `noreply@${smtpHost}`,
        },
        {
          to: email,
          subject: `[${appName}] New message on your ${threadType.toUpperCase()}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
              <h2 style="color:#0f172a">New Message</h2>
              <p>Dear ${escapedVendorName},</p>
              <p>${escapedAuthor} sent you a message on your ${threadType.toUpperCase()} record:</p>
              <blockquote style="border-left:3px solid #e2e8f0;margin:16px 0;padding:4px 16px;color:#334155">${escapedBody}</blockquote>
              <p>Log in to the vendor portal to read the full thread and reply.</p>
              <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
              <p style="color:#94a3b8;font-size:12px">This is an automated notification from ${appName}.</p>
            </div>
          `,
          text: `New message from ${authorName}: ${messageBody}\n\nLog in to the vendor portal to read the full thread and reply.`,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to email vendor contact for ${threadType}/${threadId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
