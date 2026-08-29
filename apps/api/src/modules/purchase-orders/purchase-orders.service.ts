import {
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import { SequenceService } from '../../common/services/sequence.service';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ContractComplianceService } from './contract-compliance.service';
import { EntitiesService } from '../entities/entities.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { RiskScreeningService } from '../risk-screening/risk-screening.service';
import { BudgetsService } from '../budgets/budgets.service';
import { ApprovalEngineService } from '../approvals/approval-engine.service';
import type { AccessPolicy } from '../auth/access-policy';
import { permissionScopePredicate, requirePermission } from '../auth/access-scope';
import { canViewRelatedRecord } from '../auth/related-record-access';
import type { Db } from '@betterspend/db';
import {
  appendAuditLog,
  approvalRequests,
  purchaseOrders,
  poLines,
  poVersions,
  blanketReleases,
  requisitions,
  vendors,
} from '@betterspend/db';
import { resolveOrganizationAdminId } from '../../common/demo-identity';
import { z } from 'zod';

const createPoSchema = z
  .object({
    entityId: z.string().uuid().optional(),
    vendorId: z.string().uuid(),
    requisitionId: z.string().uuid().optional(),
    paymentTerms: z.string().optional(),
    currency: z.string().length(3).default('USD'),
    exchangeRate: z.number().positive().optional(),
    notes: z.string().optional(),
    poType: z.enum(['standard', 'blanket']).default('standard'),
    shippingAddress: z.record(z.string(), z.unknown()).optional(),
    billingAddress: z.record(z.string(), z.unknown()).optional(),
    // Blanket PO fields
    blanketStartDate: z.string().datetime().optional(),
    blanketEndDate: z.string().datetime().optional(),
    blanketTotalLimit: z.number().optional(),
    lines: z
      .array(
        z.object({
          description: z.string().min(1),
          quantity: z.number().positive(),
          unitOfMeasure: z.string().default('each'),
          unitPrice: z.number().nonnegative(),
          glAccount: z.string().optional(),
          taxCodeId: z.string().uuid().optional(),
          taxInclusive: z.boolean().optional(),
          catalogItemId: z.string().uuid().optional(),
          requisitionLineId: z.string().uuid().optional(),
        }),
      )
      .min(1),
  })
  .superRefine((input, context) => {
    if (!input.requisitionId && !input.entityId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entityId'],
        message: 'entityId is required for standalone purchase orders',
      });
    }
  });

const changeOrderSchema = z.object({
  changeReason: z.string().min(1),
  lines: z
    .array(
      z.object({
        id: z.string().uuid().optional(), // existing line ID to update
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitOfMeasure: z.string().default('each'),
        unitPrice: z.number().nonnegative(),
        glAccount: z.string().optional(),
        taxCodeId: z.string().uuid().optional(),
        taxInclusive: z.boolean().optional(),
      }),
    )
    .optional(),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
});

export type CreatePoInput = z.infer<typeof createPoSchema>;
export type ChangeOrderInput = z.infer<typeof changeOrderSchema>;
export { createPoSchema, changeOrderSchema };

export function purchaseOrderScopeEntityId(
  input: Pick<CreatePoInput, 'entityId' | 'requisitionId'>,
  linkedRequisition: unknown,
) {
  if (
    linkedRequisition &&
    typeof linkedRequisition === 'object' &&
    'entityId' in linkedRequisition
  ) {
    const entityId = linkedRequisition.entityId;
    return typeof entityId === 'string' ? entityId : null;
  }
  return linkedRequisition ? null : (input.entityId ?? null);
}

export function visibleRequisitionSummary(
  access: AccessPolicy | undefined,
  requisition:
    | {
        id: string;
        number: string;
        requesterId: string;
        departmentId: string | null;
        projectId: string | null;
      }
    | null
    | undefined,
) {
  if (
    !requisition ||
    !canViewRelatedRecord(
      access,
      'requisition',
      ['requisitions:view_all', 'requisitions:view_own', 'requisitions:manage'],
      {
        ownerIds: [requisition.requesterId],
        departmentId: requisition.departmentId,
        projectId: requisition.projectId,
      },
    )
  ) {
    return null;
  }

  return { id: requisition.id, number: requisition.number };
}

/** Keeps version history independent from the caller's related-record access. */
export function createChangeOrderSnapshot<
  T extends {
    lines: readonly { matchedContract?: unknown }[];
    goodsReceipts?: unknown;
    invoices?: unknown;
    commitmentEvents?: unknown;
    activeApproval?: unknown;
  },
>(po: T) {
  const {
    lines,
    goodsReceipts: _goodsReceipts,
    invoices: _invoices,
    commitmentEvents: _commitmentEvents,
    activeApproval: _activeApproval,
    ...purchaseOrder
  } = po;

  return {
    po: purchaseOrder,
    lines: lines.map(({ matchedContract: _matchedContract, ...line }) => line),
  };
}

function purchaseOrderScopePredicates(organizationId: string) {
  return {
    own: (userId: string) =>
      sql`(
        ${purchaseOrders.issuedBy} = ${userId}
        OR ${purchaseOrders.requisitionId} IN (
          SELECT ${requisitions.id}
          FROM ${requisitions}
          WHERE ${requisitions.requesterId} = ${userId}
            AND ${requisitions.organizationId} = ${organizationId}
        )
      )`,
    department: (departmentId: string) =>
      sql`${purchaseOrders.requisitionId} IN (
        SELECT ${requisitions.id}
        FROM ${requisitions}
        WHERE ${requisitions.departmentId} = ${departmentId}
          AND ${requisitions.organizationId} = ${organizationId}
      )`,
    project: (projectId: string) =>
      sql`${purchaseOrders.requisitionId} IN (
        SELECT ${requisitions.id}
        FROM ${requisitions}
        WHERE ${requisitions.projectId} = ${projectId}
          AND ${requisitions.organizationId} = ${organizationId}
      )`,
    entity: (entityId: string) => eq(purchaseOrders.entityId, entityId),
  };
}

function assertPurchaseOrderScope(
  access: AccessPolicy | undefined,
  permission: 'purchase_orders:create' | 'purchase_orders:issue' | 'purchase_orders:manage',
  po: {
    entityId: string | null;
    issuedBy: string | null;
    requisition?: {
      id?: string;
      number?: string;
      requesterId?: string;
      departmentId?: string | null;
      projectId?: string | null;
    } | null;
  },
  actorId: string,
) {
  requirePermission(access, permission);
  if (!access) return;
  const scope = access.scopeFor('purchase_order', permission);
  if (
    scope.unrestricted ||
    scope.entityIds.includes(po.entityId ?? '') ||
    scope.departmentIds.includes(po.requisition?.departmentId ?? '') ||
    scope.projectIds.includes(po.requisition?.projectId ?? '') ||
    (scope.ownOnly && (po.issuedBy === actorId || po.requisition?.requesterId === actorId))
  ) {
    return;
  }
  throw new ForbiddenException('You do not have permission to access this purchase order');
}

interface LineTaxSnapshot {
  taxCodeId?: string;
  taxInclusive?: boolean;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly sequenceService: SequenceService,
    private readonly webhookEvents: WebhookEventService,
    private readonly audit: AuditService,
    @Optional() private readonly notifications: NotificationsService,
    @Optional() private readonly contractCompliance: ContractComplianceService,
    private readonly entitiesService: EntitiesService,
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly riskScreening: RiskScreeningService,
    private readonly budgets: BudgetsService,
    private readonly approvalEngine: ApprovalEngineService,
  ) {}

  private calculateLineTax(
    quantity: number,
    unitPrice: number,
    ratePercent: number,
    taxInclusive: boolean,
  ): LineTaxSnapshot {
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

  private async getTaxCodeMap(organizationId: string, taxCodeIds: string[]) {
    if (taxCodeIds.length === 0) return new Map<string, any>();
    const records = await this.db.query.taxCodes.findMany({
      where: (record, { and, eq, inArray }) =>
        and(eq(record.orgId, organizationId), inArray(record.id, taxCodeIds)),
    });
    if (records.length !== taxCodeIds.length) {
      throw new BadRequestException('One or more tax codes are invalid for this organization');
    }
    return new Map(records.map((record) => [record.id, record]));
  }

  async findAll(
    organizationId: string,
    filters?: { status?: string; vendorId?: string; entityId?: string },
    access?: AccessPolicy,
  ) {
    return this.db.query.purchaseOrders.findMany({
      where: (po, { and, eq }) => {
        const conditions = [
          eq(po.organizationId, organizationId),
          permissionScopePredicate(
            access,
            'purchase_order',
            [
              'purchase_orders:view_all',
              'purchase_orders:view_own',
              'purchase_orders:manage',
              'purchase_orders:issue',
            ],
            purchaseOrderScopePredicates(organizationId),
          ),
        ];
        if (filters?.status) conditions.push(eq(po.status, filters.status));
        if (filters?.vendorId) conditions.push(eq(po.vendorId, filters.vendorId));
        if (filters?.entityId) conditions.push(eq(po.entityId, filters.entityId));
        return and(...conditions);
      },
      with: {
        vendor: { columns: { punchoutConfig: false } },
        lines: { with: { taxCode: true } },
        entity: true,
      },
      orderBy: (po, { desc }) => desc(po.createdAt),
    });
  }

  async findOne(
    id: string,
    organizationId: string,
    access?: AccessPolicy,
    includeRequisitionDetails = false,
  ) {
    const po = await this.db.query.purchaseOrders.findFirst({
      where: (po, { and, eq }) =>
        and(
          eq(po.id, id),
          eq(po.organizationId, organizationId),
          permissionScopePredicate(
            access,
            'purchase_order',
            [
              'purchase_orders:view_all',
              'purchase_orders:view_own',
              'purchase_orders:manage',
              'purchase_orders:issue',
            ],
            purchaseOrderScopePredicates(organizationId),
          ),
        ),
      with: {
        vendor: { columns: { punchoutConfig: false } },
        lines: {
          with: {
            taxCode: true,
            matchedContract: {
              columns: { id: true, contractNumber: true, title: true, vendorId: true },
              with: { vendor: { columns: { entityId: true } } },
            },
          },
        },
        versions: true,
        entity: true,
        requisition: true,
        goodsReceipts: {
          columns: { id: true, number: true, status: true },
        },
        invoices: {
          columns: {
            id: true,
            internalNumber: true,
            invoiceNumber: true,
            status: true,
            createdBy: true,
          },
        },
        commitmentEvents: {
          columns: { id: true, budgetId: true },
          with: {
            budget: {
              columns: { id: true, name: true, budgetType: true, scopeId: true, entityId: true },
            },
          },
        },
      },
    });
    if (!po) throw new NotFoundException(`Purchase Order ${id} not found`);
    const recordScope = {
      ownerIds: [po.issuedBy, po.requisition?.requesterId],
      departmentId: po.requisition?.departmentId,
      projectId: po.requisition?.projectId,
      entityId: po.entityId,
    };
    const activeApproval = canViewRelatedRecord(
      access,
      'approval',
      ['approvals:view', 'approvals:act'],
      recordScope,
    )
      ? await this.db.query.approvalRequests.findFirst({
          where: (approval, { and, eq }) =>
            and(
              eq(approval.organizationId, organizationId),
              eq(approval.approvableType, 'purchase_order'),
              eq(approval.approvableId, id),
              eq(approval.status, 'pending'),
            ),
          columns: { id: true, currentStep: true, status: true },
        })
      : null;
    const requisition = includeRequisitionDetails
      ? po.requisition
      : visibleRequisitionSummary(access, po.requisition);
    const lines = (po.lines ?? []).map(({ matchedContract, ...line }) => ({
      ...line,
      matchedContract:
        matchedContract &&
        canViewRelatedRecord(access, 'contract', ['contracts:view'], {
          entityId: matchedContract.vendor?.entityId,
        })
          ? {
              id: matchedContract.id,
              contractNumber: matchedContract.contractNumber,
              title: matchedContract.title,
            }
          : null,
    }));
    const goodsReceipts = (po.goodsReceipts ?? []).filter(() =>
      canViewRelatedRecord(
        access,
        'receiving',
        ['receiving:view', 'receiving:manage'],
        recordScope,
      ),
    );
    const invoices = (po.invoices ?? [])
      .filter((invoice) =>
        canViewRelatedRecord(
          access,
          'invoice',
          ['invoices:view_all', 'invoices:manage', 'invoices:approve'],
          { ...recordScope, ownerIds: [invoice.createdBy, po.requisition?.requesterId] },
        ),
      )
      .map(({ createdBy: _createdBy, ...invoice }) => invoice);
    const commitmentEvents = (po.commitmentEvents ?? []).flatMap((event) => {
      const budget = event.budget;
      if (
        !budget ||
        !canViewRelatedRecord(access, 'budget', ['budgets:view'], {
          departmentId: budget.budgetType === 'department' ? budget.scopeId : null,
          projectId: budget.budgetType === 'project' ? budget.scopeId : null,
          entityId: budget.entityId,
        })
      ) {
        return [];
      }

      return [
        { id: event.id, budgetId: event.budgetId, budget: { id: budget.id, name: budget.name } },
      ];
    });
    const {
      lines: _lines,
      goodsReceipts: _goodsReceipts,
      invoices: _invoices,
      commitmentEvents: _commitmentEvents,
      requisition: _requisition,
      ...purchaseOrder
    } = po;
    return {
      ...purchaseOrder,
      requisition,
      lines,
      goodsReceipts,
      invoices,
      commitmentEvents,
      activeApproval,
    };
  }

  async create(
    organizationId: string,
    issuedBy: string,
    input: CreatePoInput,
    access?: AccessPolicy,
  ) {
    requirePermission(access, 'purchase_orders:create');
    if (!input.requisitionId && !input.entityId) {
      throw new BadRequestException('entityId is required for standalone purchase orders');
    }
    await this.entitiesService.assertBelongsToOrg(organizationId, input.entityId);
    const vendor = await this.db.query.vendors.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, input.vendorId), eq(record.organizationId, organizationId)),
    });
    if (!vendor) {
      throw new NotFoundException(`Vendor ${input.vendorId} not found`);
    }
    if (
      ['pending_review', 'changes_requested'].includes(vendor.onboardingStatus ?? 'not_started')
    ) {
      throw new BadRequestException(
        `Vendor onboarding is ${vendor.onboardingStatus.replace(/_/g, ' ')} and must be approved before a PO can be created`,
      );
    }
    const linkedRequisition = input.requisitionId
      ? await this.db.query.requisitions.findFirst({
          where: (record, { and, eq }) =>
            and(eq(record.id, input.requisitionId!), eq(record.organizationId, organizationId)),
        })
      : null;
    if (input.requisitionId && !linkedRequisition) {
      throw new BadRequestException('The linked requisition was not found in this organization');
    }
    assertPurchaseOrderScope(
      access,
      'purchase_orders:create',
      {
        entityId: purchaseOrderScopeEntityId(input, linkedRequisition),
        issuedBy,
        requisition: linkedRequisition,
      },
      issuedBy,
    );
    const sanctionsWarning = await this.riskScreening.checkVendorForPo(organizationId, vendor);
    const currency = input.currency ?? 'USD';
    const taxCodeMap = await this.getTaxCodeMap(
      organizationId,
      input.lines.map((line) => line.taxCodeId).filter((value): value is string => !!value),
    );

    // Run compliance checks for each line before the transaction
    const lineComplianceResults = this.contractCompliance
      ? await Promise.all(
          input.lines.map((l) =>
            this.contractCompliance!.checkCompliance(
              organizationId,
              input.vendorId,
              l.unitPrice,
              l.catalogItemId ?? null,
              l.description,
            ).catch(() => null),
          ),
        )
      : input.lines.map(() => null);

    const createdId = await this.db.transaction(async (tx) => {
      const number = await this.sequenceService.next(organizationId, 'purchase_order', tx);
      const lineAmounts = input.lines.map((line) => {
        const taxCode = line.taxCodeId ? taxCodeMap.get(line.taxCodeId) : null;
        const ratePercent = taxCode ? parseFloat(String(taxCode.ratePercent ?? '0')) : 0;
        return this.calculateLineTax(
          line.quantity,
          line.unitPrice,
          ratePercent,
          !!line.taxInclusive,
        );
      });
      const subtotal = lineAmounts.reduce((sum, line) => sum + line.subtotal, 0);
      const taxAmount = lineAmounts.reduce((sum, line) => sum + line.taxAmount, 0);
      const totalAmount = lineAmounts.reduce((sum, line) => sum + line.totalAmount, 0);
      const { baseCurrency, exchangeRate, baseAmount } =
        await this.exchangeRatesService.convertToBase(
          organizationId,
          totalAmount,
          currency,
          input.exchangeRate,
        );

      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          organizationId,
          entityId: input.entityId ?? null,
          vendorId: input.vendorId,
          requisitionId: input.requisitionId,
          number,
          version: 1,
          poType: input.poType ?? 'standard',
          status: 'draft',
          issuedBy,
          paymentTerms: input.paymentTerms,
          currency,
          baseCurrency,
          exchangeRate: String(exchangeRate),
          notes: input.notes,
          shippingAddress: input.shippingAddress ?? {},
          billingAddress: input.billingAddress ?? {},
          subtotal: String(subtotal.toFixed(2)),
          taxAmount: String(taxAmount.toFixed(2)),
          totalAmount: String(totalAmount.toFixed(2)),
          baseSubtotal: String(
            this.exchangeRatesService.roundMoney(subtotal * exchangeRate).toFixed(2),
          ),
          baseTaxAmount: String(
            this.exchangeRatesService.roundMoney(taxAmount * exchangeRate).toFixed(2),
          ),
          baseTotalAmount: String(baseAmount),
          blanketStartDate: input.blanketStartDate ? new Date(input.blanketStartDate) : null,
          blanketEndDate: input.blanketEndDate ? new Date(input.blanketEndDate) : null,
          blanketTotalLimit: input.blanketTotalLimit ? String(input.blanketTotalLimit) : null,
        })
        .returning();

      await tx.insert(poLines).values(
        input.lines.map((l, i) => {
          const cr = lineComplianceResults[i];
          const amounts = lineAmounts[i];
          return {
            purchaseOrderId: po.id,
            lineNumber: i + 1,
            description: l.description,
            taxCodeId: l.taxCodeId ?? null,
            taxAmount: String(amounts.taxAmount.toFixed(2)),
            taxInclusive: l.taxInclusive ?? false,
            quantity: String(l.quantity),
            unitOfMeasure: l.unitOfMeasure,
            unitPrice: String(l.unitPrice),
            totalPrice: String(amounts.totalAmount.toFixed(2)),
            exchangeRate: String(exchangeRate),
            baseUnitPrice: String(this.exchangeRatesService.roundMoney(l.unitPrice * exchangeRate)),
            baseTotalPrice: String(
              this.exchangeRatesService.roundMoney(amounts.totalAmount * exchangeRate),
            ),
            glAccount: l.glAccount,
            catalogItemId: l.catalogItemId,
            requisitionLineId: l.requisitionLineId,
            contractComplianceStatus: cr?.status ?? null,
            contractComplianceDeltaPercent:
              cr?.deltaPercent != null ? String(cr.deltaPercent) : null,
            matchedContractId: cr?.contractId ?? null,
            contractedUnitPrice:
              cr?.contractedUnitPrice != null ? String(cr.contractedUnitPrice) : null,
          };
        }),
      );

      // If created from a requisition, mark it as converted
      if (input.requisitionId) {
        const [converted] = await tx
          .update(requisitions)
          .set({ status: 'converted', updatedAt: new Date() })
          .where(
            and(
              eq(requisitions.id, input.requisitionId),
              eq(requisitions.organizationId, organizationId),
              eq(requisitions.status, 'approved'),
            ),
          )
          .returning({ id: requisitions.id });
        if (!converted) {
          throw new BadRequestException(
            'Only an approved requisition in this organization can be converted to a purchase order',
          );
        }
      }

      if (sanctionsWarning) {
        await appendAuditLog(tx, {
          organizationId,
          userId: issuedBy,
          entityType: 'vendor',
          entityId: vendor.id,
          action: 'po_sanctions_warning',
          changes: { poNumber: number, warning: sanctionsWarning },
        });
      }
      await appendAuditLog(tx, {
        organizationId,
        userId: issuedBy,
        entityType: 'purchase_order',
        entityId: po.id,
        action: 'created',
        changes: { number, totalAmount: po.totalAmount },
      });

      return po.id;
    });

    const created = await this.findOne(createdId, organizationId);
    return sanctionsWarning ? { ...created, sanctionsWarning } : created;
  }

  async issue(id: string, organizationId: string, issuedBy: string, access?: AccessPolicy) {
    const po = await this.findOne(id, organizationId, access, true);
    assertPurchaseOrderScope(access, 'purchase_orders:issue', po, issuedBy);
    if (!['draft', 'approved'].includes(po.status)) {
      throw new BadRequestException(`Cannot issue a PO with status "${po.status}"`);
    }

    const linkedRequisition = po.requisitionId
      ? await this.db.query.requisitions.findFirst({
          where: (record, { and, eq }) =>
            and(eq(record.id, po.requisitionId!), eq(record.organizationId, organizationId)),
        })
      : null;
    if (po.requisitionId && !linkedRequisition) {
      throw new BadRequestException('The linked requisition was not found in this organization');
    }
    const enforcementInput = {
      organizationId,
      departmentId: linkedRequisition?.departmentId,
      requestedAmount: po.totalAmount,
      currency: po.currency,
      fiscalYear: linkedRequisition?.createdAt.getUTCFullYear() ?? po.createdAt.getUTCFullYear(),
      excludeRequisitionId: linkedRequisition?.id,
      excludePurchaseOrderId: po.id,
    };
    const outcome = await this.budgets.withEnforcementLock(
      enforcementInput,
      async (tx, budgetEnforcement) => {
        if (budgetEnforcement.action === 'block') {
          throw new BadRequestException(budgetEnforcement.message);
        }
        if (budgetEnforcement.action === 'require_approval') {
          if (!budgetEnforcement.ownerUserId) {
            throw new BadRequestException('An active budget owner is required for approval');
          }
          const approvalKey = `budget:${budgetEnforcement.budgetId}:po:${id}:version:${po.version}:owner:${budgetEnforcement.ownerUserId}`;
          const completed =
            po.status === 'approved' &&
            (await this.approvalEngine.hasCompletedRequiredApproval(
              'purchase_order',
              id,
              budgetEnforcement.ownerUserId,
              approvalKey,
              po.updatedAt,
            ));
          if (!completed) return { kind: 'approval' as const, budgetEnforcement };
        }

        // Issuance and its budget decision share the budget-row lock, so two
        // commitments cannot both spend the same remaining amount.
        const [issueVendor] = await tx
          .select()
          .from(vendors)
          .where(and(eq(vendors.id, po.vendorId), eq(vendors.organizationId, organizationId)))
          .for('update');
        if (!issueVendor) throw new NotFoundException(`Vendor ${po.vendorId} not found`);
        const sanctionsWarning = await this.riskScreening.checkVendorStatusForPo(
          organizationId,
          issueVendor,
        );
        const now = new Date();
        const [issued] = await tx
          .update(purchaseOrders)
          .set({ status: 'issued', issuedBy, issuedAt: now, updatedAt: now })
          .where(
            and(
              eq(purchaseOrders.id, id),
              eq(purchaseOrders.organizationId, organizationId),
              eq(purchaseOrders.version, po.version),
              eq(purchaseOrders.totalAmount, po.totalAmount),
              inArray(purchaseOrders.status, ['draft', 'approved']),
            ),
          )
          .returning();
        if (!issued) throw new BadRequestException('Purchase order status changed before issuance');
        await this.budgets.commitPurchaseOrder(tx, organizationId, id);
        if (sanctionsWarning) {
          await appendAuditLog(tx, {
            organizationId,
            userId: issuedBy,
            entityType: 'vendor',
            entityId: issueVendor.id,
            action: 'po_sanctions_warning',
            changes: { poNumber: po.number, warning: sanctionsWarning },
          });
        }
        await appendAuditLog(tx, {
          organizationId,
          userId: issuedBy,
          entityType: 'purchase_order',
          entityId: id,
          action: 'issued',
          changes: { totalAmount: issued.totalAmount, budgetEnforcement },
        });
        return { kind: 'issued' as const, issued, sanctionsWarning, budgetEnforcement };
      },
    );

    if (outcome.kind === 'approval') {
      const ownerUserId = outcome.budgetEnforcement.ownerUserId;
      if (!ownerUserId) {
        throw new BadRequestException('An active budget owner is required for approval');
      }
      const approvalKey = `budget:${outcome.budgetEnforcement.budgetId}:po:${id}:version:${po.version}:owner:${ownerUserId}`;
      await this.approvalEngine.initiateApproval(
        organizationId,
        'purchase_order',
        id,
        issuedBy,
        {
          approverId: ownerUserId,
          reason: outcome.budgetEnforcement.message,
          key: approvalKey,
          only: po.status === 'approved',
        },
        async (tx) => {
          const now = new Date();
          const [transitioned] = await tx
            .update(purchaseOrders)
            .set({ status: 'pending_approval', updatedAt: now })
            .where(
              and(
                eq(purchaseOrders.id, id),
                eq(purchaseOrders.organizationId, organizationId),
                eq(purchaseOrders.version, po.version),
                eq(purchaseOrders.totalAmount, po.totalAmount),
                inArray(purchaseOrders.status, ['draft', 'approved']),
              ),
            )
            .returning({ id: purchaseOrders.id });
          if (!transitioned) {
            throw new BadRequestException('Purchase order status changed before approval started');
          }
          await appendAuditLog(tx, {
            organizationId,
            userId: issuedBy,
            entityType: 'purchase_order',
            entityId: id,
            action: 'budget_owner_approval_requested',
            changes: { budgetEnforcement: outcome.budgetEnforcement },
          });
        },
        undefined,
        {
          budgetAvailable: outcome.budgetEnforcement.withinBudget,
          budgetDecision: outcome.budgetEnforcement,
        },
      );
      const pending = await this.findOne(id, organizationId, access);
      return { ...pending, budgetEnforcement: outcome.budgetEnforcement };
    }

    const updated = outcome.issued;
    const budgetEnforcement = outcome.budgetEnforcement;
    this.webhookEvents.emit(organizationId, 'po.issued', { purchaseOrder: updated });
    if (this.notifications) {
      void resolveOrganizationAdminId(this.db, organizationId)
        .then((adminId) => {
          if (!adminId) return;
          return this.notifications!.create(
            organizationId,
            adminId,
            'po_issued',
            'Purchase Order Issued',
            `Purchase Order ${updated.number} has been issued to the vendor.`,
            'purchase_order',
            id,
          );
        })
        .catch(() => {});
    }
    return { ...updated, budgetEnforcement };
  }

  async createChangeOrder(
    id: string,
    organizationId: string,
    changedBy: string,
    input: ChangeOrderInput,
    access?: AccessPolicy,
  ) {
    const po = await this.findOne(id, organizationId, access, true);
    assertPurchaseOrderScope(access, 'purchase_orders:manage', po, changedBy);
    const snapshot = createChangeOrderSnapshot(po);

    if (['closed', 'cancelled'].includes(po.status)) {
      throw new BadRequestException(`Cannot create change order for ${po.status} PO`);
    }

    await this.db.transaction(async (tx) => {
      // Snapshot current state before modifying
      await tx.insert(poVersions).values({
        purchaseOrderId: id,
        version: po.version,
        changeReason: input.changeReason,
        changedBy,
        snapshot: snapshot as any,
        diffSummary: {
          previousVersion: po.version,
          notes: input.notes,
          linesChanged: !!input.lines,
        } as any,
      });

      const newVersion = po.version + 1;

      if (input.lines) {
        await tx.delete(poLines).where(eq(poLines.purchaseOrderId, id));
        const taxCodeMap = await this.getTaxCodeMap(
          organizationId,
          input.lines.map((line) => line.taxCodeId).filter((value): value is string => !!value),
        );
        const lineAmounts = input.lines.map((line) => {
          const taxCode = line.taxCodeId ? taxCodeMap.get(line.taxCodeId) : null;
          const ratePercent = taxCode ? parseFloat(String(taxCode.ratePercent ?? '0')) : 0;
          return this.calculateLineTax(
            line.quantity,
            line.unitPrice,
            ratePercent,
            !!line.taxInclusive,
          );
        });
        const subtotal = lineAmounts.reduce((sum, line) => sum + line.subtotal, 0);
        const taxAmount = lineAmounts.reduce((sum, line) => sum + line.taxAmount, 0);
        const totalAmount = lineAmounts.reduce((sum, line) => sum + line.totalAmount, 0);
        const exchangeRate = Number(po.exchangeRate ?? '1');
        const baseSubtotal = this.exchangeRatesService.roundMoney(subtotal * exchangeRate);
        const baseTaxAmount = this.exchangeRatesService.roundMoney(taxAmount * exchangeRate);
        const baseTotalAmount = this.exchangeRatesService.roundMoney(totalAmount * exchangeRate);

        // Compliance checks for change order lines
        const changeLineCompliance = this.contractCompliance
          ? await Promise.all(
              input.lines.map((l) =>
                this.contractCompliance!.checkCompliance(
                  organizationId,
                  po.vendorId,
                  l.unitPrice,
                  null,
                  l.description,
                ).catch(() => null),
              ),
            )
          : input.lines.map(() => null);

        await tx.insert(poLines).values(
          input.lines.map((l, i) => {
            const cr = changeLineCompliance[i];
            const amounts = lineAmounts[i];
            return {
              purchaseOrderId: id,
              lineNumber: i + 1,
              description: l.description,
              taxCodeId: l.taxCodeId ?? null,
              taxAmount: String(amounts.taxAmount.toFixed(2)),
              taxInclusive: l.taxInclusive ?? false,
              quantity: String(l.quantity),
              unitOfMeasure: l.unitOfMeasure,
              unitPrice: String(l.unitPrice),
              totalPrice: String(amounts.totalAmount.toFixed(2)),
              exchangeRate: String(exchangeRate),
              baseUnitPrice: String(
                this.exchangeRatesService.roundMoney(l.unitPrice * exchangeRate),
              ),
              baseTotalPrice: String(
                this.exchangeRatesService.roundMoney(amounts.totalAmount * exchangeRate),
              ),
              glAccount: l.glAccount,
              contractComplianceStatus: cr?.status ?? null,
              contractComplianceDeltaPercent:
                cr?.deltaPercent != null ? String(cr.deltaPercent) : null,
              matchedContractId: cr?.contractId ?? null,
              contractedUnitPrice:
                cr?.contractedUnitPrice != null ? String(cr.contractedUnitPrice) : null,
            };
          }),
        );

        const subtotalStr = String(subtotal.toFixed(2));
        const taxAmountStr = String(taxAmount.toFixed(2));
        const totalAmountStr = String(totalAmount.toFixed(2));
        await tx
          .update(purchaseOrders)
          .set({
            version: newVersion,
            notes: input.notes ?? po.notes,
            paymentTerms: input.paymentTerms ?? po.paymentTerms,
            subtotal: subtotalStr,
            taxAmount: taxAmountStr,
            totalAmount: totalAmountStr,
            baseSubtotal: String(baseSubtotal),
            baseTaxAmount: String(baseTaxAmount),
            baseTotalAmount: String(baseTotalAmount),
            status: 'draft', // Change orders reset to draft for re-approval
            updatedAt: new Date(),
          })
          .where(eq(purchaseOrders.id, id));
      } else {
        await tx
          .update(purchaseOrders)
          .set({
            version: newVersion,
            notes: input.notes ?? po.notes,
            paymentTerms: input.paymentTerms ?? po.paymentTerms,
            status: 'draft',
            updatedAt: new Date(),
          })
          .where(eq(purchaseOrders.id, id));
      }
      await this.budgets.reducePurchaseOrderCommitment(tx, organizationId, id);
    });

    return this.findOne(id, organizationId);
  }

  async cancel(id: string, organizationId: string, actorId: string, access?: AccessPolicy) {
    const po = await this.findOne(id, organizationId, access, true);
    assertPurchaseOrderScope(access, 'purchase_orders:manage', po, actorId);
    if (['closed', 'cancelled', 'received', 'invoiced'].includes(po.status)) {
      throw new BadRequestException(`Cannot cancel a ${po.status} PO`);
    }
    const updated = await this.db.transaction(async (tx) => {
      const [transitioned] = await tx
        .update(purchaseOrders)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)))
        .returning();
      await this.budgets.releasePurchaseOrder(tx, organizationId, id, 'cancelled');
      return transitioned;
    });
    this.webhookEvents.emit(organizationId, 'po.cancelled', { purchaseOrderId: id });
    this.audit.log(organizationId, null, 'purchase_order', id, 'cancelled').catch(() => {});
    return updated;
  }

  async getVersionHistory(id: string, organizationId: string, access?: AccessPolicy) {
    await this.findOne(id, organizationId, access); // verify exists + org access
    return this.db.query.poVersions.findMany({
      where: eq(poVersions.purchaseOrderId, id),
      orderBy: (v, { asc }) => asc(v.version),
    });
  }

  async listReleases(blanketPoId: string, organizationId: string, access?: AccessPolicy) {
    await this.findOne(blanketPoId, organizationId, access); // verify access
    return this.db.query.blanketReleases.findMany({
      where: eq(blanketReleases.blanketPoId, blanketPoId),
      orderBy: (r, { asc }) => asc(r.releaseNumber),
    });
  }

  async createRelease(
    blanketPoId: string,
    organizationId: string,
    releasedBy: string,
    input: { amount: number; description?: string },
    access?: AccessPolicy,
  ) {
    const po = await this.findOne(blanketPoId, organizationId, access, true);
    assertPurchaseOrderScope(access, 'purchase_orders:manage', po, releasedBy);
    if (po.poType !== 'blanket')
      throw new BadRequestException('Releases can only be created against blanket POs');
    if (!['issued', 'approved', 'partially_received'].includes(po.status)) {
      throw new BadRequestException('Blanket PO must be issued or approved to create releases');
    }

    const limit = po.blanketTotalLimit ? parseFloat(po.blanketTotalLimit) : null;
    const released = parseFloat(po.blanketReleasedAmount ?? '0');
    if (limit !== null && released + input.amount > limit) {
      throw new BadRequestException(
        `Release amount $${input.amount} would exceed blanket limit $${limit} (released so far: $${released})`,
      );
    }

    // Get next release number
    const existing = await this.db.query.blanketReleases.findMany({
      where: eq(blanketReleases.blanketPoId, blanketPoId),
    });
    const releaseNumber = existing.length + 1;

    const [release] = await this.db
      .insert(blanketReleases)
      .values({
        blanketPoId,
        releaseNumber,
        amount: String(input.amount),
        description: input.description ?? null,
        status: 'approved',
        releasedBy,
      })
      .returning();

    // Update accumulated released amount
    await this.db
      .update(purchaseOrders)
      .set({
        blanketReleasedAmount: String(released + input.amount),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, blanketPoId));

    return release;
  }

  async cancelRelease(
    blanketPoId: string,
    releaseId: string,
    organizationId: string,
    actorId: string,
    access?: AccessPolicy,
  ) {
    const blanketPo = await this.findOne(blanketPoId, organizationId, access, true);
    assertPurchaseOrderScope(access, 'purchase_orders:manage', blanketPo, actorId);
    const release = await this.db.query.blanketReleases.findFirst({
      where: (r, { and, eq }) => and(eq(r.id, releaseId), eq(r.blanketPoId, blanketPoId)),
    });
    if (!release) throw new NotFoundException(`Release ${releaseId} not found`);
    if (release.status === 'cancelled') return release;

    const [updated] = await this.db
      .update(blanketReleases)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(blanketReleases.id, releaseId))
      .returning();

    // Subtract from released amount
    const po = await this.db.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, blanketPoId),
    });
    if (po) {
      const released = parseFloat(po.blanketReleasedAmount ?? '0');
      const amount = parseFloat(release.amount);
      await this.db
        .update(purchaseOrders)
        .set({
          blanketReleasedAmount: String(Math.max(0, released - amount)),
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, blanketPoId));
    }

    return updated;
  }

  async getComplianceReport(id: string, organizationId: string, access?: AccessPolicy) {
    const po = await this.findOne(id, organizationId, access);
    const lines = po.lines ?? [];
    const totalLines = lines.length;
    const compliantLines = lines.filter(
      (l: any) => l.contractComplianceStatus === 'compliant',
    ).length;
    const deviationLines = lines.filter(
      (l: any) => l.contractComplianceStatus === 'deviation',
    ).length;
    const noContractLines = lines.filter(
      (l: any) => l.contractComplianceStatus === 'no_contract' || !l.contractComplianceStatus,
    ).length;

    return {
      purchaseOrderId: id,
      number: po.number,
      summary: {
        totalLines,
        compliantLines,
        deviationLines,
        noContractLines,
      },
      lines: lines.map((l: any) => ({
        id: l.id,
        lineNumber: l.lineNumber,
        description: l.description,
        unitPrice: l.unitPrice,
        contractComplianceStatus: l.contractComplianceStatus ?? 'no_contract',
        contractComplianceDeltaPercent: l.contractComplianceDeltaPercent,
        matchedContractId: l.matchedContractId,
        contractedUnitPrice: l.contractedUnitPrice,
      })),
    };
  }

  async checkLineCompliance(
    organizationId: string,
    vendorId: string,
    unitPrice: number,
    catalogItemId?: string,
    description?: string,
    access?: AccessPolicy,
  ) {
    requirePermission(access, 'purchase_orders:create');
    if (!this.contractCompliance) {
      return {
        status: 'no_contract',
        deltaPercent: null,
        contractId: null,
        contractedUnitPrice: null,
      };
    }
    return this.contractCompliance.checkCompliance(
      organizationId,
      vendorId,
      unitPrice,
      catalogItemId,
      description,
    );
  }

  async getReceivingSummary(id: string, organizationId: string, access?: AccessPolicy) {
    await this.findOne(id, organizationId, access); // validate access
    const rows = await this.db.execute(sql`
      SELECT
        pl.id                                                            AS "poLineId",
        pl.line_number                                                   AS "lineNumber",
        pl.description,
        pl.quantity::numeric                                             AS "orderedQty",
        pl.unit_of_measure                                              AS "uom",
        COALESCE(SUM(CASE WHEN gr.id IS NOT NULL THEN grl.quantity_received::numeric ELSE 0 END), 0)::numeric AS "receivedQty",
        COALESCE(SUM(CASE WHEN gr.id IS NOT NULL THEN grl.quantity_rejected::numeric ELSE 0 END), 0)::numeric AS "rejectedQty",
        (
          pl.quantity::numeric -
          COALESCE(SUM(CASE WHEN gr.id IS NOT NULL THEN grl.quantity_received::numeric ELSE 0 END), 0)
        )::numeric AS "outstandingQty",
        CASE
          WHEN pl.quantity::numeric = 0 THEN 0
          ELSE ROUND(
            COALESCE(SUM(CASE WHEN gr.id IS NOT NULL THEN grl.quantity_received::numeric ELSE 0 END), 0) /
            pl.quantity::numeric * 100,
            1
          )
        END                                                              AS "receivedPct",
        COUNT(DISTINCT gr.id)::int                                       AS "grnCount"
      FROM po_lines pl
      LEFT JOIN goods_receipt_lines grl ON grl.po_line_id = pl.id
      LEFT JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id AND gr.status != 'cancelled'
      WHERE pl.purchase_order_id = ${id}
      GROUP BY pl.id, pl.line_number, pl.description, pl.quantity, pl.unit_of_measure
      ORDER BY pl.line_number ASC
    `);
    return rows;
  }
}
