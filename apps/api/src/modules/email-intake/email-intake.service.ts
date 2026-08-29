import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { simpleParser } from 'mailparser';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  appendAuditLog,
  appendAuditLogIfAbsent,
  emailIntakeAddresses,
  emailIntakeAttachments,
  emailIntakeItems,
  emailIntakeMessages,
  userRoles,
  users,
} from '@betterspend/db';
import type { Db } from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { MailService, type SmtpConfig } from '../../common/mail/mail.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  assessSenderRisk,
  allowsAttachmentPromotion,
  allowsAutomaticReply,
  classifySender,
  decideAttachment,
  emailDomain,
  extractInvoiceNumberHint,
  normalizeInvoiceNumber,
  normalizeSesReceipt,
  type AttachmentDecision,
  type NormalizedSesReceipt,
} from './email-intake.policy';

export interface CreateEmailIntakeInput {
  sourceEmail: string;
  subject: string;
  body: string;
}

export interface EmailIntakeJobData {
  receipt: NormalizedSesReceipt;
  signature: string;
}

interface PreparedAttachment {
  id: string;
  content: Buffer;
  decision: Exclude<AttachmentDecision, { status: 'ignored' }>;
  invoiceNumberHint: string | null;
}

interface StoredAttachmentOutcome {
  id: string;
  filename: string;
  contentType: string;
  contentHash: string;
  sizeBytes: number;
  status: 'pending' | 'accepted' | 'duplicate' | 'rejected';
  rejectionReason: string | null;
  storageKey: string | null;
  intakeItemId: string | null;
  invoiceNumberHint: string | null;
}

interface PendingPromotionContext {
  organizationId: string;
  messageId: string;
  sourceEmail: string;
  subject: string;
  body: string;
  vendorName: string | null;
  riskScore: number;
  riskSignals: string[];
  outcomes: StoredAttachmentOutcome[];
  attachments: PreparedAttachment[];
}

type MessageStatus = 'accepted' | 'partial' | 'rejected' | 'duplicate';

const RAW_RETENTION_RULE_ID = 'betterspend-email-intake-raw-retention';
const RAW_RETENTION_DAYS = 90;

@Injectable()
export class EmailIntakeService implements OnModuleInit {
  private readonly logger = new Logger(EmailIntakeService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @InjectQueue('email-intake') private readonly intakeQueue: Queue<EmailIntakeJobData>,
    private readonly storage: StorageService,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
  ) {}

  async onModuleInit(): Promise<void> {
    const configured = process.env.EMAIL_INTAKE_DOMAIN || process.env.EMAIL_INTAKE_WEBHOOK_SECRET;
    if (!configured) return;
    this.intakeDomain();
    this.webhookSecret();
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended('betterspend:email-intake-lifecycle', 0))`,
      );
      await this.storage.ensureExpirationRule(
        RAW_RETENTION_RULE_ID,
        this.rawStoragePrefix(),
        RAW_RETENTION_DAYS,
      );
    });
    this.logger.log(`Raw email retention configured for ${RAW_RETENTION_DAYS} days`);
  }

  async list(organizationId: string) {
    return this.db.query.emailIntakeItems.findMany({
      where: (item, { eq }) => eq(item.organizationId, organizationId),
      orderBy: (item, { desc }) => desc(item.createdAt),
      limit: 100,
    });
  }

  async findOne(id: string, organizationId: string) {
    const item = await this.db.query.emailIntakeItems.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, id), eq(record.organizationId, organizationId)),
    });
    if (!item) throw new NotFoundException(`Email intake item ${id} not found`);
    return item;
  }

  async getInboundAddress(organizationId: string, userId: string): Promise<{ address: string }> {
    const domain = this.intakeDomain();
    let row = await this.db.query.emailIntakeAddresses.findFirst({
      where: (address, { eq }) => eq(address.organizationId, organizationId),
    });
    if (!row) {
      row = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(emailIntakeAddresses)
          .values({ organizationId, token: randomBytes(20).toString('hex') })
          .onConflictDoNothing({ target: emailIntakeAddresses.organizationId })
          .returning();
        if (created) {
          await appendAuditLog(tx, {
            organizationId,
            userId,
            entityType: 'email_intake_address',
            entityId: created.id,
            action: 'created',
          });
          return created;
        }
        return tx.query.emailIntakeAddresses.findFirst({
          where: (address, { eq }) => eq(address.organizationId, organizationId),
        });
      });
    }
    if (!row) {
      row = await this.db.query.emailIntakeAddresses.findFirst({
        where: (address, { eq }) => eq(address.organizationId, organizationId),
      });
    }
    if (!row) throw new ServiceUnavailableException('Could not create an inbound email address');
    return { address: `${row.token}@${domain}` };
  }

  async enqueueSesReceipt(payload: unknown, providedSecret: string | undefined) {
    this.assertWebhookSecret(providedSecret);

    let receipt: NormalizedSesReceipt;
    try {
      receipt = normalizeSesReceipt(payload);
    } catch (error: unknown) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid SES receipt');
    }
    this.assertRawStorageKey(receipt);

    const organizationId = await this.resolveReceiptOrganization(receipt.recipients);
    const jobId = createHash('sha256')
      .update(`${organizationId}:${receipt.messageId}`)
      .digest('hex');

    const [existing, priorJob] = await Promise.all([
      this.db.query.emailIntakeMessages.findFirst({
        where: (message, { and, eq }) =>
          and(
            eq(message.organizationId, organizationId),
            eq(message.sesMessageId, receipt.messageId),
          ),
        columns: { id: true },
      }),
      this.intakeQueue.getJob(jobId),
    ]);
    const priorState = priorJob ? await priorJob.getState() : 'unknown';
    const restartTerminalJob =
      priorJob !== undefined &&
      (priorState === 'failed' || (priorState === 'completed' && !existing));
    if (restartTerminalJob) await priorJob.remove();
    if (existing && !restartTerminalJob) {
      return { accepted: true, duplicate: true, messageId: existing.id };
    }

    await this.intakeQueue.add(
      'process-ses-receipt',
      { receipt, signature: this.jobSignature(receipt) },
      {
        jobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    );
    return { accepted: true, duplicate: existing !== undefined, jobId };
  }

  async processSesReceipt(jobData: EmailIntakeJobData): Promise<void> {
    // Redis is a transport, not an authority. Revalidate and re-resolve the tenant at the sink.
    const receipt = normalizeSesReceipt(jobData.receipt);
    this.assertJobSignature(receipt, jobData.signature);
    this.assertRawStorageKey(receipt);
    const organizationId = await this.resolveReceiptOrganization(receipt.recipients);
    const messageId = this.stableUuid('message', organizationId, receipt.messageId);

    const persisted = await this.db.query.emailIntakeMessages.findFirst({
      where: (message, { and, eq }) =>
        and(
          eq(message.organizationId, organizationId),
          eq(message.sesMessageId, receipt.messageId),
        ),
      columns: {
        rawStorageKey: true,
        sourceEmail: true,
        envelopeSource: true,
        subject: true,
        authVerdicts: true,
      },
    });

    const rawStorageKey = persisted?.rawStorageKey ?? receipt.rawStorageKey;
    const rawMime = await this.storage.getBuffer(rawStorageKey);
    if (rawMime.length === 0) throw new Error(`Raw MIME object ${rawStorageKey} is empty`);
    const parsed = await simpleParser(rawMime, { skipImageLinks: true });
    const sourceEmail = this.postgresText(
      persisted?.sourceEmail || parsed.from?.value[0]?.address?.trim() || receipt.source,
    ).slice(0, 255);
    const subject = this.postgresText(persisted?.subject || parsed.subject || receipt.subject)
      .trim()
      .slice(0, 500);
    const envelopeSource = persisted?.envelopeSource ?? receipt.source;
    const verdicts = persisted?.authVerdicts ?? receipt.verdicts;
    const body = this.messageBody(parsed.text).slice(0, 100_000);
    const allowAutomaticReply = allowsAutomaticReply(
      verdicts,
      parsed.headers.get('auto-submitted'),
    );

    let topLevelIndex = 0;
    const attachments: PreparedAttachment[] = [];
    for (const attachment of parsed.attachments) {
      let decision = await decideAttachment(
        {
          filename: attachment.filename,
          contentType: attachment.contentType,
          contentDisposition: attachment.contentDisposition,
          cid: attachment.cid,
          content: attachment.content,
        },
        topLevelIndex,
      );
      if (decision.status === 'ignored') continue;
      if (decision.status === 'accepted' && !allowsAttachmentPromotion(verdicts)) {
        decision = {
          status: 'rejected',
          reason: 'virus_scan_not_passed',
          filename: decision.filename,
          contentType: decision.contentType,
        };
      }
      const attachmentIndex = topLevelIndex;
      topLevelIndex += 1;
      attachments.push({
        id: this.stableUuid('attachment', messageId, String(attachmentIndex)),
        content: decision.status === 'accepted' ? decision.content : attachment.content,
        decision,
        invoiceNumberHint: extractInvoiceNumberHint(subject, body, attachment.filename),
      });
    }

    const { classification, vendorId, vendorName } = await this.resolveAuthenticatedSender(
      organizationId,
      envelopeSource,
      verdicts,
    );
    const existingInvoiceNumbers = vendorId
      ? await this.db.query.invoices.findMany({
          where: (invoice, { and, eq }) =>
            and(eq(invoice.organizationId, organizationId), eq(invoice.vendorId, vendorId)),
          columns: { invoiceNumber: true },
        })
      : [];
    const normalizedInvoiceNumbers = new Set(
      existingInvoiceNumbers.map((invoice) => normalizeInvoiceNumber(invoice.invoiceNumber)),
    );
    const fuzzyDuplicate = attachments.some(
      (attachment) =>
        attachment.invoiceNumberHint !== null &&
        normalizedInvoiceNumbers.has(normalizeInvoiceNumber(attachment.invoiceNumberHint)),
    );
    const initialRisk = assessSenderRisk(classification, verdicts, fuzzyDuplicate);
    if (verdicts.virus !== 'PASS') {
      initialRisk.signals.push(`attachments:virus_${verdicts.virus.toLowerCase()}`);
    }
    if (attachments.length === 0) initialRisk.signals.push('attachments:none');

    const result = await this.db.transaction(async (tx) => {
      // Serializing by organization closes the exact-hash dedupe race without a global lock.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`);

      const repeated = await tx.query.emailIntakeMessages.findFirst({
        where: (message, { and, eq }) =>
          and(
            eq(message.organizationId, organizationId),
            eq(message.sesMessageId, receipt.messageId),
          ),
        columns: { id: true, status: true, riskScore: true, riskSignals: true },
      });
      if (repeated) {
        const existingOutcomes = await tx.query.emailIntakeAttachments.findMany({
          where: (attachment, { and, eq }) =>
            and(
              eq(attachment.organizationId, organizationId),
              eq(attachment.messageId, repeated.id),
            ),
        });
        return {
          repeated: true as const,
          outcomes: existingOutcomes.map((attachment) => ({
            id: attachment.id,
            filename: attachment.filename,
            contentType: attachment.contentType,
            contentHash: attachment.contentHash,
            sizeBytes: attachment.sizeBytes,
            status: this.attachmentStatus(attachment.status),
            rejectionReason: attachment.rejectionReason,
            storageKey: attachment.storageKey,
            intakeItemId: attachment.emailIntakeItemId,
            invoiceNumberHint: attachment.invoiceNumberHint,
          })),
          status: this.messageStatus(repeated.status),
          riskScore: repeated.riskScore,
          riskSignals: repeated.riskSignals,
        };
      }

      const acceptableHashes = attachments.flatMap((attachment) =>
        attachment.decision.status === 'accepted' ? [attachment.decision.contentHash] : [],
      );
      const priorHashes =
        acceptableHashes.length > 0
          ? await tx.query.emailIntakeAttachments.findMany({
              where: (attachment, { and, eq, inArray }) =>
                and(
                  eq(attachment.organizationId, organizationId),
                  eq(attachment.status, 'accepted'),
                  inArray(attachment.contentHash, acceptableHashes),
                ),
              columns: { contentHash: true },
            })
          : [];
      const seenHashes = new Set(priorHashes.map((attachment) => attachment.contentHash));

      const storedOutcomes: StoredAttachmentOutcome[] = [];
      for (const attachment of attachments) {
        const hash =
          attachment.decision.status === 'accepted'
            ? attachment.decision.contentHash
            : createHash('sha256').update(attachment.content).digest('hex');
        if (attachment.decision.status === 'rejected') {
          storedOutcomes.push({
            id: attachment.id,
            filename: attachment.decision.filename,
            contentType: attachment.decision.contentType,
            contentHash: hash,
            sizeBytes: attachment.content.length,
            status: 'rejected',
            rejectionReason: attachment.decision.reason,
            storageKey: null,
            intakeItemId: null,
            invoiceNumberHint: attachment.invoiceNumberHint,
          });
          continue;
        }
        if (seenHashes.has(hash)) {
          storedOutcomes.push({
            id: attachment.id,
            filename: attachment.decision.filename,
            contentType: attachment.decision.contentType,
            contentHash: hash,
            sizeBytes: attachment.content.length,
            status: 'duplicate',
            rejectionReason: 'duplicate_file_hash',
            storageKey: null,
            intakeItemId: null,
            invoiceNumberHint: attachment.invoiceNumberHint,
          });
          continue;
        }

        const storageKey = `email-intake/attachments/${organizationId}/${messageId}/${attachment.id}`;
        seenHashes.add(hash);
        storedOutcomes.push({
          id: attachment.id,
          filename: attachment.decision.filename,
          contentType: attachment.decision.contentType,
          contentHash: hash,
          sizeBytes: attachment.content.length,
          status: 'pending',
          rejectionReason: null,
          storageKey,
          intakeItemId: null,
          invoiceNumberHint: attachment.invoiceNumberHint,
        });
      }

      const promotableCount = storedOutcomes.filter(
        (attachment) => attachment.status === 'pending',
      ).length;
      const duplicateCount = storedOutcomes.filter(
        (attachment) => attachment.status === 'duplicate',
      ).length;
      const rejectedCount = storedOutcomes.filter(
        (attachment) => attachment.status === 'rejected',
      ).length;
      // The append-only message stores the receipt-time decision. The final promotion outcome is
      // recorded as an append-only audit event after every pending attachment reaches a terminal state.
      const status = this.summarizeMessageStatus(storedOutcomes, true);
      const riskSignals = [...initialRisk.signals];
      if (duplicateCount > 0) riskSignals.push('duplicate:file_hash');

      await tx.insert(emailIntakeMessages).values({
        id: messageId,
        organizationId,
        sesMessageId: receipt.messageId,
        rawStorageKey: receipt.rawStorageKey,
        sourceEmail,
        envelopeSource: receipt.source,
        recipients: receipt.recipients,
        subject,
        receivedAt: new Date(receipt.receivedAt),
        authVerdicts: verdicts,
        senderClassification: classification,
        vendorId,
        riskScore: initialRisk.score,
        riskSignals,
        status,
      });

      if (storedOutcomes.length > 0) {
        await tx.insert(emailIntakeAttachments).values(
          storedOutcomes.map((attachment) => ({
            id: attachment.id,
            organizationId,
            messageId,
            emailIntakeItemId: attachment.intakeItemId,
            filename: attachment.filename,
            contentType: attachment.contentType,
            sizeBytes: attachment.sizeBytes,
            contentHash: attachment.contentHash,
            storageKey: attachment.storageKey,
            status: attachment.status,
            rejectionReason: attachment.rejectionReason,
            invoiceNumberHint: attachment.invoiceNumberHint,
          })),
        );
      }

      await appendAuditLog(tx, {
        organizationId,
        userId: null,
        entityType: 'email_intake_message',
        entityId: messageId,
        action: 'received',
        metadata: {
          sesMessageId: receipt.messageId,
          status,
          acceptedAttachments: promotableCount,
          duplicateAttachments: duplicateCount,
          rejectedAttachments: rejectedCount,
          riskScore: initialRisk.score,
          riskSignals,
        },
      });

      return {
        repeated: false as const,
        outcomes: storedOutcomes,
        status,
        riskScore: initialRisk.score,
        riskSignals,
      };
    });

    const promoted = await this.promotePendingAttachments({
      organizationId,
      messageId,
      sourceEmail,
      subject,
      body,
      vendorName,
      riskScore: result.riskScore,
      riskSignals: result.riskSignals,
      outcomes: result.outcomes,
      attachments,
    });

    await this.notifyReviewItems(
      organizationId,
      sourceEmail,
      subject,
      result.riskScore,
      promoted.outcomes,
    );
    if (allowAutomaticReply) {
      await this.replyToRejectedAttachments(sourceEmail, subject, promoted.outcomes);
    }
  }

  async create(organizationId: string, input: CreateEmailIntakeInput) {
    const body = this.messageBody(input.body);
    const subject = this.postgresText(input.subject).trim();
    const detected = this.detectIntakeType(subject, body);

    const [created] = await this.db
      .insert(emailIntakeItems)
      .values({
        organizationId,
        sourceEmail: this.postgresText(input.sourceEmail).trim(),
        subject,
        body,
        detectedType: detected.detectedType,
        extractedVendorName: detected.vendorName,
        extractedTotal: detected.total,
        extractedCurrency: detected.total ? 'USD' : null,
        rawPayload: {
          source: 'manual_first_pass',
          preview: body.slice(0, 400),
        },
      })
      .returning();

    await this.notifyIntake(
      organizationId,
      created.id,
      created.sourceEmail,
      created.subject,
      'accepted',
      0,
    );
    return created;
  }

  async discard(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    const [updated] = await this.db
      .update(emailIntakeItems)
      .set({ status: 'discarded', updatedAt: new Date() })
      .where(and(eq(emailIntakeItems.id, id), eq(emailIntakeItems.organizationId, organizationId)))
      .returning();
    return updated;
  }

  private async promotePendingAttachments(
    context: PendingPromotionContext,
  ): Promise<{ outcomes: StoredAttachmentOutcome[]; status: MessageStatus }> {
    const pending = context.outcomes.filter(
      (outcome): outcome is StoredAttachmentOutcome & { storageKey: string } =>
        outcome.status === 'pending' && outcome.storageKey !== null,
    );
    if (pending.length === 0) {
      return { outcomes: context.outcomes, status: this.summarizeMessageStatus(context.outcomes) };
    }

    const detected = this.detectIntakeType(context.subject, context.body);
    return this.db.transaction(async (tx) => {
      // Keep duplicate detection, object upload, and promotion in one organization-level critical section.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${context.organizationId}, 0))`,
      );

      for (const outcome of pending) {
        const current = await tx.query.emailIntakeAttachments.findFirst({
          where: (attachment, { and, eq }) =>
            and(
              eq(attachment.organizationId, context.organizationId),
              eq(attachment.id, outcome.id),
            ),
          columns: { status: true, contentHash: true, storageKey: true },
        });
        if (!current || current.status !== 'pending') continue;
        if (
          current.contentHash !== outcome.contentHash ||
          current.storageKey !== outcome.storageKey
        ) {
          throw new Error(`Pending attachment ${outcome.id} no longer matches its durable intent`);
        }

        const duplicate = await tx.query.emailIntakeAttachments.findFirst({
          where: (attachment, { and, eq }) =>
            and(
              eq(attachment.organizationId, context.organizationId),
              eq(attachment.status, 'accepted'),
              eq(attachment.contentHash, current.contentHash),
            ),
          columns: { id: true },
        });
        if (duplicate) {
          if (await this.storage.exists(current.storageKey)) {
            await this.storage.delete(current.storageKey);
          }
          const [updated] = await tx
            .update(emailIntakeAttachments)
            .set({
              status: 'duplicate',
              rejectionReason: 'duplicate_file_hash',
              storageKey: null,
              emailIntakeItemId: null,
            })
            .where(
              and(
                eq(emailIntakeAttachments.organizationId, context.organizationId),
                eq(emailIntakeAttachments.id, outcome.id),
                eq(emailIntakeAttachments.status, 'pending'),
              ),
            )
            .returning({ id: emailIntakeAttachments.id });
          if (updated) {
            await appendAuditLogIfAbsent(tx, {
              id: this.stableUuid('audit', 'attachment-deduplicated', outcome.id),
              organizationId: context.organizationId,
              userId: null,
              entityType: 'email_intake_attachment',
              entityId: outcome.id,
              action: 'deduplicated',
              metadata: {
                messageId: context.messageId,
                fromStatus: 'pending',
                toStatus: 'duplicate',
                rejectionReason: 'duplicate_file_hash',
              },
            });
          }
          continue;
        }

        const prepared = context.attachments.find((attachment) => attachment.id === outcome.id);
        if (!prepared || prepared.decision.status !== 'accepted') {
          throw new Error(`Raw MIME no longer contains pending attachment ${outcome.id}`);
        }
        if (prepared.decision.contentHash !== current.contentHash) {
          throw new Error(`Raw MIME attachment ${outcome.id} no longer matches its committed hash`);
        }
        if (!(await this.storage.exists(current.storageKey))) {
          await this.storage.upload(
            current.storageKey,
            prepared.content,
            prepared.decision.contentType,
          );
        }

        const intakeItemId = this.stableUuid('item', outcome.id);
        await tx
          .insert(emailIntakeItems)
          .values({
            id: intakeItemId,
            organizationId: context.organizationId,
            sourceEmail: context.sourceEmail,
            subject: context.subject,
            body: context.body,
            detectedType: detected.detectedType,
            extractedVendorName: context.vendorName ?? detected.vendorName,
            extractedTotal: detected.total,
            extractedCurrency: detected.total ? 'USD' : null,
            rawPayload: {
              source: 'ses',
              emailIntakeMessageId: context.messageId,
              attachmentId: outcome.id,
              filename: outcome.filename,
              contentHash: outcome.contentHash,
              storageKey: current.storageKey,
              invoiceNumberHint: outcome.invoiceNumberHint,
              riskScore: context.riskScore,
              riskSignals: context.riskSignals,
            },
          })
          .onConflictDoNothing({ target: emailIntakeItems.id });
        const [updated] = await tx
          .update(emailIntakeAttachments)
          .set({ status: 'accepted', emailIntakeItemId: intakeItemId })
          .where(
            and(
              eq(emailIntakeAttachments.organizationId, context.organizationId),
              eq(emailIntakeAttachments.id, outcome.id),
              eq(emailIntakeAttachments.status, 'pending'),
            ),
          )
          .returning({ id: emailIntakeAttachments.id });
        if (updated) {
          await appendAuditLogIfAbsent(tx, {
            id: this.stableUuid('audit', 'attachment-promoted', outcome.id),
            organizationId: context.organizationId,
            userId: null,
            entityType: 'email_intake_attachment',
            entityId: outcome.id,
            action: 'promoted',
            metadata: {
              messageId: context.messageId,
              fromStatus: 'pending',
              toStatus: 'accepted',
              intakeItemId,
              storageKey: current.storageKey,
            },
          });
        }
      }

      const finalAttachments = await tx.query.emailIntakeAttachments.findMany({
        where: (attachment, { and, eq }) =>
          and(
            eq(attachment.organizationId, context.organizationId),
            eq(attachment.messageId, context.messageId),
          ),
      });
      const outcomes = finalAttachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        contentHash: attachment.contentHash,
        sizeBytes: attachment.sizeBytes,
        status: this.attachmentStatus(attachment.status),
        rejectionReason: attachment.rejectionReason,
        storageKey: attachment.storageKey,
        intakeItemId: attachment.emailIntakeItemId,
        invoiceNumberHint: attachment.invoiceNumberHint,
      }));
      const status = this.summarizeMessageStatus(outcomes);
      await appendAuditLogIfAbsent(tx, {
        id: this.stableUuid('audit', 'processing-completed', context.messageId),
        organizationId: context.organizationId,
        userId: null,
        entityType: 'email_intake_message',
        entityId: context.messageId,
        action: 'processing_completed',
        metadata: {
          status,
          acceptedAttachments: outcomes.filter((outcome) => outcome.status === 'accepted').length,
          duplicateAttachments: outcomes.filter((outcome) => outcome.status === 'duplicate').length,
          rejectedAttachments: outcomes.filter((outcome) => outcome.status === 'rejected').length,
        },
      });
      return { outcomes, status };
    });
  }

  private summarizeMessageStatus(
    outcomes: StoredAttachmentOutcome[],
    pendingAsAccepted = false,
  ): MessageStatus {
    if (!pendingAsAccepted && outcomes.some((outcome) => outcome.status === 'pending')) {
      throw new Error('Email intake processing is incomplete');
    }
    const acceptedCount = outcomes.filter(
      (outcome) =>
        outcome.status === 'accepted' || (pendingAsAccepted && outcome.status === 'pending'),
    ).length;
    const duplicateCount = outcomes.filter((outcome) => outcome.status === 'duplicate').length;
    const rejectedCount = outcomes.filter((outcome) => outcome.status === 'rejected').length;
    if (acceptedCount > 0 && (duplicateCount > 0 || rejectedCount > 0)) return 'partial';
    if (acceptedCount > 0) return 'accepted';
    if (duplicateCount > 0 && rejectedCount === 0) return 'duplicate';
    return 'rejected';
  }

  private stableUuid(...parts: string[]): string {
    const bytes = createHash('sha256').update(parts.join('\0')).digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private attachmentStatus(value: string): StoredAttachmentOutcome['status'] {
    if (
      value === 'pending' ||
      value === 'accepted' ||
      value === 'duplicate' ||
      value === 'rejected'
    ) {
      return value;
    }
    throw new Error(`Invalid persisted email attachment status: ${value}`);
  }

  private messageStatus(value: string): MessageStatus {
    if (
      value === 'accepted' ||
      value === 'partial' ||
      value === 'rejected' ||
      value === 'duplicate'
    ) {
      return value;
    }
    throw new Error(`Invalid persisted email message status: ${value}`);
  }

  private rawStoragePrefix(): string {
    const value = process.env.EMAIL_INTAKE_RAW_PREFIX?.trim() || 'email-intake/raw/';
    const prefix = value.endsWith('/') ? value : `${value}/`;
    if (prefix.length > 400) {
      throw new ServiceUnavailableException('EMAIL_INTAKE_RAW_PREFIX is too long');
    }
    return prefix;
  }

  private assertRawStorageKey(receipt: NormalizedSesReceipt): void {
    if (receipt.rawStorageKey !== `${this.rawStoragePrefix()}${receipt.messageId}`) {
      throw new BadRequestException('rawStorageKey must match the configured SES message key');
    }
  }

  private jobSignature(receipt: NormalizedSesReceipt): string {
    return createHmac('sha256', this.webhookSecret()).update(JSON.stringify(receipt)).digest('hex');
  }

  private assertJobSignature(receipt: NormalizedSesReceipt, providedSignature: unknown): void {
    if (typeof providedSignature !== 'string' || !/^[a-f0-9]{64}$/.test(providedSignature)) {
      throw new UnauthorizedException('Invalid email intake job signature');
    }
    const expected = Buffer.from(this.jobSignature(receipt), 'hex');
    const provided = Buffer.from(providedSignature, 'hex');
    if (!timingSafeEqual(expected, provided)) {
      throw new UnauthorizedException('Invalid email intake job signature');
    }
  }

  private intakeDomain(): string {
    const domain = process.env.EMAIL_INTAKE_DOMAIN?.trim().toLowerCase();
    if (!domain) throw new ServiceUnavailableException('EMAIL_INTAKE_DOMAIN is not configured');
    if (domain.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain)) {
      throw new ServiceUnavailableException('EMAIL_INTAKE_DOMAIN is invalid');
    }
    return domain;
  }

  private assertWebhookSecret(providedSecret: string | undefined): void {
    const expected = this.webhookSecret();
    if (!providedSecret) throw new UnauthorizedException('Invalid email intake secret');
    const expectedHash = createHash('sha256').update(expected).digest();
    const providedHash = createHash('sha256').update(providedSecret).digest();
    if (!timingSafeEqual(expectedHash, providedHash)) {
      throw new UnauthorizedException('Invalid email intake secret');
    }
  }

  private async resolveReceiptOrganization(recipients: string[]): Promise<string> {
    const domain = this.intakeDomain();
    const tokens = recipients.flatMap((recipient) => {
      const normalized = recipient.trim().toLowerCase();
      const at = normalized.lastIndexOf('@');
      if (at <= 0 || normalized.slice(at + 1) !== domain) return [];
      return [normalized.slice(0, at)];
    });
    if (tokens.length === 0) {
      throw new BadRequestException('Receipt has no BetterSpend intake recipient');
    }

    const addresses = await this.db.query.emailIntakeAddresses.findMany({
      where: (address, { inArray }) => inArray(address.token, [...new Set(tokens)]),
    });
    const organizationIds = [...new Set(addresses.map((address) => address.organizationId))];
    if (organizationIds.length !== 1) {
      throw new BadRequestException('Receipt does not resolve to exactly one organization');
    }
    return organizationIds[0]!;
  }

  private webhookSecret(): string {
    const secret = process.env.EMAIL_INTAKE_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException('EMAIL_INTAKE_WEBHOOK_SECRET is not configured');
    }
    if (secret.length < 32) {
      throw new ServiceUnavailableException(
        'EMAIL_INTAKE_WEBHOOK_SECRET must be at least 32 characters',
      );
    }
    return secret;
  }

  private async resolveSender(organizationId: string, sourceEmail: string) {
    const [vendorRows, employeeRows] = await Promise.all([
      this.db.query.vendors.findMany({
        where: (vendor, { eq }) => eq(vendor.organizationId, organizationId),
        columns: { id: true, name: true, contactInfo: true, createdAt: true },
        orderBy: (vendor, { asc }) => asc(vendor.createdAt),
      }),
      this.db.query.users.findMany({
        where: (user, { and, eq }) =>
          and(eq(user.organizationId, organizationId), eq(user.isActive, true)),
        columns: { email: true },
      }),
    ]);
    const vendorsByDomain = new Map<string, typeof vendorRows>();
    for (const vendor of vendorRows) {
      const contactInfo =
        vendor.contactInfo && typeof vendor.contactInfo === 'object'
          ? (vendor.contactInfo as Record<string, unknown>)
          : {};
      const contactEmail = typeof contactInfo.email === 'string' ? contactInfo.email : '';
      const domain = emailDomain(contactEmail);
      if (!domain) continue;
      vendorsByDomain.set(domain, [...(vendorsByDomain.get(domain) ?? []), vendor]);
    }
    const vendorDomains = new Set(vendorsByDomain.keys());
    const employeeDomains = new Set(
      employeeRows.flatMap((employee) => {
        const domain = emailDomain(employee.email);
        return domain ? [domain] : [];
      }),
    );
    const classification = classifySender(sourceEmail, vendorDomains, employeeDomains);
    const sourceDomain = emailDomain(sourceEmail);
    const matches = sourceDomain ? (vendorsByDomain.get(sourceDomain) ?? []) : [];
    const vendor = matches.length === 1 ? matches[0] : undefined;
    return { classification, vendorId: vendor?.id ?? null, vendorName: vendor?.name ?? null };
  }

  private async resolveAuthenticatedSender(
    organizationId: string,
    sourceEmail: string,
    verdicts: NormalizedSesReceipt['verdicts'],
  ) {
    if (verdicts.spf !== 'PASS') {
      return { classification: 'unknown' as const, vendorId: null, vendorName: null };
    }
    return this.resolveSender(organizationId, sourceEmail);
  }

  private detectIntakeType(subject: string, body: string) {
    const detectedType = /invoice|bill|payment/i.test(`${subject}\n${body}`)
      ? 'invoice'
      : /quote|pricing|buy|purchase|request|need/i.test(`${subject}\n${body}`)
        ? 'requisition'
        : 'triage';
    const totalMatch = body.match(/\$?\s?(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    const vendorMatch = body.match(/from\s+([A-Z][A-Za-z0-9&.\- ]{2,})/i);
    return {
      detectedType,
      vendorName: vendorMatch?.[1]?.trim() ?? null,
      total: totalMatch?.[1]?.replace(/,/g, '') ?? null,
    };
  }

  private messageBody(text: string | undefined): string {
    return this.postgresText(text ?? '').trim();
  }

  private postgresText(value: string): string {
    return value.replaceAll('\0', '');
  }

  private async notifyReviewItems(
    organizationId: string,
    sourceEmail: string,
    subject: string,
    riskScore: number,
    outcomes: StoredAttachmentOutcome[],
  ): Promise<void> {
    for (const outcome of outcomes) {
      if (outcome.status !== 'accepted' || !outcome.intakeItemId) continue;
      await this.notifyIntake(
        organizationId,
        outcome.intakeItemId,
        sourceEmail,
        subject,
        'accepted',
        riskScore,
      );
    }
  }

  private async notifyIntake(
    organizationId: string,
    entityId: string,
    sourceEmail: string,
    subject: string,
    status: string,
    riskScore: number,
  ): Promise<void> {
    try {
      const existing = await this.db.query.notifications.findFirst({
        where: (notification, { and, eq }) =>
          and(
            eq(notification.organizationId, organizationId),
            eq(notification.type, 'email_intake'),
            eq(notification.entityType, 'email_intake'),
            eq(notification.entityId, entityId),
          ),
        columns: { id: true },
      });
      if (existing) return;

      const [recipient] = await this.db
        .select({ id: users.id })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.isActive, true),
            inArray(userRoles.role, ['admin', 'finance']),
          ),
        )
        .orderBy(users.createdAt)
        .limit(1);
      if (recipient) {
        await this.notificationsService.create(
          organizationId,
          recipient.id,
          'email_intake',
          `New email intake ${status}`,
          `${sourceEmail} sent "${subject}" for review (risk ${riskScore}/100).`,
          'email_intake',
          entityId,
        );
      }
    } catch {
      // Notification delivery is secondary to the durable intake record.
    }
  }

  private async replyToRejectedAttachments(
    sourceEmail: string,
    subject: string,
    outcomes: StoredAttachmentOutcome[],
  ): Promise<void> {
    const rejections = outcomes.filter(
      (attachment) =>
        attachment.status === 'rejected' &&
        [
          'archive_not_allowed',
          'encrypted_pdf',
          'invalid_pdf',
          'invalid_image',
          'attachment_too_large',
          'attachment_count_exceeded',
        ].includes(attachment.rejectionReason ?? ''),
    );
    if (rejections.length === 0) return;

    const smtpConfig = this.emailIntakeSmtpConfig();
    if (!smtpConfig) return;
    const lines = rejections.map(
      (attachment) => `${attachment.filename}: ${this.rejectionCopy(attachment.rejectionReason!)}`,
    );
    const sent = await this.mailService.sendMail(smtpConfig, {
      to: sourceEmail,
      subject: `Attachments not accepted: ${subject || 'invoice email'}`,
      text: `BetterSpend could not accept these attachments:\n\n${lines.join('\n')}\n\nPlease resend each invoice as a PDF, PNG, JPG, or WebP file.`,
      html: `<p>BetterSpend could not accept these attachments:</p><ul>${lines
        .map((line) => `<li>${this.escapeHtml(line)}</li>`)
        .join('')}</ul><p>Please resend each invoice as a PDF, PNG, JPG, or WebP file.</p>`,
    });
    if (!sent) throw new Error('Rejected email attachment reply was not delivered');
  }

  private emailIntakeSmtpConfig(): SmtpConfig | null {
    const host = process.env.EMAIL_INTAKE_SMTP_HOST?.trim();
    if (!host) return null;
    const port = Number(process.env.EMAIL_INTAKE_SMTP_PORT || '587');
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new ServiceUnavailableException('EMAIL_INTAKE_SMTP_PORT is invalid');
    }
    return {
      host,
      port,
      secure: process.env.EMAIL_INTAKE_SMTP_SECURE === 'true',
      user: process.env.EMAIL_INTAKE_SMTP_USER || '',
      pass: process.env.EMAIL_INTAKE_SMTP_PASS || '',
      from: process.env.EMAIL_INTAKE_SMTP_FROM || `noreply@${this.intakeDomain()}`,
    };
  }

  private rejectionCopy(reason: string): string {
    if (reason === 'archive_not_allowed') return 'archives are not accepted';
    if (reason === 'encrypted_pdf') return 'password-protected PDFs are not accepted';
    if (reason === 'invalid_pdf') return 'the PDF is malformed or unreadable';
    if (reason === 'invalid_image') return 'the image is malformed or unreadable';
    if (reason === 'attachment_too_large') return 'the file exceeds 25 MB';
    if (reason === 'attachment_count_exceeded') return 'the email exceeds 10 attachments';
    return 'the file was not accepted';
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
