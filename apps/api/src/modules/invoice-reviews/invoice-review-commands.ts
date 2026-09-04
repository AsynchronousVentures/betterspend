import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  appendAuditLog,
  emailIntakeItems,
  invoiceReviewCases,
  invoiceReviewSignals,
  invoices,
  messages,
  ocrJobs,
  purchaseOrders,
  requisitions,
  spendGuardAlerts,
  users,
  type Db,
  type DbTransaction,
} from '@betterspend/db';
import {
  invoiceReviewCommandSchema,
  type InvoiceReviewCommand,
  type InvoiceReviewCaseState,
} from '@betterspend/shared';
import { DB_TOKEN } from '../../database/database.module';
import { AccessPolicyService, type AccessPolicy } from '../auth/access-policy';
import {
  InvoiceReviewDeliveries,
  type InvoiceReviewDeliveryRecord,
} from './invoice-review-deliveries.service';

type CommandCode =
  | 'REVIEW_NOT_FOUND'
  | 'REVIEW_FORBIDDEN'
  | 'REVIEW_STALE_VERSION'
  | 'INVOICE_PAID'
  | 'INVOICE_CANCELLED'
  | 'INVALID_TRANSITION'
  | 'NOT_OWNER'
  | 'INVALID_ASSIGNEE'
  | 'SIGNAL_NOT_FOUND'
  | 'SOURCE_MISSING'
  | 'MATCH_WAIVER_REJECTED';

/** Stable command errors are a narrow part of this module's interface. */
export interface InvoiceReviewActor {
  id: string;
  organizationId: string;
  access?: AccessPolicy;
}

type LockedInvoice = {
  id: string;
  organizationId: string;
  entityId: string | null;
  status: string;
  paidAt: Date | null;
  createdBy: string | null;
  departmentId: string | null;
  projectId: string | null;
};

function commandError(code: CommandCode, status: 400 | 403 | 404 | 409): never {
  if (status === 400) throw new BadRequestException({ code, message: code.replaceAll('_', ' ') });
  if (status === 403) throw new ForbiddenException({ code, message: code.replaceAll('_', ' ') });
  if (status === 404) throw new NotFoundException({ code, message: code.replaceAll('_', ' ') });
  throw new ConflictException({ code, message: code.replaceAll('_', ' ') });
}

function canReviewInvoice(actor: InvoiceReviewActor, invoice: LockedInvoice): boolean {
  const access = actor.access;
  if (!access) return false;
  if (!access.can('invoices:review_exceptions')) return false;
  const scope = access.scopeFor('invoice', 'invoices:review_exceptions');
  return (
    scope.unrestricted ||
    scope.entityIds.includes(invoice.entityId ?? '') ||
    scope.departmentIds.includes(invoice.departmentId ?? '') ||
    scope.projectIds.includes(invoice.projectId ?? '') ||
    (scope.ownOnly && invoice.createdBy === actor.id)
  );
}

function nextCaseState(
  current: InvoiceReviewCaseState,
  action: InvoiceReviewCommand['action'],
  hasOpenBlockingSignals: boolean,
): InvoiceReviewCaseState {
  if (action === 'claim' || action === 'release' || action === 'reassign') return current;
  if (action === 'request_supplier_info') return 'waiting_on_supplier';
  if (action === 'mark_info_received') return hasOpenBlockingSignals ? 'in_review' : 'resolved';
  if (!hasOpenBlockingSignals) return 'resolved';
  if (current === 'waiting_on_supplier') return 'in_review';
  return current === 'resolved' ? 'open' : current;
}

function overrideReason(command: InvoiceReviewCommand): string | undefined {
  return 'overrideReason' in command ? command.overrideReason : undefined;
}

@Injectable()
export class InvoiceReviewCommands {
  private readonly logger = new Logger(InvoiceReviewCommands.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly deliveries: InvoiceReviewDeliveries,
    private readonly accessPolicies: AccessPolicyService,
  ) {}

  /**
   * The command seam: parse untrusted input, serialize the invoice-review
   * aggregate, write its audit and delivery intent, then enqueue after commit.
   */
  async apply(actor: InvoiceReviewActor, invoiceId: string, rawAction: unknown) {
    const command = invoiceReviewCommandSchema.parse(rawAction);
    const resolvedActor = actor.access
      ? actor
      : { ...actor, access: (await this.accessPolicies.resolve(actor)).policy };
    const outcome = await this.db.transaction((tx) =>
      this.applyInTransaction(tx, resolvedActor, invoiceId, command),
    );
    try {
      await this.deliveries.enqueue(outcome.intentIds);
    } catch (error: unknown) {
      this.logger.error(`Could not enqueue invoice review deliveries: ${String(error)}`);
    }
    return outcome.result;
  }

  private async applyInTransaction(
    tx: DbTransaction,
    actor: InvoiceReviewActor,
    invoiceId: string,
    command: InvoiceReviewCommand,
  ) {
    const [invoice] = await tx
      .select({
        id: invoices.id,
        organizationId: invoices.organizationId,
        entityId: invoices.entityId,
        status: invoices.status,
        paidAt: invoices.paidAt,
        createdBy: invoices.createdBy,
        purchaseOrderId: invoices.purchaseOrderId,
      })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, actor.organizationId)))
      .for('update');
    if (!invoice) commandError('REVIEW_NOT_FOUND', 404);
    const [invoiceScope] = invoice.purchaseOrderId
      ? await tx
          .select({ departmentId: requisitions.departmentId, projectId: requisitions.projectId })
          .from(purchaseOrders)
          .leftJoin(requisitions, eq(requisitions.id, purchaseOrders.requisitionId))
          .where(eq(purchaseOrders.id, invoice.purchaseOrderId))
          .limit(1)
      : [];
    const scopedInvoice: LockedInvoice = {
      ...invoice,
      departmentId: invoiceScope?.departmentId ?? null,
      projectId: invoiceScope?.projectId ?? null,
    };
    if (!canReviewInvoice(actor, scopedInvoice)) commandError('REVIEW_NOT_FOUND', 404);
    if (scopedInvoice.paidAt || scopedInvoice.status === 'paid') commandError('INVOICE_PAID', 409);
    if (scopedInvoice.status === 'cancelled') commandError('INVOICE_CANCELLED', 409);

    const [reviewCase] = await tx
      .select()
      .from(invoiceReviewCases)
      .where(
        and(
          eq(invoiceReviewCases.invoiceId, invoice.id),
          eq(invoiceReviewCases.organizationId, actor.organizationId),
        ),
      )
      .for('update');
    if (!reviewCase) commandError('REVIEW_NOT_FOUND', 404);
    if (reviewCase.version !== command.expectedVersion) commandError('REVIEW_STALE_VERSION', 409);
    if (
      reviewCase.state === 'resolved' &&
      command.action !== 'resolve_signal' &&
      command.action !== 'waive_signal'
    ) {
      commandError('INVALID_TRANSITION', 409);
    }
    if (
      command.action === 'mark_info_received' &&
      reviewCase.state !== 'waiting_on_supplier'
    ) {
      commandError('INVALID_TRANSITION', 409);
    }

    const isAdmin = actor.access?.isGlobalBuiltInAdmin() ?? true;
    const ownsCase = reviewCase.ownerId === actor.id;
    const requiresOwner = [
      'request_supplier_info',
      'mark_info_received',
      'resolve_signal',
      'waive_signal',
    ].includes(command.action);
    if (requiresOwner && !ownsCase && !isAdmin) commandError('NOT_OWNER', 403);
    if (
      requiresOwner &&
      !ownsCase &&
      isAdmin &&
      !overrideReason(command) &&
      command.action !== 'waive_signal'
    ) {
      commandError('INVALID_TRANSITION', 400);
    }

    let signal: typeof invoiceReviewSignals.$inferSelect | undefined;
    if (command.action === 'resolve_signal' || command.action === 'waive_signal') {
      [signal] = await tx
        .select()
        .from(invoiceReviewSignals)
        .where(
          and(
            eq(invoiceReviewSignals.id, command.signalId),
            eq(invoiceReviewSignals.caseId, reviewCase.id),
            eq(invoiceReviewSignals.organizationId, actor.organizationId),
          ),
        )
        .for('update');
      if (!signal) commandError('SIGNAL_NOT_FOUND', 404);
      if (signal.status !== 'open') commandError('INVALID_TRANSITION', 409);
      await this.assertSignalSource(tx, signal, actor.organizationId, invoice.id);
      if (signal.signalType === 'match_exception') {
        commandError('MATCH_WAIVER_REJECTED', 409);
      }
    }

    let ownerId = reviewCase.ownerId;
    if (command.action === 'claim') {
      if (reviewCase.ownerId) commandError('INVALID_TRANSITION', 409);
      ownerId = actor.id;
    }
    if (command.action === 'release') {
      if (!ownsCase) commandError('NOT_OWNER', 403);
      ownerId = null;
    }
    if (command.action === 'reassign') {
      if (!isAdmin) commandError('REVIEW_FORBIDDEN', 403);
      const [assignee] = await tx
        .select({ id: users.id, organizationId: users.organizationId, isActive: users.isActive })
        .from(users)
        .where(
          and(eq(users.id, command.assigneeId), eq(users.organizationId, actor.organizationId)),
        )
        .limit(1);
      if (!assignee?.isActive) commandError('INVALID_ASSIGNEE', 400);
      const { policy } = await this.accessPolicies.resolve({
        id: assignee.id,
        organizationId: assignee.organizationId,
      });
      if (
        !canReviewInvoice(
          { id: assignee.id, organizationId: assignee.organizationId, access: policy },
          scopedInvoice,
        )
      ) {
        commandError('INVALID_ASSIGNEE', 400);
      }
      ownerId = assignee.id;
    }

    let supplierMessageId: string | null = null;
    if (command.action === 'request_supplier_info') {
      const [author] = await tx
        .select({ name: users.name })
        .from(users)
        .where(and(eq(users.id, actor.id), eq(users.organizationId, actor.organizationId)))
        .limit(1);
      if (!author) commandError('REVIEW_NOT_FOUND', 404);
      const messageIdempotencyKey = `invoice-review-supplier:${reviewCase.id}:${command.expectedVersion}`;
      const [createdMessage] = await tx
        .insert(messages)
        .values({
          organizationId: actor.organizationId,
          threadType: 'invoice',
          threadId: invoice.id,
          senderType: 'user',
          senderId: actor.id,
          vendorId: null,
          authorName: author.name,
          body: command.message,
          attachments: [],
          idempotencyKey: messageIdempotencyKey,
        })
        .onConflictDoNothing({ target: [messages.organizationId, messages.idempotencyKey] })
        .returning({ id: messages.id });
      supplierMessageId = createdMessage?.id ?? null;
      if (!supplierMessageId) {
        const [existingMessage] = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.organizationId, actor.organizationId),
              eq(messages.idempotencyKey, messageIdempotencyKey),
            ),
          )
          .limit(1);
        supplierMessageId = existingMessage?.id ?? null;
      }
      if (!supplierMessageId) throw new Error('Supplier message was not returned after insert');
      if (createdMessage) {
        await appendAuditLog(tx, {
          organizationId: actor.organizationId,
          userId: actor.id,
          entityType: 'message',
          entityId: createdMessage.id,
          action: 'created',
          changes: { threadType: 'invoice', threadId: invoice.id },
        });
      }
    }

    if (signal) {
      const nextSignalStatus = command.action === 'waive_signal' ? 'waived' : 'resolved';
      const reason =
        command.action === 'waive_signal' ? command.reason : (overrideReason(command) ?? null);
      await tx
        .update(invoiceReviewSignals)
        .set({
          status: nextSignalStatus,
          resolutionActorId: actor.id,
          resolutionCommand: command.action,
          resolutionReason: reason,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invoiceReviewSignals.id, signal.id));
      await appendAuditLog(tx, {
        organizationId: actor.organizationId,
        userId: actor.id,
        entityType: 'invoice_review_signal',
        entityId: signal.id,
        action: `invoice_review_signal.${command.action}`,
        changes: {
          before: {
            status: signal.status,
            actorId: signal.resolutionActorId,
            command: signal.resolutionCommand,
            reason: signal.resolutionReason,
          },
          after: { status: nextSignalStatus, actorId: actor.id, command: command.action, reason },
        },
        metadata: { source: { module: signal.sourceModule, recordId: signal.sourceRecordId } },
      });
    }

    const openSignals = await tx
      .select({ severity: invoiceReviewSignals.severity })
      .from(invoiceReviewSignals)
      .where(
        and(
          eq(invoiceReviewSignals.caseId, reviewCase.id),
          eq(invoiceReviewSignals.organizationId, actor.organizationId),
          eq(invoiceReviewSignals.status, 'open'),
        ),
      );
    const hasOpenBlockingSignals = openSignals.some((current) => current.severity === 'blocking');
    const state = nextCaseState(reviewCase.state, command.action, hasOpenBlockingSignals);
    const now = new Date();
    const [updatedCase] = await tx
      .update(invoiceReviewCases)
      .set({
        ownerId,
        state,
        resolvedAt: state === 'resolved' ? (reviewCase.resolvedAt ?? now) : null,
        version: sql`${invoiceReviewCases.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(invoiceReviewCases.id, reviewCase.id),
          eq(invoiceReviewCases.organizationId, actor.organizationId),
          eq(invoiceReviewCases.version, command.expectedVersion),
        ),
      )
      .returning();
    if (!updatedCase) commandError('REVIEW_STALE_VERSION', 409);

    await appendAuditLog(tx, {
      organizationId: actor.organizationId,
      userId: actor.id,
      entityType: 'invoice_review_case',
      entityId: reviewCase.id,
      action: `invoice_review.${command.action}`,
      changes: {
        before: {
          state: reviewCase.state,
          ownerId: reviewCase.ownerId,
          version: reviewCase.version,
        },
        after: {
          state: updatedCase.state,
          ownerId: updatedCase.ownerId,
          version: updatedCase.version,
        },
      },
      metadata: {
        reason:
          command.action === 'reassign' || command.action === 'waive_signal'
            ? command.reason
            : (overrideReason(command) ?? null),
        source: signal
          ? { module: signal.sourceModule, recordId: signal.sourceRecordId, signalId: signal.id }
          : null,
      },
    });

    const recipientUserId = updatedCase.ownerId ?? actor.id;
    const deliveries: InvoiceReviewDeliveryRecord[] = [
      {
        intentKind: 'internal_notification',
        organizationId: actor.organizationId,
        caseId: updatedCase.id,
        recipientUserId,
        action: command.action,
        version: updatedCase.version,
      },
    ];
    if (supplierMessageId) {
      deliveries.push({
        intentKind: 'supplier_message_email',
        organizationId: actor.organizationId,
        caseId: updatedCase.id,
        messageId: supplierMessageId,
        action: 'request_supplier_info',
        version: updatedCase.version,
      });
    }
    const intentIds = await this.deliveries.record(tx, deliveries);

    return {
      intentIds,
      result: {
        case: {
          id: updatedCase.id,
          invoiceId: updatedCase.invoiceId,
          state: updatedCase.state,
          ownerId: updatedCase.ownerId,
          version: updatedCase.version,
          resolvedAt: updatedCase.resolvedAt,
        },
      },
    };
  }

  private async assertSignalSource(
    tx: DbTransaction,
    signal: typeof invoiceReviewSignals.$inferSelect,
    organizationId: string,
    invoiceId: string,
  ): Promise<void> {
    if (signal.sourceModule === 'matching') {
      if (signal.sourceRecordId === invoiceId) return;
      commandError('SOURCE_MISSING', 409);
    }
    if (signal.sourceModule === 'spend_guard') {
      const [source] = await tx
        .select({ id: spendGuardAlerts.id })
        .from(spendGuardAlerts)
        .where(
          and(
            eq(spendGuardAlerts.id, signal.sourceRecordId),
            eq(spendGuardAlerts.orgId, organizationId),
            eq(spendGuardAlerts.recordType, 'invoice'),
            eq(spendGuardAlerts.recordId, invoiceId),
          ),
        )
        .limit(1);
      if (source) return;
      commandError('SOURCE_MISSING', 409);
    }
    if (signal.sourceModule === 'ocr' || signal.sourceModule === 'OCR') {
      const [source] = await tx
        .select({ id: ocrJobs.id })
        .from(ocrJobs)
        .where(
          and(
            eq(ocrJobs.id, signal.sourceRecordId),
            eq(ocrJobs.organizationId, organizationId),
            eq(ocrJobs.invoiceId, invoiceId),
          ),
        )
        .limit(1);
      if (source) return;
      commandError('SOURCE_MISSING', 409);
    }
    if (signal.sourceModule === 'email_intake') {
      const [source] = await tx
        .select({ id: emailIntakeItems.id })
        .from(emailIntakeItems)
        .where(
          and(
            eq(emailIntakeItems.id, signal.sourceRecordId),
            eq(emailIntakeItems.organizationId, organizationId),
            eq(emailIntakeItems.createdDraftType, 'invoice'),
            eq(emailIntakeItems.createdDraftId, invoiceId),
          ),
        )
        .limit(1);
      if (source) return;
      commandError('SOURCE_MISSING', 409);
    }
    // Manual and imported signals have no recognized durable producer table.
    // They remain actionable, just as projection treats their provenance as opaque.
  }
}
