import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
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
import {
  ArtifactIdempotencyService,
  type ArtifactReference,
} from '../artifact-idempotency/artifact-idempotency.service';

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

type MessageTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
    private readonly settingsService: SettingsService,
    private readonly artifactIdempotency: ArtifactIdempotencyService,
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

    const fingerprint = messageFingerprint({
      senderType: 'user',
      senderId: userId,
      threadType,
      threadId,
      body: trimmedBody,
      attachments: input.attachments ?? [],
      recipientVendorId,
    });
    const operationKey = messageOperationKey('user', input.idempotencyKey, fingerprint);
    const execution = await this.artifactIdempotency.execute({
      organizationId,
      operationType: 'message_post',
      idempotencyKey: operationKey,
      fingerprint,
      findExisting: (ownerIdempotencyKey) =>
        this.findMessageArtifact(organizationId, ownerIdempotencyKey),
      create: (ownerIdempotencyKey) =>
        this.createUserMessage({
          organizationId,
          userId,
          threadType,
          threadId,
          recipientVendorId,
          authorName: user.name,
          body: trimmedBody,
          attachments: input.attachments ?? [],
          ownerIdempotencyKey,
        }),
      link: (artifact) => this.loadMessage(organizationId, artifact),
      notify: async (message, delivery) => {
        if (threadType === 'rfq' && recipientVendorId === null) {
          const invitations = await this.db.query.rfqInvitations.findMany({
            where: (inv, { eq }) => eq(inv.rfqId, threadId),
          });
          const invitedVendorIds = new Set(invitations.map((inv) => inv.vendorId));
          if (threadContext.vendorId) {
            invitedVendorIds.add(threadContext.vendorId);
          }
          for (const vendorIdToNotify of invitedVendorIds) {
            await delivery.once(`vendor-email:${vendorIdToNotify}`, (identity) =>
              this.emailVendorContact(
                organizationId,
                threadType,
                threadId,
                user.name,
                message.body,
                vendorIdToNotify,
                true,
                identity,
              ),
            );
          }
          return;
        }
        const vendorDeliveryKey = recipientVendorId ?? threadContext.vendorId ?? 'counterparty';
        await delivery.once(`vendor-email:${vendorDeliveryKey}`, (identity) =>
          this.emailVendorContact(
            organizationId,
            threadType,
            threadId,
            user.name,
            message.body,
            recipientVendorId ?? undefined,
            true,
            identity,
          ),
        );
      },
      load: (artifact) => this.loadMessage(organizationId, artifact),
    });
    const message = execution.value;
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

    const fingerprint = messageFingerprint({
      senderType: 'vendor',
      senderId: vendorId,
      threadType,
      threadId,
      body: trimmedBody,
      attachments: input.attachments ?? [],
    });
    const operationKey = messageOperationKey('vendor', input.idempotencyKey, fingerprint);
    const execution = await this.artifactIdempotency.execute({
      organizationId,
      operationType: 'message_post',
      idempotencyKey: operationKey,
      fingerprint,
      findExisting: (ownerIdempotencyKey) =>
        this.findMessageArtifact(organizationId, ownerIdempotencyKey),
      create: (ownerIdempotencyKey) =>
        this.createVendorMessage({
          organizationId,
          vendorId,
          threadType,
          threadId,
          authorName: vendor.name,
          body: trimmedBody,
          attachments: input.attachments ?? [],
          ownerIdempotencyKey,
        }),
      link: (artifact) => this.loadMessage(organizationId, artifact),
      notify: async (message, delivery) => {
        if (!context.internalUserId) return;
        await delivery.once(`internal-notification:${context.internalUserId}`, (identity) =>
          this.notificationsService.createIdempotent(
            identity,
            organizationId,
            context.internalUserId!,
            'new_message',
            `New message from ${vendor.name}`,
            message.body.length > 140 ? `${message.body.slice(0, 140)}...` : message.body,
            threadType,
            threadId,
          ),
        );
      },
      load: (artifact) => this.loadMessage(organizationId, artifact),
    });
    return execution.value;
  }

  private async findMessageArtifact(
    organizationId: string,
    ownerIdempotencyKey: string,
  ): Promise<ArtifactReference | null> {
    const [message] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.idempotencyKey, ownerIdempotencyKey),
        ),
      )
      .limit(1);
    return message ? { kind: 'message', id: message.id } : null;
  }

  private async loadMessage(organizationId: string, artifact: ArtifactReference) {
    if (artifact.kind !== 'message')
      throw new Error('Message operation references a non-message artifact');
    const [message] = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.organizationId, organizationId), eq(messages.id, artifact.id)))
      .limit(1);
    if (!message) throw new NotFoundException(`Message ${artifact.id} not found`);
    return message;
  }

  private async createUserMessage(input: {
    organizationId: string;
    userId: string;
    threadType: ThreadType;
    threadId: string;
    recipientVendorId: string | null;
    authorName: string;
    body: string;
    attachments: PostMessageInput['attachments'];
    ownerIdempotencyKey: string;
  }): Promise<ArtifactReference> {
    const message = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(messages)
        .values({
          organizationId: input.organizationId,
          threadType: input.threadType,
          threadId: input.threadId,
          senderType: 'user',
          senderId: input.userId,
          recipientVendorId: input.recipientVendorId,
          authorName: input.authorName,
          body: input.body,
          attachments: input.attachments ?? [],
          idempotencyKey: input.ownerIdempotencyKey,
        })
        .onConflictDoNothing()
        .returning();
      if (created) {
        await tx.insert(auditLog).values({
          organizationId: input.organizationId,
          userId: input.userId,
          entityType: 'message',
          entityId: created.id,
          action: 'created',
          changes: { threadType: input.threadType, threadId: input.threadId },
        });
        return created;
      }
      const [existing] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.organizationId, input.organizationId),
            eq(messages.idempotencyKey, input.ownerIdempotencyKey),
          ),
        )
        .limit(1);
      if (!existing) throw new Error('Idempotent user message was not found after insert conflict');
      return this.loadMessageInTransaction(tx, input.organizationId, existing.id);
    });
    return { kind: 'message', id: message.id };
  }

  private async createVendorMessage(input: {
    organizationId: string;
    vendorId: string;
    threadType: ThreadType;
    threadId: string;
    authorName: string;
    body: string;
    attachments: PostMessageInput['attachments'];
    ownerIdempotencyKey: string;
  }): Promise<ArtifactReference> {
    const message = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(messages)
        .values({
          organizationId: input.organizationId,
          threadType: input.threadType,
          threadId: input.threadId,
          senderType: 'vendor',
          vendorId: input.vendorId,
          authorName: input.authorName,
          body: input.body,
          attachments: input.attachments ?? [],
          idempotencyKey: input.ownerIdempotencyKey,
        })
        .onConflictDoNothing()
        .returning();
      if (created) {
        await tx.insert(auditLog).values({
          organizationId: input.organizationId,
          userId: null,
          entityType: 'message',
          entityId: created.id,
          action: 'created',
          changes: {
            threadType: input.threadType,
            threadId: input.threadId,
            senderType: 'vendor',
            vendorId: input.vendorId,
          },
        });
        return created;
      }
      const [existing] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.organizationId, input.organizationId),
            eq(messages.idempotencyKey, input.ownerIdempotencyKey),
          ),
        )
        .limit(1);
      if (!existing)
        throw new Error('Idempotent vendor message was not found after insert conflict');
      return this.loadMessageInTransaction(tx, input.organizationId, existing.id);
    });
    return { kind: 'message', id: message.id };
  }

  private async loadMessageInTransaction(
    tx: MessageTransaction,
    organizationId: string,
    id: string,
  ) {
    const [message] = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.organizationId, organizationId), eq(messages.id, id)))
      .limit(1);
    if (!message) throw new NotFoundException(`Message ${id} not found`);
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
    propagateErrors = false,
    messageId?: string,
  ) {
    try {
      const context = await this.getThreadContext(organizationId, threadType, threadId);
      const vendorIdForThread = recipientVendorOverride ?? context?.vendorId ?? null;
      if (!vendorIdForThread) return;

      const vendor = await this.db.query.vendors.findFirst({
        where: (v, { and, eq }) =>
          and(eq(v.id, vendorIdForThread), eq(v.organizationId, organizationId)),
      });
      const email = extractContactEmail(vendor?.contactInfo);
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
          messageId,
        },
      );
    } catch (error) {
      if (propagateErrors) throw error;
      this.logger.warn(
        `Failed to email vendor contact for ${threadType}/${threadId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

function extractContactEmail(contactInfo: unknown): string | undefined {
  if (!contactInfo || typeof contactInfo !== 'object') return undefined;
  const email = (contactInfo as Record<string, unknown>)['email'];
  if (typeof email !== 'string' || /[,;\r\n]/.test(email)) return undefined;
  const parsed = z.string().trim().email().safeParse(email);
  return parsed.success ? parsed.data : undefined;
}

export function messageOperationKey(
  senderType: 'user' | 'vendor',
  key: string | undefined,
  fingerprint: string,
): string {
  const namespace = `message:${senderType}:`;
  const supplied = key?.trim();
  if (!supplied) return `${namespace}derived:${fingerprint}`;
  const maxSuppliedLength = 255 - namespace.length;
  const bounded =
    supplied.length <= maxSuppliedLength
      ? supplied
      : createHash('sha256').update(supplied).digest('hex');
  return `${namespace}${bounded}`;
}

function messageFingerprint(input: {
  senderType: 'user' | 'vendor';
  senderId: string;
  threadType: ThreadType;
  threadId: string;
  body: string;
  attachments: PostMessageInput['attachments'];
  recipientVendorId?: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        senderType: input.senderType,
        senderId: input.senderId,
        threadType: input.threadType,
        threadId: input.threadId,
        body: input.body,
        attachments: input.attachments ?? [],
        recipientVendorId: input.recipientVendorId ?? null,
      }),
    )
    .digest('hex');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
