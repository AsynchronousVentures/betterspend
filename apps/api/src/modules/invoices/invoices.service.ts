import {
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, ne, isNull, lte, gte, or, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db, DbTransaction } from '@betterspend/db';
import { updateInvoiceSchema, type UpdateInvoiceInput } from '@betterspend/shared';
import {
  auditLog,
  invoices,
  invoiceLines,
  purchaseOrders,
  requisitions,
  vendors,
  approvalRequests,
} from '@betterspend/db';
import { SequenceService } from '../../common/services/sequence.service';
import { MatchingService } from './matching.service';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { GlExportService } from '../gl/gl-export.service';
import { BudgetsService } from '../budgets/budgets.service';
import {
  addMoney,
  convertMoney,
  normalizeMoney,
  normalizeRate,
} from '../budgets/budget-enforcement';
import { invoiceCommitmentAmounts } from '../budgets/budget-commitments';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EntitiesService } from '../entities/entities.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { SpendGuardService } from '../spend-guard/spend-guard.service';
import { SettingsService } from '../settings/settings.service';
import { resolveIndependentInvoiceApprover } from './invoice-approval-policy';
import { WorkflowExecutionService } from '../workflow-execution/workflow-execution.service';
import { changedMaterialInvoiceFields, type MaterialInvoiceState } from './invoice-material-edit';
import { calculateInvoiceLineAmounts } from './invoice-money';
import type { AccessPolicy } from '../auth/access-policy';
import { canViewRelatedRecord } from '../auth/related-record-access';
import { resolveOrganizationAdminId } from '../../common/demo-identity';
import {
  permissionScopePredicate,
  requireAnyPermission,
  requirePermission,
} from '../auth/access-scope';

type InvoiceLookupPermission =
  'invoices:view_all' | 'invoices:manage' | 'invoices:approve' | 'payments:manage';

type InvoiceAuthorizationScope = {
  entityId: string | null;
  createdBy: string | null;
  purchaseOrder?: {
    requisition?: {
      requesterId: string;
      departmentId: string | null;
      projectId: string | null;
    } | null;
  } | null;
};

function invoiceScopePredicates(organizationId: string) {
  const poScope = (condition: ReturnType<typeof sql>) =>
    sql`${invoices.purchaseOrderId} IN (
      SELECT ${purchaseOrders.id}
      FROM ${purchaseOrders}
      LEFT JOIN requisitions ON ${requisitions.id} = ${purchaseOrders.requisitionId}
      WHERE ${purchaseOrders.organizationId} = ${organizationId}
        AND ${condition}
    )`;
  return {
    own: (userId: string) => sql`(
      ${invoices.createdBy} = ${userId}
      OR ${poScope(sql`${requisitions.requesterId} = ${userId}`)}
    )`,
    department: (departmentId: string) =>
      poScope(sql`${requisitions.departmentId} = ${departmentId}`),
    project: (projectId: string) => poScope(sql`${requisitions.projectId} = ${projectId}`),
    entity: (entityId: string) => eq(invoices.entityId, entityId),
  };
}

function assertInvoiceScope(
  access: AccessPolicy | undefined,
  permission: 'invoices:create' | 'invoices:manage' | 'invoices:approve' | 'payments:manage',
  invoice: InvoiceAuthorizationScope,
  actorId: string,
) {
  requirePermission(access, permission);
  if (!access) return;
  const resource = permission === 'payments:manage' ? 'payment' : 'invoice';
  const scope = access.scopeFor(resource, permission);
  const purchaseOrder = invoice.purchaseOrder;
  if (
    scope.unrestricted ||
    scope.entityIds.includes(invoice.entityId ?? '') ||
    scope.departmentIds.includes(purchaseOrder?.requisition?.departmentId ?? '') ||
    scope.projectIds.includes(purchaseOrder?.requisition?.projectId ?? '') ||
    (scope.ownOnly &&
      (invoice.createdBy === actorId || purchaseOrder?.requisition?.requesterId === actorId))
  ) {
    return;
  }
  throw new ForbiddenException('You do not have permission to access this invoice');
}

function invoiceReportScopePredicate(access: AccessPolicy | undefined, organizationId: string) {
  return (
    or(
      permissionScopePredicate(
        access,
        'invoice',
        ['invoices:view_all'],
        invoiceScopePredicates(organizationId),
      ),
      permissionScopePredicate(access, 'payment', ['payments:view'], {
        entity: (entityId) => eq(invoices.entityId, entityId),
      }),
    ) ?? sql`false`
  );
}

export type { UpdateInvoiceInput } from '@betterspend/shared';


export interface CreateInvoiceInput {
  entityId?: string;
  purchaseOrderId?: string;
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  paymentTerms?: string;
  earlyPaymentDiscountPercent?: number;
  earlyPaymentDiscountBy?: string;
  currency?: string;
  exchangeRate?: number;
  lines: Array<{
    poLineId?: string;
    lineNumber: number;
    description: string;
    quantity: number;
    unitPrice: number;
    glAccount?: string;
    taxCodeId?: string;
    taxInclusive?: boolean;
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
  paymentReference: string;
  paymentDate: string;
  paymentMethod: string;
}

export interface ResolveExceptionInput {
  reason?: string;
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
    private readonly entitiesService: EntitiesService,
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly spendGuard: SpendGuardService,
    private readonly settingsService: SettingsService,
    private readonly workflowExecution: WorkflowExecutionService,
  ) {}

  private calculateLineTax(
    quantity: number,
    unitPrice: number,
    ratePercent: number,
    taxInclusive: boolean,
  ) {
    const rawAmount = quantity * unitPrice;
    if (taxInclusive) {
      const subtotal = ratePercent > 0 ? rawAmount / (1 + ratePercent / 100) : rawAmount;
      return {
        subtotal,
        taxAmount: rawAmount - subtotal,
        totalAmount: rawAmount,
      };
    }

    const subtotal = rawAmount;
    const taxAmount = subtotal * (ratePercent / 100);
    return {
      subtotal,
      taxAmount,
      totalAmount: subtotal + taxAmount,
    };
  }

  private parseDate(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} is invalid`);
    return parsed;
  }

  private dateKey(value: Date | string | null): string | null {
    if (value == null) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return parsed.toISOString().slice(0, 10);
  }

  private decimalKey(value: string | number | null): string | null {
    if (value == null) return null;
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
    if (!match) throw new BadRequestException(`Invalid decimal value "${value}"`);
    const whole = match[2].replace(/^0+(?=\d)/, '');
    const fraction = (match[3] ?? '').replace(/0+$/, '');
    return `${match[1]}${whole}${fraction ? `.${fraction}` : ''}`;
  }

  private materialState(
    invoice: typeof invoices.$inferSelect,
    lines: Array<typeof invoiceLines.$inferSelect>,
  ): MaterialInvoiceState {
    return {
      vendorId: invoice.vendorId,
      invoiceDate: this.dateKey(invoice.invoiceDate)!,
      dueDate: this.dateKey(invoice.dueDate),
      paymentTerms: invoice.paymentTerms,
      earlyPaymentDiscountPercent: this.decimalKey(invoice.earlyPaymentDiscountPercent),
      earlyPaymentDiscountBy: this.dateKey(invoice.earlyPaymentDiscountBy),
      currency: invoice.currency.toUpperCase(),
      exchangeRate: this.decimalKey(invoice.exchangeRate)!,
      lines: lines.map((line) => ({
        id: line.id,
        lineNumber: this.decimalKey(line.lineNumber)!,
        poLineId: line.poLineId,
        quantity: this.decimalKey(line.quantity)!,
        unitPrice: this.decimalKey(line.unitPrice)!,
        glAccount: line.glAccount,
        taxCodeId: line.taxCodeId,
        taxInclusive: line.taxInclusive,
      })),
    };
  }

  private async getTaxCodeMap(
    organizationId: string,
    taxCodeIds: string[],
    executor: Db | DbTransaction = this.db,
  ) {
    if (taxCodeIds.length === 0) return new Map<string, any>();
    const records = await executor.query.taxCodes.findMany({
      where: (record, { and, eq, inArray }) =>
        and(eq(record.orgId, organizationId), inArray(record.id, taxCodeIds)),
    });
    if (records.length !== taxCodeIds.length) {
      throw new BadRequestException('One or more tax codes are invalid for this organization');
    }
    return new Map(records.map((record) => [record.id, record]));
  }

  async findAll(organizationId: string, entityId?: string, access?: AccessPolicy) {
    return this.db.query.invoices.findMany({
      where: (i, { and, eq }) =>
        and(
          eq(i.organizationId, organizationId),
          entityId ? eq(i.entityId, entityId) : undefined,
          permissionScopePredicate(
            access,
            'invoice',
            ['invoices:view_all', 'invoices:manage', 'invoices:approve'],
            invoiceScopePredicates(organizationId),
          ),
        ),
      with: { vendor: true, purchaseOrder: true, entity: true },
      orderBy: (i, { desc }) => desc(i.createdAt),
    });
  }

  private async findOneWithExecutor(
    id: string,
    organizationId: string,
    executor: Db | DbTransaction,
  ) {
    const invoice = await executor.query.invoices.findFirst({
      where: (i, { and, eq }) => and(eq(i.id, id), eq(i.organizationId, organizationId)),
      with: {
        vendor: true,
        entity: true,
        purchaseOrder: { with: { lines: true } },
        lines: { with: { matchResults: true, taxCode: true } },
      },
    });
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }

  private async findOneWithAuthorizationScope(
    id: string,
    organizationId: string,
    access: AccessPolicy,
    permissions: readonly InvoiceLookupPermission[] = [
      'invoices:view_all',
      'invoices:manage',
      'invoices:approve',
    ],
    resource: 'invoice' | 'payment' = 'invoice',
  ) {
    const invoice = await this.db.query.invoices.findFirst({
      where: (i, { and, eq }) =>
        and(
          eq(i.id, id),
          eq(i.organizationId, organizationId),
          permissionScopePredicate(
            access,
            resource,
            permissions,
            invoiceScopePredicates(organizationId),
          ),
        ),
      with: {
        vendor: true,
        entity: true,
        purchaseOrder: {
          with: {
            lines: true,
            requisition: true,
            goodsReceipts: { columns: { id: true, number: true, status: true } },
          },
        },
        lines: { with: { matchResults: true, taxCode: true } },
        paymentRunInvoices: {
          columns: { paymentRunId: true },
          with: {
            paymentRun: { columns: { id: true, status: true, entityId: true } },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);

    const purchaseOrder = invoice.purchaseOrder;
    const authorizationScope: InvoiceAuthorizationScope = {
      entityId: invoice.entityId,
      createdBy: invoice.createdBy,
      purchaseOrder: purchaseOrder
        ? {
            requisition: purchaseOrder.requisition
              ? {
                  requesterId: purchaseOrder.requisition.requesterId,
                  departmentId: purchaseOrder.requisition.departmentId,
                  projectId: purchaseOrder.requisition.projectId,
                }
              : null,
          }
        : null,
    };
    const purchaseOrderScope = {
      ownerIds: [purchaseOrder?.issuedBy, purchaseOrder?.requisition?.requesterId],
      departmentId: purchaseOrder?.requisition?.departmentId,
      projectId: purchaseOrder?.requisition?.projectId,
      entityId: purchaseOrder?.entityId,
    };
    const relatedRecordScope = {
      ownerIds: [invoice.createdBy, purchaseOrder?.requisition?.requesterId],
      departmentId: purchaseOrder?.requisition?.departmentId,
      projectId: purchaseOrder?.requisition?.projectId,
      entityId: invoice.entityId ?? purchaseOrder?.entityId,
    };
    const visiblePurchaseOrder =
      purchaseOrder &&
      canViewRelatedRecord(
        access,
        'purchase_order',
        [
          'purchase_orders:view_all',
          'purchase_orders:view_own',
          'purchase_orders:manage',
          'purchase_orders:issue',
        ],
        purchaseOrderScope,
      )
        ? purchaseOrder
        : null;
    const visibleRequisition =
      visiblePurchaseOrder?.requisition &&
      canViewRelatedRecord(
        access,
        'requisition',
        ['requisitions:view_all', 'requisitions:view_own', 'requisitions:manage'],
        {
          ownerIds: [visiblePurchaseOrder.requisition.requesterId],
          departmentId: visiblePurchaseOrder.requisition.departmentId,
          projectId: visiblePurchaseOrder.requisition.projectId,
        },
      )
        ? visiblePurchaseOrder.requisition
        : null;
    const goodsReceipts = visiblePurchaseOrder
      ? (visiblePurchaseOrder.goodsReceipts ?? []).filter(() =>
          canViewRelatedRecord(
            access,
            'receiving',
            ['receiving:view', 'receiving:manage'],
            purchaseOrderScope,
          ),
        )
      : [];
    const paymentRuns = (invoice.paymentRunInvoices ?? []).flatMap((paymentRunInvoice) => {
      const paymentRun = paymentRunInvoice.paymentRun;
      if (
        !paymentRun ||
        !canViewRelatedRecord(access, 'payment', ['payments:view', 'payments:manage'], {
          entityId: paymentRun.entityId,
        })
      ) {
        return [];
      }
      return [{ id: paymentRun.id, status: paymentRun.status }];
    });
    const visibleVendor =
      invoice.vendor &&
      canViewRelatedRecord(access, 'vendor', ['vendors:view'], {
        entityId: invoice.vendor.entityId,
      })
        ? invoice.vendor
        : null;
    const activeApproval = canViewRelatedRecord(
      access,
      'approval',
      ['approvals:view', 'approvals:act'],
      relatedRecordScope,
    )
      ? await this.db.query.approvalRequests.findFirst({
          where: (approval, { and, eq }) =>
            and(
              eq(approval.organizationId, organizationId),
              eq(approval.approvableType, 'invoice'),
              eq(approval.approvableId, id),
              eq(approval.status, 'pending'),
            ),
          columns: { id: true, currentStep: true, status: true },
        })
      : null;
    const { paymentRunInvoices: _paymentRunInvoices, ...invoiceRecord } = invoice;
    return {
      invoice: {
        ...invoiceRecord,
        vendor: visibleVendor,
        purchaseOrder: visiblePurchaseOrder
          ? {
              ...visiblePurchaseOrder,
              requisition: visibleRequisition
                ? { id: visibleRequisition.id, number: visibleRequisition.number }
                : null,
              goodsReceipts,
            }
          : null,
        paymentRuns,
        activeApproval,
      },
      authorizationScope,
    };
  }

  async findOne(
    id: string,
    organizationId: string,
    access?: AccessPolicy,
    permissions: readonly InvoiceLookupPermission[] = [
      'invoices:view_all',
      'invoices:manage',
      'invoices:approve',
    ],
    resource: 'invoice' | 'payment' = 'invoice',
  ) {
    if (!access) return this.findOneWithExecutor(id, organizationId, this.db);
    const { invoice } = await this.findOneWithAuthorizationScope(
      id,
      organizationId,
      access,
      permissions,
      resource,
    );
    return invoice;
  }

  async update(
    id: string,
    organizationId: string,
    actorId: string,
    rawInput: UpdateInvoiceInput,
    access?: AccessPolicy,
  ) {
    const input = updateInvoiceSchema.parse(rawInput);
    if (access) {
      const { authorizationScope } = await this.findOneWithAuthorizationScope(
        id,
        organizationId,
        access,
      );
      assertInvoiceScope(access, 'invoices:manage', authorizationScope, actorId);
    }
    const result = await this.db.transaction(async (tx) => {
      const [lockedInvoice] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)))
        .for('update');
      if (!lockedInvoice) throw new NotFoundException(`Invoice ${id} not found`);
      if (lockedInvoice.status === 'paid') {
        throw new BadRequestException('Paid invoices cannot be edited');
      }
      if (lockedInvoice.status === 'cancelled') {
        throw new BadRequestException('Cancelled invoices cannot be edited');
      }

      const existingLines = await tx.query.invoiceLines.findMany({
        where: (line, { eq }) => eq(line.invoiceId, id),
        orderBy: (line, { asc }) => asc(line.lineNumber),
      });
      const patches = new Map((input.lines ?? []).map((line) => [line.id, line]));
      if (patches.size !== (input.lines ?? []).length) {
        throw new BadRequestException('Invoice line edits must contain unique IDs');
      }
      for (const lineId of patches.keys()) {
        if (!existingLines.some((line) => line.id === lineId)) {
          throw new BadRequestException(`Invoice line ${lineId} does not belong to invoice ${id}`);
        }
      }

      const requestedPoLineIds = [
        ...new Set(
          (input.lines ?? [])
            .filter((line) => line.poLineId !== undefined && line.poLineId !== null)
            .map((line) => line.poLineId!),
        ),
      ];
      if (requestedPoLineIds.length > 0) {
        if (!lockedInvoice.purchaseOrderId) {
          throw new BadRequestException('Invoice lines require a linked purchase order');
        }
        const purchaseOrder = await tx.query.purchaseOrders.findFirst({
          where: (record, { and, eq }) =>
            and(
              eq(record.id, lockedInvoice.purchaseOrderId!),
              eq(record.organizationId, organizationId),
            ),
          columns: { id: true },
        });
        if (!purchaseOrder) {
          throw new BadRequestException(
            `Purchase order ${lockedInvoice.purchaseOrderId} not found`,
          );
        }
        const validPoLines = await tx.query.poLines.findMany({
          where: (record, { and, eq, inArray }) =>
            and(
              eq(record.purchaseOrderId, purchaseOrder.id),
              inArray(record.id, requestedPoLineIds),
            ),
          columns: { id: true },
        });
        if (validPoLines.length !== requestedPoLineIds.length) {
          throw new BadRequestException(
            'Invoice line references must belong to the linked purchase order',
          );
        }
      }

      if (input.vendorId !== undefined && input.vendorId !== lockedInvoice.vendorId) {
        const vendor = await tx.query.vendors.findFirst({
          where: (record, { and, eq }) =>
            and(eq(record.id, input.vendorId!), eq(record.organizationId, organizationId)),
          columns: { id: true },
        });
        if (!vendor) throw new BadRequestException(`Vendor ${input.vendorId} not found`);
        if (lockedInvoice.purchaseOrderId) {
          const purchaseOrder = await tx.query.purchaseOrders.findFirst({
            where: (record, { and, eq }) =>
              and(
                eq(record.id, lockedInvoice.purchaseOrderId!),
                eq(record.organizationId, organizationId),
              ),
            columns: { vendorId: true },
          });
          if (!purchaseOrder) {
            throw new BadRequestException(
              `Purchase order ${lockedInvoice.purchaseOrderId} not found`,
            );
          }
          if (purchaseOrder.vendorId !== input.vendorId) {
            throw new BadRequestException(
              'A PO-backed invoice vendor must match its purchase order vendor',
            );
          }
        }
        const duplicate = await tx.query.invoices.findFirst({
          where: (record, { and, eq, ne }) =>
            and(
              eq(record.organizationId, organizationId),
              eq(record.vendorId, input.vendorId!),
              eq(record.invoiceNumber, lockedInvoice.invoiceNumber),
              ne(record.id, id),
            ),
          columns: { id: true },
        });
        if (duplicate) {
          throw new BadRequestException(
            `Duplicate invoice: ${lockedInvoice.invoiceNumber} already exists for this vendor`,
          );
        }
      }

      const currency = (input.currency ?? lockedInvoice.currency).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new BadRequestException('Currency must be a 3-letter currency code');
      }
      const baseCurrency = await this.exchangeRatesService.getOrganizationBaseCurrency(
        organizationId,
        tx,
      );
      const exchangeRate = normalizeRate(
        await this.exchangeRatesService.getRateDecimal(
          organizationId,
          currency,
          baseCurrency,
          input.exchangeRate !== undefined
            ? input.exchangeRate.toFixed(8)
            : currency === lockedInvoice.currency
              ? lockedInvoice.exchangeRate
              : undefined,
          tx,
        ),
      );
      const nextLines = existingLines.map((line) => {
        const patch = patches.get(line.id);
        return {
          ...line,
          lineNumber: patch?.lineNumber !== undefined ? String(patch.lineNumber) : line.lineNumber,
          poLineId: patch?.poLineId !== undefined ? patch.poLineId : line.poLineId,
          description: patch?.description ?? line.description,
          quantity:
            patch?.quantity !== undefined
              ? normalizeMoney(String(patch.quantity))
              : normalizeMoney(line.quantity),
          unitPrice:
            patch?.unitPrice !== undefined
              ? normalizeMoney(String(patch.unitPrice))
              : normalizeMoney(line.unitPrice),
          glAccount: patch?.glAccount !== undefined ? patch.glAccount : line.glAccount,
          taxCodeId: patch?.taxCodeId !== undefined ? patch.taxCodeId : line.taxCodeId,
          taxInclusive: patch?.taxInclusive ?? line.taxInclusive,
        };
      });
      const taxCodeMap = await this.getTaxCodeMap(
        organizationId,
        [...new Set(nextLines.map((line) => line.taxCodeId).filter((id): id is string => !!id))],
        tx,
      );
      const lineAmounts = nextLines.map((line) => {
        const taxCode = line.taxCodeId ? taxCodeMap.get(line.taxCodeId) : null;
        return calculateInvoiceLineAmounts(
          line.quantity,
          line.unitPrice,
          String(taxCode?.ratePercent ?? '0'),
          line.taxInclusive,
        );
      });
      const subtotal = addMoney(lineAmounts.map((line) => line.subtotal));
      const taxAmount = addMoney(lineAmounts.map((line) => line.taxAmount));
      const totalAmount = addMoney(lineAmounts.map((line) => line.totalAmount));
      const editedAt = new Date();
      const nextInvoice = {
        ...lockedInvoice,
        vendorId: input.vendorId ?? lockedInvoice.vendorId,
        invoiceDate:
          input.invoiceDate !== undefined
            ? this.parseDate(input.invoiceDate, 'Invoice date')
            : lockedInvoice.invoiceDate,
        dueDate:
          input.dueDate !== undefined
            ? input.dueDate === null
              ? null
              : this.parseDate(input.dueDate, 'Due date')
            : lockedInvoice.dueDate,
        paymentTerms:
          input.paymentTerms !== undefined ? input.paymentTerms : lockedInvoice.paymentTerms,
        earlyPaymentDiscountPercent:
          input.earlyPaymentDiscountPercent !== undefined
            ? input.earlyPaymentDiscountPercent === null
              ? null
              : String(input.earlyPaymentDiscountPercent)
            : lockedInvoice.earlyPaymentDiscountPercent,
        earlyPaymentDiscountBy:
          input.earlyPaymentDiscountBy !== undefined
            ? input.earlyPaymentDiscountBy === null
              ? null
              : this.dateKey(
                  this.parseDate(input.earlyPaymentDiscountBy, 'Early payment discount date'),
                )
            : lockedInvoice.earlyPaymentDiscountBy,
        currency,
        baseCurrency,
        exchangeRate,
        subtotal,
        taxAmount,
        totalAmount,
        baseSubtotal: convertMoney(subtotal, exchangeRate),
        baseTaxAmount: convertMoney(taxAmount, exchangeRate),
        baseTotalAmount: convertMoney(totalAmount, exchangeRate),
        updatedAt: editedAt,
      };
      const changedFields = changedMaterialInvoiceFields(
        this.materialState(lockedInvoice, existingLines),
        this.materialState(nextInvoice, nextLines),
      );
      const material = changedFields.length > 0;
      const persistedInvoice = material
        ? nextInvoice
        : {
            ...nextInvoice,
            baseCurrency: lockedInvoice.baseCurrency,
            exchangeRate: lockedInvoice.exchangeRate,
            subtotal: lockedInvoice.subtotal,
            taxAmount: lockedInvoice.taxAmount,
            totalAmount: lockedInvoice.totalAmount,
            baseSubtotal: lockedInvoice.baseSubtotal,
            baseTaxAmount: lockedInvoice.baseTaxAmount,
            baseTotalAmount: lockedInvoice.baseTotalAmount,
          };

      if (material && lockedInvoice.status === 'approved') {
        await this.budgets.reopenInvoice(tx, organizationId, id, editedAt);
      }
      await tx
        .update(invoices)
        .set({
          vendorId: persistedInvoice.vendorId,
          invoiceDate: persistedInvoice.invoiceDate,
          dueDate: persistedInvoice.dueDate,
          paymentTerms: persistedInvoice.paymentTerms,
          earlyPaymentDiscountPercent: persistedInvoice.earlyPaymentDiscountPercent,
          earlyPaymentDiscountBy: persistedInvoice.earlyPaymentDiscountBy,
          currency: persistedInvoice.currency,
          baseCurrency: persistedInvoice.baseCurrency,
          exchangeRate: persistedInvoice.exchangeRate,
          subtotal: persistedInvoice.subtotal,
          taxAmount: persistedInvoice.taxAmount,
          totalAmount: persistedInvoice.totalAmount,
          baseSubtotal: persistedInvoice.baseSubtotal,
          baseTaxAmount: persistedInvoice.baseTaxAmount,
          baseTotalAmount: persistedInvoice.baseTotalAmount,
          ...(material
            ? {
                status: lockedInvoice.matchStatus === 'full_match' ? 'matched' : 'pending_match',
                approvedBy: null,
                approvedAt: null,
              }
            : {}),
          updatedAt: editedAt,
        })
        .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));

      for (const [index, line] of nextLines.entries()) {
        const amounts = lineAmounts[index];
        await tx
          .update(invoiceLines)
          .set({
            lineNumber: line.lineNumber,
            poLineId: line.poLineId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            glAccount: line.glAccount,
            taxCodeId: line.taxCodeId,
            taxInclusive: line.taxInclusive,
            taxAmount: material ? amounts.taxAmount : line.taxAmount,
            totalPrice: material ? amounts.totalAmount : line.totalPrice,
            exchangeRate: material ? exchangeRate : line.exchangeRate,
            baseUnitPrice: material
              ? convertMoney(line.unitPrice, exchangeRate)
              : line.baseUnitPrice,
            baseTotalPrice: material
              ? convertMoney(amounts.totalAmount, exchangeRate)
              : line.baseTotalPrice,
            updatedAt: editedAt,
          })
          .where(and(eq(invoiceLines.id, line.id), eq(invoiceLines.invoiceId, id)));
      }

      let approvalEligible =
        lockedInvoice.purchaseOrderId !== null && lockedInvoice.matchStatus === 'full_match';
      if (material && lockedInvoice.purchaseOrderId) {
        const match = await this.matchingService.runMatch(id, tx);
        approvalEligible = match.matchStatus === 'full_match';
        const status =
          match.matchStatus === 'full_match'
            ? 'matched'
            : match.matchStatus === 'exception'
              ? 'exception'
              : 'partial_match';
        await tx
          .update(invoices)
          .set({ status, updatedAt: editedAt })
          .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));
      }

      let publishRequestId: string | null = null;
      let approvalRequestId: string | null = null;
      if (material) {
        const currentRequest = await tx.query.approvalRequests.findFirst({
          where: (request, { and, eq, inArray, isNotNull }) =>
            and(
              eq(request.organizationId, organizationId),
              eq(request.approvableType, 'invoice'),
              eq(request.approvableId, id),
              isNotNull(request.definitionVersionId),
              inArray(request.status, ['pending', 'approved']),
            ),
          orderBy: (request, { desc }) => desc(request.createdAt),
        });
        if (currentRequest) {
          if (approvalEligible) {
            await tx
              .update(invoices)
              .set({ status: 'pending_approval', updatedAt: editedAt })
              .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));
            const restarted = await this.workflowExecution.restartOnLatestInTransaction(
              currentRequest.id,
              organizationId,
              actorId,
              tx,
              { allowApproved: true },
            );
            publishRequestId = restarted.replacementRequestId;
            approvalRequestId = restarted.replacementRequestId;
            if (restarted.status === 'pending') {
              await tx
                .update(invoices)
                .set({ status: 'pending_approval', updatedAt: editedAt })
                .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));
            }
          } else {
            await this.workflowExecution.cancelForEditInTransaction(
              currentRequest.id,
              organizationId,
              actorId,
              tx,
              { allowApproved: true },
            );
          }
        } else if (approvalEligible) {
          await tx
            .update(invoices)
            .set({ status: 'pending_approval', updatedAt: editedAt })
            .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));
          const initiated = await this.workflowExecution.initiateIfConfigured(
            organizationId,
            'invoice',
            id,
            actorId,
            undefined,
            undefined,
            tx,
          );
          if (!initiated) {
            await tx
              .update(invoices)
              .set({ status: 'matched', updatedAt: editedAt })
              .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));
          } else {
            publishRequestId = initiated.requestId;
            approvalRequestId = initiated.requestId;
          }
        }
      }

      await this.audit.log(
        organizationId,
        actorId,
        'invoice',
        id,
        material ? 'material_edit_reapproval' : 'updated',
        {
          material,
          changedFields,
          approvalRequestId,
        },
        undefined,
        tx,
      );
      return {
        invoice: await this.findOneWithExecutor(id, organizationId, tx),
        publishRequestId,
      };
    });

    if (result.publishRequestId) {
      await this.workflowExecution.publishCommittedRequest(result.publishRequestId, organizationId);
    }
    return result.invoice;
  }

  async create(
    organizationId: string,
    createdBy: string,
    input: CreateInvoiceInput,
    access?: AccessPolicy,
  ) {
    requirePermission(access, 'invoices:create');
    let resolvedEntityId = input.entityId ?? null;
    let resolvedCurrency = input.currency ?? 'USD';
    let resolvedExchangeRate = input.exchangeRate ?? null;
    let linkedPurchaseOrder: {
      id: string;
      entityId: string | null;
      currency: string;
      exchangeRate: string;
      requisition?: {
        requesterId: string;
        departmentId: string | null;
        projectId: string | null;
      } | null;
    } | null = null;
    if (input.purchaseOrderId) {
      const po = await this.db.query.purchaseOrders.findFirst({
        where: (record, { and, eq }) =>
          and(eq(record.id, input.purchaseOrderId!), eq(record.organizationId, organizationId)),
        with: { requisition: true },
      });
      if (!po) throw new BadRequestException(`Purchase order ${input.purchaseOrderId} not found`);
      if (input.entityId && po.entityId && input.entityId !== po.entityId) {
        throw new BadRequestException('Invoice entity must match the linked purchase order entity');
      }
      linkedPurchaseOrder = po;
      resolvedEntityId = po.entityId ?? resolvedEntityId;
      resolvedCurrency = input.currency ?? po.currency;
      resolvedExchangeRate = input.exchangeRate ?? Number(po.exchangeRate ?? '1');
    }
    await this.entitiesService.assertBelongsToOrg(organizationId, resolvedEntityId);
    assertInvoiceScope(
      access,
      'invoices:create',
      {
        entityId: resolvedEntityId,
        createdBy,
        purchaseOrder: linkedPurchaseOrder,
      },
      createdBy,
    );

    // Duplicate invoice detection: same vendor + same invoice number in this org
    const duplicate = await this.db.query.invoices.findFirst({
      where: (i, { and, eq }) =>
        and(
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

    const taxCodeMap = await this.getTaxCodeMap(
      organizationId,
      input.lines.map((line) => line.taxCodeId).filter((value): value is string => !!value),
    );

    const lineAmounts = input.lines.map((line) => {
      const taxCode = line.taxCodeId ? taxCodeMap.get(line.taxCodeId) : null;
      const ratePercent = taxCode ? parseFloat(String(taxCode.ratePercent ?? '0')) : 0;
      return this.calculateLineTax(line.quantity, line.unitPrice, ratePercent, !!line.taxInclusive);
    });
    const subtotal = lineAmounts.reduce((sum, line) => sum + line.subtotal, 0);
    const taxAmount = lineAmounts.reduce((sum, line) => sum + line.taxAmount, 0);
    const totalAmount = lineAmounts.reduce((sum, line) => sum + line.totalAmount, 0);
    const { baseCurrency, exchangeRate, baseAmount } =
      await this.exchangeRatesService.convertToBase(
        organizationId,
        totalAmount,
        resolvedCurrency,
        resolvedExchangeRate,
      );

    const invoiceId = await this.db.transaction(async (tx) => {
      const internalNumber = await this.sequenceService.next(organizationId, 'invoice', tx);
      const [inv] = await tx
        .insert(invoices)
        .values({
          organizationId,
          purchaseOrderId: input.purchaseOrderId ?? null,
          entityId: resolvedEntityId,
          vendorId: input.vendorId,
          createdBy,
          submissionSource: 'internal',
          invoiceNumber: input.invoiceNumber,
          internalNumber,
          invoiceDate: new Date(input.invoiceDate),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          paymentTerms: input.paymentTerms ?? null,
          earlyPaymentDiscountPercent:
            input.earlyPaymentDiscountPercent != null
              ? String(input.earlyPaymentDiscountPercent)
              : null,
          earlyPaymentDiscountBy: input.earlyPaymentDiscountBy ?? null,
          currency: resolvedCurrency,
          baseCurrency,
          exchangeRate: String(exchangeRate),
          subtotal: String(subtotal.toFixed(2)),
          taxAmount: String(taxAmount.toFixed(2)),
          totalAmount: String(totalAmount.toFixed(2)),
          baseSubtotal: String(
            this.exchangeRatesService.roundMoney(subtotal * exchangeRate).toFixed(2),
          ),
          baseTaxAmount: String(
            this.exchangeRatesService.roundMoney(taxAmount * exchangeRate).toFixed(2),
          ),
          baseTotalAmount: String(baseAmount.toFixed(2)),
          status: 'pending_match',
          matchStatus: 'unmatched',
        })
        .returning();

      if (input.lines.length > 0) {
        await tx.insert(invoiceLines).values(
          input.lines.map((l, index) => {
            const amounts = lineAmounts[index];
            return {
              invoiceId: inv.id,
              poLineId: l.poLineId ?? null,
              lineNumber: String(l.lineNumber),
              description: l.description,
              quantity: String(l.quantity),
              unitPrice: String(l.unitPrice),
              taxCodeId: l.taxCodeId ?? null,
              taxAmount: String(amounts.taxAmount.toFixed(2)),
              taxInclusive: l.taxInclusive ?? false,
              totalPrice: String(amounts.totalAmount.toFixed(2)),
              exchangeRate: String(exchangeRate),
              baseUnitPrice: String(
                this.exchangeRatesService.roundMoney(l.unitPrice * exchangeRate).toFixed(2),
              ),
              baseTotalPrice: String(
                this.exchangeRatesService.roundMoney(amounts.totalAmount * exchangeRate).toFixed(2),
              ),
              glAccount: l.glAccount ?? null,
            };
          }),
        );
      }

      await tx.insert(auditLog).values({
        organizationId,
        userId: createdBy,
        entityType: 'invoice',
        entityId: inv.id,
        action: 'created',
        changes: {
          invoiceNumber: input.invoiceNumber,
          totalAmount: totalAmount.toFixed(2),
        },
      });

      return inv.id;
    });

    // Auto-run 3-way match if PO is linked
    if (input.purchaseOrderId) {
      const matchResult = await this.matchingService.runMatch(invoiceId);
      const newStatus =
        matchResult.matchStatus === 'full_match'
          ? 'matched'
          : matchResult.matchStatus === 'exception'
            ? 'exception'
            : 'partial_match';
      await this.db
        .update(invoices)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId));
    }

    const created = await this.findOne(invoiceId, organizationId);
    if (input.purchaseOrderId) {
      const matchSt = (created as any).matchStatus;
      if (matchSt === 'exception') {
        this.webhookEvents.emit(organizationId, 'invoice.exception', { invoice: created });
        if (this.notifications) {
          void resolveOrganizationAdminId(this.db, organizationId)
            .then((adminId) => {
              if (!adminId) return;
              return this.notifications!.create(
                organizationId,
                adminId,
                'invoice_exception',
                'Invoice Match Exception',
                `Invoice ${(created as any).internalNumber} has a 3-way match exception and requires review.`,
                'invoice',
                invoiceId,
              );
            })
            .catch(() => {});
        }
      } else {
        this.webhookEvents.emit(organizationId, 'invoice.matched', { invoice: created });
      }
    }
    await this.spendGuard.analyzeInvoice(organizationId, invoiceId).catch(() => {});
    return created;
  }

  async runMatch(id: string, organizationId: string, actorId: string, access?: AccessPolicy) {
    if (access) {
      const { authorizationScope } = await this.findOneWithAuthorizationScope(
        id,
        organizationId,
        access,
      );
      assertInvoiceScope(access, 'invoices:manage', authorizationScope, actorId);
    }
    const outcome = await this.db.transaction(async (tx) => {
      const [lockedInvoice] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)))
        .for('update');
      if (!lockedInvoice) throw new NotFoundException(`Invoice ${id} not found`);
      if (lockedInvoice.status === 'paid' || lockedInvoice.status === 'cancelled') {
        throw new BadRequestException(`${lockedInvoice.status} invoices cannot be rematched`);
      }

      const currentRequest = await tx.query.approvalRequests.findFirst({
        where: (request, { and, eq, inArray, isNotNull }) =>
          and(
            eq(request.organizationId, organizationId),
            eq(request.approvableType, 'invoice'),
            eq(request.approvableId, id),
            isNotNull(request.definitionVersionId),
            inArray(request.status, ['pending', 'approved']),
          ),
        orderBy: (request, { desc }) => desc(request.createdAt),
      });

      const match = await this.matchingService.runMatch(id, tx);
      let publishRequestId: string | null = null;
      if (
        match.matchStatus === 'full_match' &&
        lockedInvoice.status !== 'approved' &&
        lockedInvoice.status !== 'pending_approval'
      ) {
        await tx
          .update(invoices)
          .set({ status: 'pending_approval', updatedAt: new Date() })
          .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));
        const initiated = await this.workflowExecution.initiateIfConfigured(
          organizationId,
          'invoice',
          id,
          actorId,
          undefined,
          undefined,
          tx,
        );
        if (initiated) {
          publishRequestId = initiated.requestId;
        } else {
          await tx
            .update(invoices)
            .set({ status: 'matched', updatedAt: new Date() })
            .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));
        }
      } else if (match.matchStatus !== 'full_match') {
        const rematchStatus = match.matchStatus === 'exception' ? 'exception' : 'partial_match';
        if (lockedInvoice.status === 'approved') {
          await this.budgets.reopenInvoice(tx, organizationId, id, new Date());
        }
        await tx
          .update(invoices)
          .set({
            status: rematchStatus,
            approvedBy: null,
            approvedAt: null,
            updatedAt: new Date(),
          })
          .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));
        if (currentRequest) {
          await this.workflowExecution.cancelForEditInTransaction(
            currentRequest.id,
            organizationId,
            actorId,
            tx,
            { allowApproved: true, reason: 'invoice_match_invalidated' },
          );
        }
      }
      await tx.insert(auditLog).values({
        organizationId,
        userId: actorId,
        entityType: 'invoice',
        entityId: id,
        action: 'rematched',
        changes: {
          previousStatus: lockedInvoice.status,
          matchStatus: match.matchStatus,
          workflowRequestId: publishRequestId,
        },
      });
      return { match, publishRequestId };
    });
    if (outcome.publishRequestId) {
      await this.workflowExecution.publishCommittedRequest(
        outcome.publishRequestId,
        organizationId,
      );
    }
    return outcome.match;
  }

  async markPaid(
    id: string,
    organizationId: string,
    userId: string,
    input?: MarkPaidInput,
    access?: AccessPolicy,
  ) {
    const paymentReference =
      typeof input?.paymentReference === 'string' ? input.paymentReference.trim() : '';
    const paymentMethod =
      typeof input?.paymentMethod === 'string' ? input.paymentMethod.trim() : '';
    const paymentDate = typeof input?.paymentDate === 'string' ? input.paymentDate.trim() : '';
    if (!paymentReference || !paymentMethod || !paymentDate) {
      throw new BadRequestException('Payment date, method, and external reference are required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      throw new BadRequestException('Payment date must use YYYY-MM-DD');
    }
    const paidAt = new Date(`${paymentDate}T12:00:00.000Z`);
    if (Number.isNaN(paidAt.getTime()) || paidAt.toISOString().slice(0, 10) !== paymentDate) {
      throw new BadRequestException('Payment date is invalid');
    }
    let invoice;
    if (access) {
      const scoped = await this.findOneWithAuthorizationScope(
        id,
        organizationId,
        access,
        ['payments:manage'],
        'payment',
      );
      assertInvoiceScope(access, 'payments:manage', scoped.authorizationScope, userId);
      invoice = scoped.invoice;
    } else {
      invoice = await this.findOne(id, organizationId, access, ['payments:manage'], 'payment');
    }
    if ((invoice as any).status !== 'approved') {
      throw new BadRequestException('Only approved invoices can be marked as paid');
    }
    const [transitioned] = await this.db
      .update(invoices)
      .set({
        status: 'paid',
        paidAt,
        paymentReference,
        updatedAt: new Date(),
      } as any)
      .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));
    const updated = await this.findOne(id, organizationId);
    this.audit
      .log(organizationId, userId, 'invoice', id, 'paid', {
        totalAmount: (updated as any).totalAmount,
        paymentDate,
        paymentMethod,
        paymentReference,
      })
      .catch(() => {});
    this.webhookEvents.emit(organizationId, 'invoice.paid', { invoice: updated });
    return updated;
  }

  async getAgingReport(organizationId: string, access?: AccessPolicy): Promise<AgingReport> {
    requireAnyPermission(access, ['invoices:view_all', 'payments:view']);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch all unpaid invoices (paidAt IS NULL and status != 'paid')
    const unpaidInvoices = await this.db.query.invoices.findMany({
      where: (i, { and, eq, isNull, ne }) =>
        and(
          eq(i.organizationId, organizationId),
          isNull(i.paidAt),
          ne(i.status, 'paid'),
          invoiceReportScopePredicate(access, organizationId),
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

  async getCashFlowForecast(
    organizationId: string,
    access?: AccessPolicy,
  ): Promise<CashFlowWeek[]> {
    requireAnyPermission(access, ['invoices:view_all', 'payments:view']);
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
      where: (i, { and, eq, isNull, ne }) =>
        and(
          eq(i.organizationId, organizationId),
          isNull(i.paidAt),
          ne(i.status, 'paid'),
          invoiceReportScopePredicate(access, organizationId),
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

  async getEarlyPaymentOpportunities(organizationId: string, access?: AccessPolicy) {
    requireAnyPermission(access, ['invoices:view_all', 'payments:view']);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + 14);

    const unpaidInvoices = await this.db.query.invoices.findMany({
      where: (i, { and, eq, isNull, ne }) =>
        and(
          eq(i.organizationId, organizationId),
          isNull(i.paidAt),
          ne(i.status, 'paid'),
          invoiceReportScopePredicate(access, organizationId),
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

  async bulkApprove(
    ids: string[],
    organizationId: string,
    approverId: string,
    access?: AccessPolicy,
  ) {
    requirePermission(access, 'invoices:approve');
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (const id of ids) {
      try {
        await this.approve(id, organizationId, approverId, access);
        results.push({ id, success: true });
      } catch (err: any) {
        results.push({ id, success: false, error: err.message });
      }
    }
    return results;
  }

  async resolveException(
    id: string,
    organizationId: string,
    reviewerId: string,
    input?: ResolveExceptionInput,
    access?: AccessPolicy,
  ) {
    let invoice;
    if (access) {
      const scoped = await this.findOneWithAuthorizationScope(id, organizationId, access);
      assertInvoiceScope(access, 'invoices:manage', scoped.authorizationScope, reviewerId);
      invoice = scoped.invoice;
    } else {
      invoice = await this.findOne(id, organizationId);
    }
    if (invoice.matchStatus !== 'exception') {
      throw new BadRequestException('Invoice does not have an active exception');
    }

    const existingDetails =
      invoice.matchDetails && typeof invoice.matchDetails === 'object'
        ? (invoice.matchDetails as Record<string, unknown>)
        : {};

    await this.db
      .update(invoices)
      .set({
        status: 'pending_match',
        matchStatus: 'partial_match',
        matchDetails: {
          ...existingDetails,
          resolution: {
            resolvedAt: new Date().toISOString(),
            resolvedBy: reviewerId,
            reason: input?.reason?.trim() || 'Finance accepted the invoice exception after review.',
            previousMatchStatus: 'exception',
          },
        } as any,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)));

    const resolved = await this.findOne(id, organizationId);
    this.audit
      .log(organizationId, reviewerId, 'invoice', id, 'exception_resolved', {
        previousMatchStatus: 'exception',
        newMatchStatus: 'partial_match',
        reason: input?.reason?.trim() || null,
      })
      .catch(() => {});
    return resolved;
  }

  async approve(id: string, organizationId: string, approverId: string, access?: AccessPolicy) {
    if (access) {
      const { authorizationScope } = await this.findOneWithAuthorizationScope(
        id,
        organizationId,
        access,
      );
      assertInvoiceScope(access, 'invoices:approve', authorizationScope, approverId);
    }
    const result = await this.db.transaction(async (tx) => {
      const [lockedInvoice] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)))
        .for('update');
      if (!lockedInvoice) throw new NotFoundException(`Invoice ${id} not found`);
      const activeApprovalRequest = await tx.query.approvalRequests.findFirst({
        where: (request, { and, eq }) =>
          and(
            eq(request.organizationId, organizationId),
            eq(request.approvableType, 'invoice'),
            eq(request.approvableId, id),
            eq(request.status, 'pending'),
          ),
      });
      if (activeApprovalRequest) {
        throw new ConflictException(
          'This invoice has an active approval request. Complete it from the Approvals queue.',
        );
      }
      if (lockedInvoice.matchStatus !== 'full_match') {
        throw new BadRequestException('Invoice requires a full three-way match before approval');
      }
      if (lockedInvoice.status === 'approved' || lockedInvoice.status === 'paid') {
        return {
          approved: await this.findOneWithExecutor(id, organizationId, tx),
          transitioned: false,
        };
      }

      const makerCheckerEnabled =
        (await this.settingsService.get(organizationId, 'prevent_invoice_self_approval', tx)) !==
        'false';
      const unknownInternalMaker =
        makerCheckerEnabled &&
        lockedInvoice.submissionSource !== 'vendor_portal' &&
        !lockedInvoice.createdBy;
      if (unknownInternalMaker) {
        await tx.insert(auditLog).values({
          organizationId,
          userId: approverId,
          entityType: 'invoice',
          entityId: id,
          action: 'approval_blocked_unknown_creator',
          changes: {
            preventInvoiceSelfApproval: true,
            reason: 'unknown_creator',
            fallbackApproverId: null,
          },
        });
        return {
          blocked: {
            reason: 'unknown_creator' as const,
            fallbackApprover: null,
          },
        };
      }

      const selfApproval = makerCheckerEnabled && lockedInvoice.createdBy === approverId;
      if (selfApproval) {
        const [maker, candidates] = await Promise.all([
          tx.query.users.findFirst({
            where: (user, { and, eq }) =>
              and(eq(user.id, approverId), eq(user.organizationId, organizationId)),
          }),
          tx.query.users.findMany({
            where: (user, { and, eq }) =>
              and(eq(user.organizationId, organizationId), eq(user.isActive, true)),
            with: { userRoles: { with: { customRole: true } } },
          }),
        ]);
        const fallback = resolveIndependentInvoiceApprover(
          approverId,
          maker?.departmentId ?? null,
          candidates,
        );
        const fallbackApprover = fallback ? { id: fallback.id, name: fallback.name } : null;
        await tx.insert(auditLog).values({
          organizationId,
          userId: approverId,
          entityType: 'invoice',
          entityId: id,
          action: 'self_approval_blocked',
          changes: {
            preventInvoiceSelfApproval: true,
            reason: 'self_approval',
            fallbackApproverId: fallbackApprover?.id ?? null,
          },
        });
        return {
          blocked: {
            reason: 'self_approval' as const,
            fallbackApprover,
          },
        };
      }

      const approvedAt = new Date();
      const [transitioned] = await tx
        .update(invoices)
        .set({
          status: 'approved',
          approvedBy: approverId,
          approvedAt,
          updatedAt: approvedAt,
        })
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.organizationId, organizationId),
            ne(invoices.status, 'approved'),
            ne(invoices.status, 'paid'),
            eq(invoices.matchStatus, 'full_match'),
          ),
        )
        .returning({ id: invoices.id });
      if (!transitioned) throw new BadRequestException('Invoice is not in an approvable state');

      const approved = await this.findOneWithExecutor(id, organizationId, tx);

      // Record spend in the approval transaction so budget accounting cannot lag invoice state.
      if (approved.purchaseOrderId) {
        const recoverableTaxAmount = addMoney(
          approved.lines
            .filter((line) => line.taxCode?.isRecoverable)
            .map((line) => String(line.taxAmount ?? '0')),
        );
        const baseRecoverableTaxAmount = convertMoney(
          recoverableTaxAmount,
          String(approved.exchangeRate),
        );
        const amounts = invoiceCommitmentAmounts(
          String(approved.baseTotalAmount),
          baseRecoverableTaxAmount,
        );
        await this.budgets.expenseInvoice(
          tx,
          organizationId,
          id,
          amounts.expense,
          amounts.commitmentRelease,
          approvedAt,
        );
      }

      return { approved, transitioned: true };
    });

    if ('blocked' in result && result.blocked) {
      const fallbackApprover = result.blocked.fallbackApprover;
      const unknownCreator = result.blocked.reason === 'unknown_creator';
      throw new ForbiddenException({
        code: unknownCreator ? 'INVOICE_CREATOR_UNKNOWN' : 'INVOICE_SELF_APPROVAL_BLOCKED',
        message: unknownCreator
          ? 'This invoice has no authoritative creator record. Approval is blocked while maker-checker policy is enabled.'
          : fallbackApprover
            ? `Invoice creators cannot approve their own invoices. Route this invoice to ${fallbackApprover.name}.`
            : 'Invoice creators cannot approve their own invoices. No independent global invoice approver is configured.',
        fallbackApprover,
      });
    }

    const { approved, transitioned } = result;
    if (!transitioned) return approved;
    this.webhookEvents.emit(organizationId, 'invoice.approved', { invoice: approved });
    this.audit
      .log(organizationId, approverId, 'invoice', id, 'approved', {
        totalAmount: (approved as any).totalAmount,
      })
      .catch(() => {});
    if (this.notifications) {
      void resolveOrganizationAdminId(this.db, organizationId)
        .then((adminId) => {
          if (!adminId) return;
          return this.notifications!.create(
            organizationId,
            adminId,
            'invoice_approved',
            'Invoice Approved',
            `Invoice ${(approved as any).internalNumber} has been approved for payment.`,
            'invoice',
            id,
          );
        })
        .catch(() => {});
    }
    void this.glExport.enqueue(organizationId, id, 'qbo').catch(() => {});

    return approved;
  }
}
