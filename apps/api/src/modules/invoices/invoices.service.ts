import { Injectable, Inject, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, isNull, lte, gte, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { invoices, invoiceLines, purchaseOrders, requisitions } from '@betterspend/db';
import { SequenceService } from '../../common/services/sequence.service';
import { MatchingService } from './matching.service';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { GlExportService } from '../gl/gl-export.service';
import { BudgetsService } from '../budgets/budgets.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const DEMO_ADMIN_USER_ID = '00000000-0000-0000-0000-000000000002';

export interface CreateInvoiceInput {
  purchaseOrderId?: string;
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  paymentTerms?: string;
  earlyPaymentDiscountPercent?: number;
  earlyPaymentDiscountBy?: string;
  currency?: string;
  lines: Array<{
    poLineId?: string;
    lineNumber: number;
    description: string;
    quantity: number;
    unitPrice: number;
    glAccount?: string;
  }>;
}

export interface AgingBucket {
  count: number;
  totalAmount: string;
}

export interface AgingReport {
  current: AgingBucket;
  days_1_30: AgingBucket;
  days_31_60: AgingBucket;
  days_61_90: AgingBucket;
  days_90_plus: AgingBucket;
}

export interface CashFlowWeek {
  weekStart: string;
  totalAmount: string;
}

export interface MarkPaidInput {
  paymentReference?: string;
}

@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly sequenceService: SequenceService,
    private readonly matchingService: MatchingService,
    private readonly webhookEvents: WebhookEventService,
    private readonly glExport: GlExportService,
    private readonly budgets: BudgetsService,
    private readonly audit: AuditService,
    @Optional() private readonly notifications: NotificationsService,
  ) {}

  async findAll(organizationId: string) {
    return this.db.query.invoices.findMany({
      where: (i, { eq }) => eq(i.organizationId, organizationId),
      with: { vendor: true, purchaseOrder: true },
      orderBy: (i, { desc }) => desc(i.createdAt),
    });
  }

  async findOne(id: string, organizationId: string) {
    const invoice = await this.db.query.invoices.findFirst({
      where: (i, { and, eq }) => and(eq(i.id, id), eq(i.organizationId, organizationId)),
      with: {
        vendor: true,
        purchaseOrder: { with: { lines: true } },
        lines: { with: { matchResults: true } },
      },
    });
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }

  async create(organizationId: string, input: CreateInvoiceInput) {
    // Duplicate invoice detection: same vendor + same invoice number in this org
    const duplicate = await this.db.query.invoices.findFirst({
      where: (i, { and, eq }) => and(
        eq(i.organizationId, organizationId),
        eq(i.vendorId, input.vendorId),
        eq(i.invoiceNumber, input.invoiceNumber),
      ),
    });
    if (duplicate) {
      throw new BadRequestException(
        `Duplicate invoice: ${input.invoiceNumber} already exists for this vendor (${duplicate.internalNumber})`,
      );
    }

    const internalNumber = await this.sequenceService.next(organizationId, 'invoice');

    const subtotal = input.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const totalAmount = subtotal; // no tax calculation for now

    const invoiceId = await this.db.transaction(async (tx) => {
      const [inv] = await tx.insert(invoices).values({
        organizationId,
        purchaseOrderId: input.purchaseOrderId ?? null,
        vendorId: input.vendorId,
        invoiceNumber: input.invoiceNumber,
        internalNumber,
        invoiceDate: new Date(input.invoiceDate),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        paymentTerms: input.paymentTerms ?? null,
        earlyPaymentDiscountPercent: input.earlyPaymentDiscountPercent != null ? String(input.earlyPaymentDiscountPercent) : null,
        earlyPaymentDiscountBy: input.earlyPaymentDiscountBy ?? null,
        currency: input.currency ?? 'USD',
        subtotal: String(subtotal.toFixed(2)),
        taxAmount: '0',
        totalAmount: String(totalAmount.toFixed(2)),
        status: 'pending_match',
        matchStatus: 'unmatched',
      }).returning();

      if (input.lines.length > 0) {
        await tx.insert(invoiceLines).values(
          input.lines.map((l) => ({
            invoiceId: inv.id,
            poLineId: l.poLineId ?? null,
            lineNumber: String(l.lineNumber),
            description: l.description,
            quantity: String(l.quantity),
            unitPrice: String(l.unitPrice),
            totalPrice: String((l.quantity * l.unitPrice).toFixed(2)),
            glAccount: l.glAccount ?? null,
          })),
        );
      }

      return inv.id;
    });

    // Auto-run 3-way match if PO is linked
    if (input.purchaseOrderId) {
      const matchResult = await this.matchingService.runMatch(invoiceId);
      const newStatus = matchResult.matchStatus === 'full_match' ? 'matched'
        : matchResult.matchStatus === 'exception' ? 'exception'
        : 'partial_match';
      await this.db.update(invoices)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId));
    }

    const created = await this.findOne(invoiceId, organizationId);
    this.audit.log(organizationId, null, 'invoice', invoiceId, 'created', { invoiceNumber: input.invoiceNumber, totalAmount: (created as any).totalAmount }).catch(() => {});
    if (input.purchaseOrderId) {
      const matchSt = (created as any).matchStatus;
      if (matchSt === 'exception') {
        this.webhookEvents.emit(organizationId, 'invoice.exception', { invoice: created });
        if (this.notifications) {
          this.notifications.create(
            organizationId,
            DEMO_ADMIN_USER_ID,
            'invoice_exception',
            'Invoice Match Exception',
            `Invoice ${(created as any).internalNumber} has a 3-way match exception and requires review.`,
            'invoice',
            invoiceId,
          ).catch(() => {});
        }
      } else {
        this.webhookEvents.emit(organizationId, 'invoice.matched', { invoice: created });
      }
    }
    return created;
  }

  async runMatch(id: string, organizationId: string) {
    await this.findOne(id, organizationId); // validate exists
    return this.matchingService.runMatch(id);
  }

  async markPaid(id: string, organizationId: string, userId: string, input?: MarkPaidInput) {
    const invoice = await this.findOne(id, organizationId);
    if ((invoice as any).status !== 'approved') {
      throw new BadRequestException('Only approved invoices can be marked as paid');
    }
    await this.db.update(invoices)
      .set({
        status: 'paid',
        paidAt: new Date(),
        paymentReference: input?.paymentReference ?? null,
        updatedAt: new Date(),
      } as any)
      .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));
    const updated = await this.findOne(id, organizationId);
    this.audit.log(organizationId, userId, 'invoice', id, 'paid', { totalAmount: (updated as any).totalAmount, paymentReference: input?.paymentReference }).catch(() => {});
    this.webhookEvents.emit(organizationId, 'invoice.paid', { invoice: updated });
    return updated;
  }

  async getAgingReport(organizationId: string): Promise<AgingReport> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch all unpaid invoices (paidAt IS NULL and status != 'paid')
    const unpaidInvoices = await this.db.query.invoices.findMany({
      where: (i, { and, eq, isNull, ne }) => and(
        eq(i.organizationId, organizationId),
        isNull(i.paidAt),
        ne(i.status, 'paid'),
      ),
      with: { vendor: true },
    });

    const emptyBucket = (): AgingBucket => ({ count: 0, totalAmount: '0.00' });

    const result: AgingReport = {
      current: emptyBucket(),
      days_1_30: emptyBucket(),
      days_31_60: emptyBucket(),
      days_61_90: emptyBucket(),
      days_90_plus: emptyBucket(),
    };

    const addToBucket = (bucket: AgingBucket, amount: string) => {
      bucket.count++;
      bucket.totalAmount = (parseFloat(bucket.totalAmount) + parseFloat(amount || '0')).toFixed(2);
    };

    for (const inv of unpaidInvoices) {
      const amount = (inv as any).totalAmount || '0';
      const dueDate = (inv as any).dueDate ? new Date((inv as any).dueDate) : null;

      if (!dueDate) {
        addToBucket(result.current, amount);
        continue;
      }

      dueDate.setHours(0, 0, 0, 0);
      const diffMs = today.getTime() - dueDate.getTime();
      const daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (daysOverdue <= 0) {
        addToBucket(result.current, amount);
      } else if (daysOverdue <= 30) {
        addToBucket(result.days_1_30, amount);
      } else if (daysOverdue <= 60) {
        addToBucket(result.days_31_60, amount);
      } else if (daysOverdue <= 90) {
        addToBucket(result.days_61_90, amount);
      } else {
        addToBucket(result.days_90_plus, amount);
      }
    }

    return result;
  }

  async getCashFlowForecast(organizationId: string): Promise<CashFlowWeek[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const twelveWeeksOut = new Date(today);
    twelveWeeksOut.setDate(twelveWeeksOut.getDate() + 7 * 12);

    // Build 12 weekly buckets
    const weeks: CashFlowWeek[] = [];
    for (let i = 0; i < 12; i++) {
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() + i * 7);
      weeks.push({ weekStart: weekStart.toISOString().split('T')[0], totalAmount: '0.00' });
    }

    const unpaidInvoices = await this.db.query.invoices.findMany({
      where: (i, { and, eq, isNull, ne }) => and(
        eq(i.organizationId, organizationId),
        isNull(i.paidAt),
        ne(i.status, 'paid'),
      ),
    });

    for (const inv of unpaidInvoices) {
      const dueDate = (inv as any).dueDate ? new Date((inv as any).dueDate) : null;
      if (!dueDate) continue;

      dueDate.setHours(0, 0, 0, 0);
      if (dueDate < today || dueDate > twelveWeeksOut) continue;

      const diffDays = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const weekIndex = Math.min(Math.floor(diffDays / 7), 11);
      const amount = parseFloat((inv as any).totalAmount || '0');
      weeks[weekIndex].totalAmount = (parseFloat(weeks[weekIndex].totalAmount) + amount).toFixed(2);
    }

    return weeks;
  }

  async getEarlyPaymentOpportunities(organizationId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + 14);

    const unpaidInvoices = await this.db.query.invoices.findMany({
      where: (i, { and, eq, isNull, ne }) => and(
        eq(i.organizationId, organizationId),
        isNull(i.paidAt),
        ne(i.status, 'paid'),
      ),
      with: { vendor: true },
    });

    return unpaidInvoices.filter((inv) => {
      const discountBy = (inv as any).earlyPaymentDiscountBy;
      if (!discountBy || !(inv as any).earlyPaymentDiscountPercent) return false;
      const discountDate = new Date(discountBy);
      discountDate.setHours(0, 0, 0, 0);
      return discountDate >= today && discountDate <= cutoff;
    });
  }

  async bulkApprove(ids: string[], organizationId: string, approverId: string) {
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (const id of ids) {
      try {
        await this.approve(id, organizationId, approverId);
        results.push({ id, success: true });
      } catch (err: any) {
        results.push({ id, success: false, error: err.message });
      }
    }
    return results;
  }

  async approve(id: string, organizationId: string, approverId: string) {
    const invoice = await this.findOne(id, organizationId);
    if (invoice.matchStatus === 'exception') {
      throw new BadRequestException('Cannot approve invoice with unresolved exceptions');
    }
    await this.db.update(invoices)
      .set({ status: 'approved', approvedBy: approverId, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));
    const approved = await this.findOne(id, organizationId);
    this.webhookEvents.emit(organizationId, 'invoice.approved', { invoice: approved });
    this.audit.log(organizationId, approverId, 'invoice', id, 'approved', { totalAmount: (approved as any).totalAmount }).catch(() => {});
    if (this.notifications) {
      this.notifications.create(
        organizationId,
        DEMO_ADMIN_USER_ID,
        'invoice_approved',
        'Invoice Approved',
        `Invoice ${(approved as any).internalNumber} has been approved for payment.`,
        'invoice',
        id,
      ).catch(() => {});
    }
    this.glExport.enqueue(organizationId, id, 'qbo');

    // Auto-track budget spend: resolve department via PO → Requisition
    if ((approved as any).purchaseOrderId) {
      try {
        const po = await this.db.query.purchaseOrders.findFirst({
          where: (p, { eq }) => eq(p.id, (approved as any).purchaseOrderId),
        });
        if (po?.requisitionId) {
          const req = await this.db.query.requisitions.findFirst({
            where: (r, { eq }) => eq(r.id, po.requisitionId!),
          });
          if (req?.departmentId) {
            const fiscalYear = new Date().getFullYear();
            await this.budgets.recordSpend(organizationId, req.departmentId, parseFloat((approved as any).totalAmount ?? '0'), fiscalYear);
          }
        }
      } catch {
        // Budget tracking is best-effort; never fail the approval
      }
    }

    return approved;
  }
}
