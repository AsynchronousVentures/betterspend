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
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { simpleParser } from 'mailparser';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  auditLog,
  emailIntakeAddresses,
  emailIntakeAttachments,
  emailIntakeItems,
  emailIntakeMessages,
  userRoles,
  users,
} from '@betterspend/db';
import type { Db } from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { MailService } from '../../common/mail/mail.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import {
  assessSenderRisk,
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
  status: 'accepted' | 'duplicate' | 'rejected';
  rejectionReason: string | null;
  storageKey: string | null;
  intakeItemId: string | null;
  invoiceNumberHint: string | null;
}

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
    private readonly settingsService: SettingsService,
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
          await tx.insert(auditLog).values({
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
    if (!receipt.rawStorageKey.startsWith(this.rawStoragePrefix())) {
      throw new BadRequestException('rawStorageKey is outside the configured SES prefix');
    }

    const organizationId = await this.resolveReceiptOrganization(receipt.recipients);

    const existing = await this.db.query.emailIntakeMessages.findFirst({
      where: (message, { and, eq }) =>
        and(
          eq(message.organizationId, organizationId),
          eq(message.sesMessageId, receipt.messageId),
        ),
      columns: { id: true },
    });
    if (existing) return { accepted: true, duplicate: true, messageId: existing.id };

    const jobId = createHash('sha256')
      .update(`${organizationId}:${receipt.messageId}`)
      .digest('hex');
    await this.intakeQueue.add(
      'process-ses-receipt',
      { receipt },
      {
        jobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    );
    return { accepted: true, duplicate: false, jobId };
  }

  async processSesReceipt(jobData: EmailIntakeJobData): Promise<void> {
    // Redis is a transport, not an authority. Revalidate and re-resolve the tenant at the sink.
    const receipt = normalizeSesReceipt(jobData.receipt);
    if (!receipt.rawStorageKey.startsWith(this.rawStoragePrefix())) {
      throw new BadRequestException('rawStorageKey is outside the configured SES prefix');
    }
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
      },
    });

    const rawStorageKey = persisted?.rawStorageKey ?? receipt.rawStorageKey;
    const rawMime = await this.storage.getBuffer(rawStorageKey);
    if (rawMime.length === 0) throw new Error(`Raw MIME object ${rawStorageKey} is empty`);
    const parsed = await simpleParser(rawMime, { skipImageLinks: true });
    const sourceEmail = (
      persisted?.sourceEmail ||
      parsed.from?.value[0]?.address?.trim() ||
      receipt.source
    ).slice(0, 255);
    const subject = (persisted?.subject || parsed.subject || receipt.subject).trim().slice(0, 500);
    const envelopeSource = persisted?.envelopeSource ?? receipt.source;
    const body = this.messageBody(parsed.text).slice(0, 100_000);

    let topLevelIndex = 0;
    const attachments: PreparedAttachment[] = [];
    for (const attachment of parsed.attachments) {
      const decision = decideAttachment(
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
      const attachmentIndex = topLevelIndex;
      topLevelIndex += 1;
      attachments.push({
        id: this.stableUuid('attachment', messageId, String(attachmentIndex)),
        content: attachment.content,
        decision,
        invoiceNumberHint: extractInvoiceNumberHint(subject, body, attachment.filename),
      });
    }

    const { classification, vendorId, vendorName } = await this.resolveSender(
      organizationId,
      envelopeSource,
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
    const initialRisk = assessSenderRisk(classification, receipt.verdicts, fuzzyDuplicate);
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
        columns: { id: true, status: true, riskScore: true },
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

        const intakeItemId = this.stableUuid('item', attachment.id);
        const storageKey = `email-intake/attachments/${organizationId}/${messageId}/${attachment.id}`;
        seenHashes.add(hash);
        storedOutcomes.push({
          id: attachment.id,
          filename: attachment.decision.filename,
          contentType: attachment.decision.contentType,
          contentHash: hash,
          sizeBytes: attachment.content.length,
          status: 'accepted',
          rejectionReason: null,
          storageKey,
          intakeItemId,
          invoiceNumberHint: attachment.invoiceNumberHint,
        });
      }

      const acceptedCount = storedOutcomes.filter(
        (attachment) => attachment.status === 'accepted',
      ).length;
      const duplicateCount = storedOutcomes.filter(
        (attachment) => attachment.status === 'duplicate',
      ).length;
      const rejectedCount = storedOutcomes.filter(
        (attachment) => attachment.status === 'rejected',
      ).length;
      const status: 'accepted' | 'partial' | 'rejected' | 'duplicate' =
        acceptedCount > 0 && (duplicateCount > 0 || rejectedCount > 0)
          ? 'partial'
          : acceptedCount > 0
            ? 'accepted'
            : duplicateCount > 0 && rejectedCount === 0
              ? 'duplicate'
              : 'rejected';
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
        authVerdicts: receipt.verdicts,
        senderClassification: classification,
        vendorId,
        riskScore: initialRisk.score,
        riskSignals,
        status,
      });

      const accepted = storedOutcomes.filter(
        (
          attachment,
        ): attachment is StoredAttachmentOutcome & { intakeItemId: string; storageKey: string } =>
          attachment.status === 'accepted' &&
          attachment.intakeItemId !== null &&
          attachment.storageKey !== null,
      );
      if (accepted.length > 0) {
        const detected = this.detectIntakeType(subject, body);
        await tx.insert(emailIntakeItems).values(
          accepted.map((attachment) => ({
            id: attachment.intakeItemId,
            organizationId,
            sourceEmail,
            subject,
            body,
            detectedType: detected.detectedType,
            extractedVendorName: vendorName ?? detected.vendorName,
            extractedTotal: detected.total,
            extractedCurrency: detected.total ? 'USD' : null,
            rawPayload: {
              source: 'ses',
              emailIntakeMessageId: messageId,
              attachmentId: attachment.id,
              filename: attachment.filename,
              contentHash: attachment.contentHash,
              storageKey: attachment.storageKey,
              invoiceNumberHint: attachment.invoiceNumberHint,
              riskScore: initialRisk.score,
              riskSignals,
            },
          })),
        );
      }

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

      await tx.insert(auditLog).values({
        organizationId,
        userId: null,
        entityType: 'email_intake_message',
        entityId: messageId,
        action: 'received',
        metadata: {
          sesMessageId: receipt.messageId,
          status,
          acceptedAttachments: acceptedCount,
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
      };
    });

    for (const outcome of result.outcomes) {
      if (outcome.status !== 'accepted' || !outcome.storageKey) continue;
      if (await this.storage.exists(outcome.storageKey)) continue;
      const prepared = attachments.find((attachment) => attachment.id === outcome.id);
      if (!prepared || prepared.decision.status !== 'accepted') {
        throw new Error(`Raw MIME no longer contains accepted attachment ${outcome.id}`);
      }
      if (prepared.decision.contentHash !== outcome.contentHash) {
        throw new Error(`Raw MIME attachment ${outcome.id} no longer matches its committed hash`);
      }
      await this.storage.upload(
        outcome.storageKey,
        prepared.content,
        prepared.decision.contentType,
      );
    }

    await this.notifyIntake(
      organizationId,
      messageId,
      sourceEmail,
      subject,
      result.status,
      result.riskScore,
    );
    await this.replyToRejectedAttachments(organizationId, envelopeSource, subject, result.outcomes);
  }

  async create(organizationId: string, input: CreateEmailIntakeInput) {
    const body = input.body.trim();
    const subject = input.subject.trim();
    const detected = this.detectIntakeType(subject, body);

    const [created] = await this.db
      .insert(emailIntakeItems)
      .values({
        organizationId,
        sourceEmail: input.sourceEmail.trim(),
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

  private stableUuid(...parts: string[]): string {
    const bytes = createHash('sha256').update(parts.join('\0')).digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private attachmentStatus(value: string): StoredAttachmentOutcome['status'] {
    if (value === 'accepted' || value === 'duplicate' || value === 'rejected') return value;
    throw new Error(`Invalid persisted email attachment status: ${value}`);
  }

  private messageStatus(value: string): 'accepted' | 'partial' | 'rejected' | 'duplicate' {
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
    return text?.trim() ?? '';
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
    organizationId: string,
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
          'attachment_too_large',
          'attachment_count_exceeded',
        ].includes(attachment.rejectionReason ?? ''),
    );
    if (rejections.length === 0) return;

    const settings = await this.settingsService.getAll(organizationId);
    const smtpHost = settings.smtp_host || '';
    if (!smtpHost) return;
    const lines = rejections.map(
      (attachment) => `${attachment.filename}: ${this.rejectionCopy(attachment.rejectionReason!)}`,
    );
    const sent = await this.mailService.sendMail(
      {
        host: smtpHost,
        port: Number.parseInt(settings.smtp_port || '587', 10),
        secure: settings.smtp_secure === 'true',
        user: settings.smtp_user || '',
        pass: settings.smtp_pass || '',
        from: settings.smtp_from || `noreply@${smtpHost}`,
      },
      {
        to: sourceEmail,
        subject: `Attachments not accepted: ${subject || 'invoice email'}`,
        text: `BetterSpend could not accept these attachments:\n\n${lines.join('\n')}\n\nPlease resend each invoice as a PDF, PNG, JPG, or WebP file.`,
        html: `<p>BetterSpend could not accept these attachments:</p><ul>${lines
          .map((line) => `<li>${this.escapeHtml(line)}</li>`)
          .join('')}</ul><p>Please resend each invoice as a PDF, PNG, JPG, or WebP file.</p>`,
      },
    );
    if (!sent) throw new Error('Rejected email attachment reply was not delivered');
  }

  private rejectionCopy(reason: string): string {
    if (reason === 'archive_not_allowed') return 'archives are not accepted';
    if (reason === 'encrypted_pdf') return 'password-protected PDFs are not accepted';
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
