import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import {
  invoices,
  paymentRunEvents,
  paymentRunInvoices,
  paymentRuns,
  vendorPaymentAccounts,
  vendorVirtualCards,
} from '@betterspend/db';
import { AuditService } from '../audit/audit.service';

type PaymentMethod = 'ach' | 'wire' | 'check' | 'virtual_card' | 'manual';

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
  ) {}

  async eligibleInvoices(orgId: string) {
    return this.db.query.invoices.findMany({
      where: (invoice, { and, eq, isNull }) =>
        and(eq(invoice.organizationId, orgId), eq(invoice.status, 'approved'), isNull(invoice.paidAt)),
      with: {
        vendor: true,
        entity: true,
        purchaseOrder: true,
      },
      orderBy: (invoice, { asc }) => [asc(invoice.dueDate), asc(invoice.internalNumber)],
    });
  }

  async findAll(orgId: string, status?: string) {
    return this.db.query.paymentRuns.findMany({
      where: (run, { and, eq }) => and(eq(run.orgId, orgId), status ? eq(run.status, status) : undefined),
      with: {
        entity: true,
        createdByUser: true,
        approvedByUser: true,
        paymentRunInvoices: {
          with: {
            invoice: {
              with: {
                vendor: true,
                entity: true,
              },
            },
          },
        },
      },
      orderBy: (run, { desc }) => desc(run.createdAt),
    });
  }

  async findOne(id: string, orgId: string) {
    const run = await this.db.query.paymentRuns.findFirst({
      where: (paymentRun, { and, eq }) => and(eq(paymentRun.id, id), eq(paymentRun.orgId, orgId)),
      with: {
        entity: true,
        createdByUser: true,
        approvedByUser: true,
        events: { orderBy: (event, { desc }) => desc(event.createdAt) },
        virtualCards: { with: { vendor: true, invoice: true } },
        paymentRunInvoices: {
          with: {
            invoice: {
              with: {
                vendor: true,
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

  async create(orgId: string, userId: string, input: CreatePaymentRunInput) {
    const invoiceIds = [...new Set(input.invoiceIds ?? [])];
    if (invoiceIds.length === 0) throw new BadRequestException('At least one invoice is required');

    const selectedInvoices = await this.db.query.invoices.findMany({
      where: (invoice, { and, eq, inArray, isNull }) =>
        and(
          eq(invoice.organizationId, orgId),
          inArray(invoice.id, invoiceIds),
          eq(invoice.status, 'approved'),
          isNull(invoice.paidAt),
        ),
      with: { vendor: true },
    });

    if (selectedInvoices.length !== invoiceIds.length) {
      throw new BadRequestException('One or more invoices are not approved, unpaid, or in this organization');
    }

    const currencies = new Set(selectedInvoices.map((invoice) => invoice.currency));
    if (currencies.size > 1) {
      throw new BadRequestException('Create separate payment runs for each invoice currency');
    }

    const entities = new Set(selectedInvoices.map((invoice) => invoice.entityId));
    if (input.entityId && !selectedInvoices.every((invoice) => invoice.entityId === input.entityId)) {
      throw new BadRequestException('Selected invoices do not all belong to the requested entity');
    }
    if (!input.entityId && entities.size > 1) {
      throw new BadRequestException('Create separate payment runs for each legal entity');
    }

    const totalAmount = selectedInvoices.reduce(
      (sum, invoice) => sum + Number(invoice.totalAmount ?? 0),
      0,
    );
    const currency = selectedInvoices[0]?.currency ?? 'USD';
    const defaultPaymentMethod = input.paymentMethod ?? 'manual';
    const runDate = input.runDate ?? new Date().toISOString().slice(0, 10);

    const runId = await this.db.transaction(async (tx) => {
      const [run] = await tx
        .insert(paymentRuns)
        .values({
          orgId,
          entityId: input.entityId ?? (entities.values().next().value as string | undefined) ?? null,
          status: 'draft',
          runDate,
          scheduledDate: input.scheduledDate ?? runDate,
          currency,
          totalAmount: totalAmount.toFixed(4),
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

      return run.id;
    });

    await this.audit
      .log(orgId, userId, 'payment_run', runId, 'created', {
        invoiceCount: selectedInvoices.length,
        totalAmount,
        currency,
      })
      .catch(() => {});

    return this.findOne(runId, orgId);
  }

  async approve(id: string, orgId: string, userId: string) {
    const run = await this.findOne(id, orgId);
    if (!['draft', 'pending_approval'].includes(run.status)) {
      throw new BadRequestException(`Cannot approve a payment run in status ${run.status}`);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(paymentRuns)
        .set({ status: 'approved', approvedBy: userId, approvedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(paymentRuns.id, id), eq(paymentRuns.orgId, orgId)));

      await tx.insert(paymentRunEvents).values({
        paymentRunId: id,
        eventType: 'approved',
        message: 'Payment run approved for submission.',
        createdBy: userId,
      });
    });

    await this.audit.log(orgId, userId, 'payment_run', id, 'approved').catch(() => {});
    return this.findOne(id, orgId);
  }

  async submit(id: string, orgId: string, userId: string, input: SubmitPaymentRunInput = {}) {
    const run = await this.findOne(id, orgId);
    if (run.status !== 'approved') {
      throw new BadRequestException('Only approved payment runs can be submitted');
    }

    const paymentReference =
      input.paymentReference?.trim() || `RUN-${new Date().toISOString().slice(0, 10)}-${id.slice(0, 8)}`;
    const providerBatchId = input.providerBatchId?.trim() || null;
    const now = new Date();

    await this.db.transaction(async (tx) => {
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

      const invoiceLinks = await tx
        .select({
          invoiceId: paymentRunInvoices.invoiceId,
          paymentMethod: paymentRunInvoices.paymentMethod,
          amount: paymentRunInvoices.amount,
          currency: paymentRunInvoices.currency,
          vendorId: invoices.vendorId,
        })
        .from(paymentRunInvoices)
        .innerJoin(invoices, eq(paymentRunInvoices.invoiceId, invoices.id))
        .where(eq(paymentRunInvoices.paymentRunId, id));

      if (invoiceLinks.length > 0) {
        await tx
          .update(invoices)
          .set({ status: 'paid', paidAt: now, paymentReference, updatedAt: now })
          .where(inArray(invoices.id, invoiceLinks.map((link) => link.invoiceId)));
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
    });

    await this.audit
      .log(orgId, userId, 'payment_run', id, 'submitted', { paymentReference, providerBatchId })
      .catch(() => {});

    return this.findOne(id, orgId);
  }

  async cancel(id: string, orgId: string, userId: string, reason?: string) {
    const run = await this.findOne(id, orgId);
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
    return this.findOne(id, orgId);
  }

  async vendorAccounts(orgId: string, vendorId?: string) {
    return this.db.query.vendorPaymentAccounts.findMany({
      where: (account, { and, eq }) =>
        and(eq(account.orgId, orgId), vendorId ? eq(account.vendorId, vendorId) : undefined),
      with: { vendor: true },
      orderBy: (account, { desc }) => desc(account.createdAt),
    });
  }

  async createVendorAccount(orgId: string, input: CreateVendorPaymentAccountInput) {
    const [account] = await this.db
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

    return account;
  }

  async verifyVendorAccount(id: string, orgId: string, userId: string) {
    const [account] = await this.db
      .update(vendorPaymentAccounts)
      .set({ verificationStatus: 'verified', verifiedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(vendorPaymentAccounts.id, id), eq(vendorPaymentAccounts.orgId, orgId)))
      .returning();

    if (!account) throw new NotFoundException(`Vendor payment account ${id} not found`);
    await this.audit
      .log(orgId, userId, 'vendor_payment_account', id, 'verified', { vendorId: account.vendorId })
      .catch(() => {});
    return account;
  }

  async summary(orgId: string) {
    const rows = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft')::int AS "draftCount",
        COUNT(*) FILTER (WHERE status = 'approved')::int AS "approvedCount",
        COUNT(*) FILTER (WHERE status = 'paid')::int AS "paidCount",
        COALESCE(SUM(total_amount::numeric) FILTER (WHERE status IN ('draft', 'approved')), 0)::numeric AS "openAmount"
      FROM payment_runs
      WHERE org_id = ${orgId}
    `);
    return (rows as any[])[0] ?? { draftCount: 0, approvedCount: 0, paidCount: 0, openAmount: 0 };
  }
}
