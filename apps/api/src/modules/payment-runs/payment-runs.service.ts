import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import {
  invoices,
  appendAuditLog,
  paymentRunEvents,
  paymentRunInvoices,
  paymentRuns,
  vendorPaymentAccounts,
  vendorVirtualCards,
  vendors,
} from '@betterspend/db';
import { sumMoney } from '@betterspend/shared';
import { AuditService } from '../audit/audit.service';
import type { AccessPolicy } from '../auth/access-policy';
import {
  permissionScopePredicate,
  requireAnyPermission,
  requirePermission,
} from '../auth/access-scope';
import { BudgetsService } from '../budgets/budgets.service';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { WorkflowExecutionService } from '../workflow-execution/workflow-execution.service';
import {
  paymentReleaseBlockReason,
  type PaymentReleaseAccountSnapshot,
  type PaymentReleaseInvoiceSnapshot,
} from './payment-release-policy';
import { lockPaymentReleaseVendor } from './payment-release-lock';

type PaymentMethod = 'ach' | 'wire' | 'check' | 'virtual_card' | 'manual';

/** Sum persisted invoice amounts without converting decimal values to floats. */
export function sumPaymentRunInvoiceAmounts(
  amounts: readonly (string | null | undefined)[],
): string {
  return sumMoney(amounts.map((amount) => amount ?? '0'));
}

function vendorPaymentAccountScopePredicates(orgId: string) {
  return {
    entity: (entityId: string) => sql`${vendorPaymentAccounts.vendorId} IN (
      SELECT ${vendors.id}
      FROM ${vendors}
      WHERE ${vendors.organizationId} = ${orgId}
        AND ${vendors.entityId} = ${entityId}
    )`,
  };
}

export interface CreatePaymentRunInput {
  runDate?: string;
  scheduledDate?: string;
  entityId?: string | null;
  notes?: string;
  invoiceIds: string[];
  paymentMethod?: PaymentMethod;
  invoiceMethods?: Record<string, PaymentMethod>;
}

export interface SubmitPaymentRunInput {
  providerBatchId?: string;
  paymentReference?: string;
}

export interface CreateVendorPaymentAccountInput {
  vendorId: string;
  accountName: string;
  paymentMethod?: PaymentMethod;
  country?: string;
  currency?: string;
  maskedAccount: string;
  provider?: string;
  providerAccountId?: string;
}

@Injectable()
export class PaymentRunsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly budgets: BudgetsService,
    private readonly webhookEvents: WebhookEventService,
    private readonly workflowExecution: WorkflowExecutionService,
  ) {}

  async releaseInvoice(id: string, orgId: string, userId: string, access?: AccessPolicy) {
    requirePermission(access, 'payments:release');
    if (access?.can('vendors:edit_payment_details')) {
      throw new ForbiddenException(
        'Payment release cannot be combined with vendor payment-detail access',
      );
    }

    await this.db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ vendorId: invoices.vendorId })
        .from(invoices)
        .innerJoin(vendors, eq(invoices.vendorId, vendors.id))
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.organizationId, orgId),
            eq(vendors.organizationId, orgId),
            permissionScopePredicate(access, 'payment', ['payments:release'], {
              entity: (entityId) => eq(invoices.entityId, entityId),
            }),
          ),
        );

      if (!candidate) throw new NotFoundException(`Invoice ${id} not found`);
      await lockPaymentReleaseVendor(tx, orgId, candidate.vendorId);

      const [lockedCandidate] = await tx
        .select({
          id: invoices.id,
          status: invoices.status,
          approvedAt: invoices.approvedAt,
          vendorId: invoices.vendorId,
          vendorName: vendors.name,
          vendorStatus: vendors.status,
          onboardingStatus: vendors.onboardingStatus,
          sanctionsStatus: vendors.sanctionsStatus,
        })
        .from(invoices)
        .innerJoin(vendors, eq(invoices.vendorId, vendors.id))
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.organizationId, orgId),
            eq(vendors.organizationId, orgId),
            permissionScopePredicate(access, 'payment', ['payments:release'], {
              entity: (entityId) => eq(invoices.entityId, entityId),
            }),
          ),
        )
        .for('update');

      if (!lockedCandidate) throw new NotFoundException(`Invoice ${id} not found`);

      const accounts: PaymentReleaseAccountSnapshot[] = await tx
        .select({
          verificationStatus: vendorPaymentAccounts.verificationStatus,
          createdAt: vendorPaymentAccounts.createdAt,
          updatedAt: vendorPaymentAccounts.updatedAt,
        })
        .from(vendorPaymentAccounts)
        .where(
          and(
            eq(vendorPaymentAccounts.orgId, orgId),
            eq(vendorPaymentAccounts.vendorId, lockedCandidate.vendorId),
          ),
        )
        .for('share');
      const blockReason = paymentReleaseBlockReason(
        lockedCandidate satisfies PaymentReleaseInvoiceSnapshot,
        accounts,
      );
      if (blockReason) throw new BadRequestException(blockReason);

      const releasedAt = new Date();
      const [released] = await tx
        .update(invoices)
        .set({ status: 'ready_for_release', releasedBy: userId, releasedAt, updatedAt: releasedAt })
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.organizationId, orgId),
            eq(invoices.status, 'approved'),
          ),
        )
        .returning({ id: invoices.id });
      if (!released) throw new BadRequestException('Invoice approval changed during release');
      await appendAuditLog(tx, {
        organizationId: orgId,
        userId,
        entityType: 'invoice',
        entityId: id,
        action: 'released_for_payment',
        changes: { previousStatus: 'approved', status: 'ready_for_release' },
      });
    });

    return this.db.query.invoices.findFirst({
      where: (invoice, { and, eq }) => and(eq(invoice.id, id), eq(invoice.organizationId, orgId)),
    });
  }

  async eligibleInvoices(orgId: string, access?: AccessPolicy) {
    requirePermission(access, 'payments:view');
    return this.db.query.invoices.findMany({
      where: (invoice, { and, eq, isNull }) =>
        and(
          eq(invoice.organizationId, orgId),
          eq(invoice.status, 'ready_for_release'),
          isNull(invoice.paidAt),
          permissionScopePredicate(access, 'payment', ['payments:view', 'payments:manage'], {
            entity: (entityId) => eq(invoice.entityId, entityId),
          }),
        ),
      with: {
        vendor: { columns: { punchoutConfig: false } },
        entity: true,
        purchaseOrder: true,
      },
      orderBy: (invoice, { asc }) => [asc(invoice.dueDate), asc(invoice.internalNumber)],
    });
  }

  async findAll(orgId: string, status?: string, access?: AccessPolicy) {
    requirePermission(access, 'payments:view');
    return this.db.query.paymentRuns.findMany({
      where: (run, { and, eq }) =>
        and(
          eq(run.orgId, orgId),
          status ? eq(run.status, status) : undefined,
          permissionScopePredicate(access, 'payment', ['payments:view'], {
            entity: (entityId) => eq(run.entityId, entityId),
          }),
        ),
      with: {
        entity: true,
        createdByUser: true,
        approvedByUser: true,
        paymentRunInvoices: {
          with: {
            invoice: {
              with: {
                vendor: { columns: { punchoutConfig: false } },
                entity: true,
              },
            },
          },
        },
      },
      orderBy: (run, { desc }) => desc(run.createdAt),
    });
  }

  async findOne(
    id: string,
    orgId: string,
    access?: AccessPolicy,
    permissions: readonly ('payments:view' | 'payments:manage')[] = [
      'payments:view',
      'payments:manage',
    ],
  ) {
    requireAnyPermission(access, permissions);
    const run = await this.db.query.paymentRuns.findFirst({
      where: (paymentRun, { and, eq }) =>
        and(
          eq(paymentRun.id, id),
          eq(paymentRun.orgId, orgId),
          permissionScopePredicate(access, 'payment', permissions, {
            entity: (entityId) => eq(paymentRun.entityId, entityId),
          }),
        ),
      with: {
        entity: true,
        createdByUser: true,
        approvedByUser: true,
        events: { orderBy: (event, { desc }) => desc(event.createdAt) },
        virtualCards: {
          with: { vendor: { columns: { punchoutConfig: false } }, invoice: true },
        },
        paymentRunInvoices: {
          with: {
            invoice: {
              with: {
                vendor: { columns: { punchoutConfig: false } },
                entity: true,
                purchaseOrder: true,
              },
            },
          },
        },
      },
    });

    if (!run) throw new NotFoundException(`Payment run ${id} not found`);
    return run;
  }

  async create(orgId: string, userId: string, input: CreatePaymentRunInput, access?: AccessPolicy) {
    requirePermission(access, 'payments:manage');
    const invoiceIds = [...new Set(input.invoiceIds ?? [])];
    if (invoiceIds.length === 0) throw new BadRequestException('At least one invoice is required');

    const defaultPaymentMethod = input.paymentMethod ?? 'manual';
    const runDate = input.runDate ?? new Date().toISOString().slice(0, 10);

    const runId = await this.db.transaction(async (tx) => {
      const invoiceSelection = () =>
        tx
          .select({
            id: invoices.id,
            vendorId: invoices.vendorId,
            entityId: invoices.entityId,
            currency: invoices.currency,
            totalAmount: invoices.totalAmount,
            paidAt: invoices.paidAt,
            status: invoices.status,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.organizationId, orgId),
              inArray(invoices.id, invoiceIds),
              eq(invoices.status, 'ready_for_release'),
              isNull(invoices.paidAt),
              permissionScopePredicate(access, 'payment', ['payments:manage'], {
                entity: (entityId) => eq(invoices.entityId, entityId),
              }),
            ),
          );
      const initialInvoices = await invoiceSelection();
      if (initialInvoices.length !== invoiceIds.length) {
        throw new BadRequestException(
          'One or more invoices are not released, unpaid, or in this organization',
        );
      }

      const vendorIds = [...new Set(initialInvoices.map((invoice) => invoice.vendorId))].sort();
      for (const vendorId of vendorIds) {
        await lockPaymentReleaseVendor(tx, orgId, vendorId);
      }

      const selectedInvoices = await invoiceSelection().for('update');
      if (selectedInvoices.length !== invoiceIds.length) {
        throw new BadRequestException(
          'One or more invoices are not released, unpaid, or in this organization',
        );
      }

      const currencies = new Set(selectedInvoices.map((invoice) => invoice.currency));
      if (currencies.size > 1) {
        throw new BadRequestException('Create separate payment runs for each invoice currency');
      }

      const entities = new Set(selectedInvoices.map((invoice) => invoice.entityId));
      if (
        input.entityId &&
        !selectedInvoices.every((invoice) => invoice.entityId === input.entityId)
      ) {
        throw new BadRequestException(
          'Selected invoices do not all belong to the requested entity',
        );
      }
      if (!input.entityId && entities.size > 1) {
        throw new BadRequestException('Create separate payment runs for each legal entity');
      }

      const totalAmount = sumPaymentRunInvoiceAmounts(
        selectedInvoices.map((invoice) => invoice.totalAmount),
      );
      const currency = selectedInvoices[0]?.currency ?? 'USD';
      const [run] = await tx
        .insert(paymentRuns)
        .values({
          orgId,
          entityId:
            input.entityId ?? (entities.values().next().value as string | undefined) ?? null,
          status: 'draft',
          runDate,
          scheduledDate: input.scheduledDate ?? runDate,
          currency,
          totalAmount,
          invoiceCount: String(selectedInvoices.length),
          notes: input.notes ?? null,
          createdBy: userId,
        })
        .returning();

      await tx.insert(paymentRunInvoices).values(
        selectedInvoices.map((invoice) => ({
          paymentRunId: run.id,
          invoiceId: invoice.id,
          paymentMethod: input.invoiceMethods?.[invoice.id] ?? defaultPaymentMethod,
          amount: String(invoice.totalAmount ?? '0'),
          currency: invoice.currency,
          status: 'scheduled',
        })),
      );

      await tx.insert(paymentRunEvents).values({
        paymentRunId: run.id,
        eventType: 'created',
        message: `Payment run created with ${selectedInvoices.length} invoice(s).`,
        metadata: { invoiceIds },
        createdBy: userId,
      });

      return {
        runId: run.id,
        invoiceCount: selectedInvoices.length,
        totalAmount,
        currency,
      };
    });

    await this.audit
      .log(orgId, userId, 'payment_run', runId.runId, 'created', {
        invoiceCount: runId.invoiceCount,
        totalAmount: runId.totalAmount,
        currency: runId.currency,
      })
      .catch(() => {});

    return this.findOne(runId.runId, orgId, access);
  }

  async approve(id: string, orgId: string, userId: string, access?: AccessPolicy) {
    requirePermission(access, 'payments:manage');
    const run = await this.findOne(id, orgId, access, ['payments:manage']);
    if (!['draft', 'pending_approval'].includes(run.status)) {
      throw new BadRequestException(`Cannot approve a payment run in status ${run.status}`);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(paymentRuns)
        .set({
          status: 'approved',
          approvedBy: userId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(paymentRuns.id, id), eq(paymentRuns.orgId, orgId)));

      await tx.insert(paymentRunEvents).values({
        paymentRunId: id,
        eventType: 'approved',
        message: 'Payment run approved for submission.',
        createdBy: userId,
      });
    });

    await this.audit.log(orgId, userId, 'payment_run', id, 'approved').catch(() => {});
    return this.findOne(id, orgId, access, ['payments:manage']);
  }

  async submit(
    id: string,
    orgId: string,
    userId: string,
    input: SubmitPaymentRunInput = {},
    access?: AccessPolicy,
  ) {
    requirePermission(access, 'payments:manage');
    const run = await this.findOne(id, orgId, access, ['payments:manage']);
    if (run.status !== 'approved') {
      throw new BadRequestException('Only approved payment runs can be submitted');
    }

    const paymentReference =
      input.paymentReference?.trim() ||
      `RUN-${new Date().toISOString().slice(0, 10)}-${id.slice(0, 8)}`;
    const providerBatchId = input.providerBatchId?.trim() || null;
    const now = new Date();

    const webhookDeliveryIds = await this.db.transaction(async (tx) => {
      const [lockedRun] = await tx
        .select({ status: paymentRuns.status })
        .from(paymentRuns)
        .where(and(eq(paymentRuns.id, id), eq(paymentRuns.orgId, orgId)))
        .for('update');
      if (!lockedRun) throw new NotFoundException(`Payment run ${id} not found`);
      if (lockedRun.status !== 'approved') {
        throw new BadRequestException('Only approved payment runs can be submitted');
      }

      const vendorRows = await tx
        .select({ vendorId: invoices.vendorId })
        .from(paymentRunInvoices)
        .innerJoin(invoices, eq(paymentRunInvoices.invoiceId, invoices.id))
        .innerJoin(vendors, eq(invoices.vendorId, vendors.id))
        .where(
          and(
            eq(paymentRunInvoices.paymentRunId, id),
            eq(invoices.organizationId, orgId),
            eq(vendors.organizationId, orgId),
          ),
        );
      if (vendorRows.length === 0) {
        throw new BadRequestException('Payment run has no invoices to submit');
      }

      const vendorIds = [...new Set(vendorRows.map((row) => row.vendorId))].sort();
      for (const vendorId of vendorIds) {
        await lockPaymentReleaseVendor(tx, orgId, vendorId);
      }

      const invoiceLinks = await tx
        .select({
          invoiceId: paymentRunInvoices.invoiceId,
          paymentMethod: paymentRunInvoices.paymentMethod,
          amount: paymentRunInvoices.amount,
          currency: paymentRunInvoices.currency,
          vendorId: invoices.vendorId,
          status: invoices.status,
          paidAt: invoices.paidAt,
          approvedAt: invoices.approvedAt,
          vendorName: vendors.name,
          vendorStatus: vendors.status,
          onboardingStatus: vendors.onboardingStatus,
          sanctionsStatus: vendors.sanctionsStatus,
        })
        .from(paymentRunInvoices)
        .innerJoin(invoices, eq(paymentRunInvoices.invoiceId, invoices.id))
        .innerJoin(vendors, eq(invoices.vendorId, vendors.id))
        .where(
          and(
            eq(paymentRunInvoices.paymentRunId, id),
            eq(invoices.organizationId, orgId),
            eq(vendors.organizationId, orgId),
          ),
        )
        .for('update');

      if (invoiceLinks.length === 0) {
        throw new BadRequestException('Payment run has no invoices to submit');
      }

      const accountRows: Array<PaymentReleaseAccountSnapshot & { vendorId: string }> = await tx
        .select({
          vendorId: vendorPaymentAccounts.vendorId,
          verificationStatus: vendorPaymentAccounts.verificationStatus,
          createdAt: vendorPaymentAccounts.createdAt,
          updatedAt: vendorPaymentAccounts.updatedAt,
        })
        .from(vendorPaymentAccounts)
        .where(
          and(
            eq(vendorPaymentAccounts.orgId, orgId),
            inArray(vendorPaymentAccounts.vendorId, vendorIds),
          ),
        )
        .for('share');
      for (const link of invoiceLinks) {
        const blockReason = paymentReleaseBlockReason(
          link satisfies PaymentReleaseInvoiceSnapshot,
          accountRows.filter((account) => account.vendorId === link.vendorId),
          'ready_for_release',
        );
        if (blockReason) {
          throw new BadRequestException(`${link.invoiceId}: ${blockReason}`);
        }
        if (link.paidAt) {
          throw new BadRequestException(`Invoice ${link.invoiceId} has already been paid`);
        }
      }

      await tx
        .update(paymentRuns)
        .set({
          status: 'paid',
          submittedAt: now,
          providerBatchId,
          updatedAt: now,
        })
        .where(and(eq(paymentRuns.id, id), eq(paymentRuns.orgId, orgId)));

      await tx
        .update(paymentRunInvoices)
        .set({ status: 'paid', paymentReference, updatedAt: now })
        .where(eq(paymentRunInvoices.paymentRunId, id));

      await tx
        .update(invoices)
        .set({ status: 'paid', paidAt: now, paymentReference, updatedAt: now })
        .where(
          and(
            eq(invoices.organizationId, orgId),
            inArray(
              invoices.id,
              invoiceLinks.map((link) => link.invoiceId),
            ),
            eq(invoices.status, 'ready_for_release'),
          ),
        );

      const paidInvoices = await tx.query.invoices.findMany({
        where: (invoice, { and, eq, inArray }) =>
          and(
            eq(invoice.organizationId, orgId),
            inArray(
              invoice.id,
              invoiceLinks.map((link) => link.invoiceId),
            ),
          ),
        with: {
          vendor: { columns: { punchoutConfig: false } },
          entity: true,
          purchaseOrder: true,
        },
      });
      const paidInvoiceById = new Map(paidInvoices.map((invoice) => [invoice.id, invoice]));
      const deliveryIds: string[] = [];
      for (const link of invoiceLinks) {
        const invoice = paidInvoiceById.get(link.invoiceId);
        if (!invoice) throw new NotFoundException(`Invoice ${link.invoiceId} not found`);
        deliveryIds.push(
          ...(await this.webhookEvents.recordInvoicePaidInTransaction(tx, orgId, invoice)),
        );
      }

      const cardRows = invoiceLinks.filter((link) => link.paymentMethod === 'virtual_card');
      if (cardRows.length > 0) {
        await tx.insert(vendorVirtualCards).values(
          cardRows.map((link) => ({
            orgId,
            vendorId: link.vendorId,
            paymentRunId: id,
            invoiceId: link.invoiceId,
            status: 'requested',
            provider: 'manual',
            maskedCard: 'pending',
            limitAmount: String(link.amount),
            currency: link.currency,
            createdBy: userId,
            controls: {
              source: 'payment_run',
              merchantLocked: true,
              note: 'Provider integration pending; no PAN stored in BetterSpend.',
            },
          })),
        );
      }

      await tx.insert(paymentRunEvents).values({
        paymentRunId: id,
        eventType: 'submitted',
        message: 'Payment run submitted and invoices marked paid.',
        metadata: { paymentReference, providerBatchId },
        createdBy: userId,
      });

      return deliveryIds;
    });

    await this.audit
      .log(orgId, userId, 'payment_run', id, 'submitted', { paymentReference, providerBatchId })
      .catch(() => {});

    const submittedRun = await this.findOne(id, orgId, access, ['payments:manage']);
    await this.webhookEvents.enqueueDurableDeliveries(webhookDeliveryIds);
    return submittedRun;
  }

  async cancel(id: string, orgId: string, userId: string, reason?: string, access?: AccessPolicy) {
    requirePermission(access, 'payments:manage');
    const run = await this.findOne(id, orgId, access, ['payments:manage']);
    if (['paid', 'cancelled'].includes(run.status)) {
      throw new BadRequestException(`Cannot cancel a payment run in status ${run.status}`);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(paymentRuns)
        .set({ status: 'cancelled', notes: reason ?? run.notes, updatedAt: new Date() })
        .where(and(eq(paymentRuns.id, id), eq(paymentRuns.orgId, orgId)));

      await tx
        .update(paymentRunInvoices)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(paymentRunInvoices.paymentRunId, id));

      await tx.insert(paymentRunEvents).values({
        paymentRunId: id,
        eventType: 'cancelled',
        message: reason?.trim() || 'Payment run cancelled.',
        createdBy: userId,
      });
    });

    await this.audit.log(orgId, userId, 'payment_run', id, 'cancelled', { reason }).catch(() => {});
    return this.findOne(id, orgId, access, ['payments:manage']);
  }

  async vendorAccounts(orgId: string, vendorId?: string, access?: AccessPolicy) {
    requirePermission(access, 'payments:view');
    return this.db.query.vendorPaymentAccounts.findMany({
      where: (account, { and, eq }) =>
        and(
          eq(account.orgId, orgId),
          vendorId ? eq(account.vendorId, vendorId) : undefined,
          permissionScopePredicate(
            access,
            'payment',
            ['payments:view'],
            vendorPaymentAccountScopePredicates(orgId),
          ),
        ),
      with: { vendor: { columns: { punchoutConfig: false } } },
      orderBy: (account, { desc }) => desc(account.createdAt),
    });
  }

  async createVendorAccount(
    orgId: string,
    input: CreateVendorPaymentAccountInput,
    userId: string,
    access?: AccessPolicy,
  ) {
    requirePermission(access, 'vendors:edit_payment_details');
    const result = await this.db.transaction(async (tx) => {
      await lockPaymentReleaseVendor(tx, orgId, input.vendorId);
      const [vendor] = await tx
        .select({ id: vendors.id })
        .from(vendors)
        .where(
          and(
            eq(vendors.id, input.vendorId),
            eq(vendors.organizationId, orgId),
            permissionScopePredicate(access, 'vendor', ['vendors:edit_payment_details'], {
              entity: (entityId) => eq(vendors.entityId, entityId),
            }),
          ),
        )
        .for('update');
      if (!vendor) throw new NotFoundException(`Vendor ${input.vendorId} not found`);

      const [created] = await tx
        .insert(vendorPaymentAccounts)
        .values({
          orgId,
          vendorId: input.vendorId,
          accountName: input.accountName,
          paymentMethod: input.paymentMethod ?? 'ach',
          country: input.country ?? null,
          currency: input.currency ?? 'USD',
          maskedAccount: input.maskedAccount,
          provider: input.provider ?? null,
          providerAccountId: input.providerAccountId ?? null,
          verificationStatus: 'pending',
        })
        .returning();
      await appendAuditLog(tx, {
        organizationId: orgId,
        userId,
        entityType: 'vendor_payment_account',
        entityId: created.id,
        action: 'created',
        changes: { vendorId: input.vendorId, paymentMethod: input.paymentMethod ?? 'ach' },
      });
      const replacementRequestIds = await this.invalidateVendorReleases(
        tx,
        orgId,
        input.vendorId,
        userId,
      );
      return { account: created, replacementRequestIds };
    });

    await Promise.all(
      result.replacementRequestIds.map((requestId) =>
        this.workflowExecution.publishCommittedRequest(requestId, orgId),
      ),
    );
    return result.account;
  }

  async verifyVendorAccount(id: string, orgId: string, userId: string, access?: AccessPolicy) {
    requirePermission(access, 'vendors:edit_payment_details');
    const result = await this.db.transaction(async (tx) => {
      const [existingAccount] = await tx
        .select({ vendorId: vendorPaymentAccounts.vendorId })
        .from(vendorPaymentAccounts)
        .where(and(eq(vendorPaymentAccounts.id, id), eq(vendorPaymentAccounts.orgId, orgId)));
      if (!existingAccount) throw new NotFoundException(`Vendor payment account ${id} not found`);

      await lockPaymentReleaseVendor(tx, orgId, existingAccount.vendorId);
      const [vendor] = await tx
        .select({ id: vendors.id })
        .from(vendors)
        .where(
          and(
            eq(vendors.id, existingAccount.vendorId),
            eq(vendors.organizationId, orgId),
            permissionScopePredicate(access, 'vendor', ['vendors:edit_payment_details'], {
              entity: (entityId) => eq(vendors.entityId, entityId),
            }),
          ),
        )
        .for('update');
      if (!vendor) throw new NotFoundException(`Vendor payment account ${id} not found`);

      const [lockedAccount] = await tx
        .select({ vendorId: vendorPaymentAccounts.vendorId })
        .from(vendorPaymentAccounts)
        .where(and(eq(vendorPaymentAccounts.id, id), eq(vendorPaymentAccounts.orgId, orgId)))
        .for('update');
      if (!lockedAccount) throw new NotFoundException(`Vendor payment account ${id} not found`);

      const now = new Date();
      const [updated] = await tx
        .update(vendorPaymentAccounts)
        .set({ verificationStatus: 'verified', verifiedAt: now, updatedAt: now })
        .where(and(eq(vendorPaymentAccounts.id, id), eq(vendorPaymentAccounts.orgId, orgId)))
        .returning();
      if (!updated) throw new NotFoundException(`Vendor payment account ${id} not found`);
      await appendAuditLog(tx, {
        organizationId: orgId,
        userId,
        entityType: 'vendor_payment_account',
        entityId: id,
        action: 'verified',
        changes: { vendorId: updated.vendorId },
      });
      const replacementRequestIds = await this.invalidateVendorReleases(
        tx,
        orgId,
        updated.vendorId,
        userId,
      );
      return { account: updated, replacementRequestIds };
    });
    await Promise.all(
      result.replacementRequestIds.map((requestId) =>
        this.workflowExecution.publishCommittedRequest(requestId, orgId),
      ),
    );
    return result.account;
  }

  private async invalidateVendorReleases(
    tx: Parameters<Parameters<Db['transaction']>[0]>[0],
    orgId: string,
    vendorId: string,
    userId: string,
  ) {
    const replacementRequestIds: string[] = [];
    const invalidatableInvoices = await tx
      .select({ id: invoices.id, status: invoices.status })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, orgId),
          eq(invoices.vendorId, vendorId),
          inArray(invoices.status, ['approved', 'ready_for_release']),
        ),
      )
      .for('update');
    for (const invoice of invalidatableInvoices) {
      const invalidatedAt = new Date();
      await this.budgets.reopenInvoice(tx, orgId, invoice.id, invalidatedAt);
      const currentRequest = await tx.query.approvalRequests.findFirst({
        where: (request, { and, eq, inArray, isNotNull }) =>
          and(
            eq(request.organizationId, orgId),
            eq(request.approvableType, 'invoice'),
            eq(request.approvableId, invoice.id),
            isNotNull(request.definitionVersionId),
            inArray(request.status, ['pending', 'approved']),
          ),
        orderBy: (request, { desc }) => desc(request.createdAt),
      });
      if (currentRequest) {
        await this.workflowExecution.cancelForEditInTransaction(
          currentRequest.id,
          orgId,
          userId,
          tx,
          { allowApproved: true, reason: 'payment_details_changed' },
        );
      }
      const [invalidated] = await tx
        .update(invoices)
        .set({
          status: 'pending_approval',
          approvedBy: null,
          approvedAt: null,
          releasedBy: null,
          releasedAt: null,
          updatedAt: invalidatedAt,
        })
        .where(
          and(
            eq(invoices.id, invoice.id),
            eq(invoices.organizationId, orgId),
            eq(invoices.vendorId, vendorId),
            inArray(invoices.status, ['approved', 'ready_for_release']),
          ),
        )
        .returning({ id: invoices.id });
      if (!invalidated) continue;
      const initiated = await this.workflowExecution.initiateIfConfigured(
        orgId,
        'invoice',
        invoice.id,
        userId,
        undefined,
        undefined,
        tx,
      );
      const status: 'matched' | 'pending_approval' | 'approved' = initiated
        ? initiated.status === 'approved'
          ? 'approved'
          : 'pending_approval'
        : 'matched';
      if (initiated) replacementRequestIds.push(initiated.requestId);
      if (!initiated) {
        await tx
          .update(invoices)
          .set({ status: 'matched', updatedAt: new Date() })
          .where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, orgId)));
      }
      await appendAuditLog(tx, {
        organizationId: orgId,
        userId,
        entityType: 'invoice',
        entityId: invoice.id,
        action: 'payment_release_revoked',
        changes: {
          previousStatus: invoice.status,
          reason: 'vendor_payment_details_changed',
          status,
          workflowRequestId: initiated?.requestId ?? null,
        },
      });
    }
    return replacementRequestIds;
  }

  async summary(orgId: string, access?: AccessPolicy) {
    requirePermission(access, 'payments:view');
    const scopePredicate = permissionScopePredicate(access, 'payment', ['payments:view'], {
      entity: (entityId) => eq(paymentRuns.entityId, entityId),
    });
    const rows = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft')::int AS "draftCount",
        COUNT(*) FILTER (WHERE status = 'approved')::int AS "approvedCount",
        COUNT(*) FILTER (WHERE status = 'paid')::int AS "paidCount",
        COALESCE(SUM(total_amount::numeric) FILTER (WHERE status IN ('draft', 'approved')), 0)::numeric AS "openAmount"
      FROM payment_runs
        WHERE org_id = ${orgId}
        AND ${scopePredicate}
    `);
    return (rows as any[])[0] ?? { draftCount: 0, approvedCount: 0, paidCount: 0, openAmount: 0 };
  }
}
