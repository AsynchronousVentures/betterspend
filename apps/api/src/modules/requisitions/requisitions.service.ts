import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import { SequenceService } from '../../common/services/sequence.service';
import { ApprovalEngineService } from '../approvals/approval-engine.service';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { AuditService } from '../audit/audit.service';
import { BudgetsService } from '../budgets/budgets.service';
import { SpendGuardService } from '../spend-guard/spend-guard.service';
import type { Db } from '@betterspend/db';
import { approvalRequests, requisitions, requisitionLines } from '@betterspend/db';
import {
  multiplyMoney,
  normalizeMoney,
  sumMoney,
  type CreateRequisitionInput,
  type DecimalInput,
} from '@betterspend/shared';
import type { AccessPolicy } from '../auth/access-policy';
import { permissionScopePredicate, requirePermission } from '../auth/access-scope';
import { canViewRelatedRecord } from '../auth/related-record-access';

type RequisitionCreateInput = Omit<CreateRequisitionInput, 'lines'> & {
  lines: Array<
    Omit<CreateRequisitionInput['lines'][number], 'unitPrice'> & { unitPrice: DecimalInput }
  >;
  ownerIdempotencyKey?: string;
};

@Injectable()
export class RequisitionsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly sequenceService: SequenceService,
    private readonly approvalEngine: ApprovalEngineService,
    private readonly webhookEvents: WebhookEventService,
    private readonly audit: AuditService,
    private readonly budgets: BudgetsService,
    private readonly spendGuard: SpendGuardService,
  ) {}

  async findAll(
    organizationId: string,
    filters?: { status?: string; departmentId?: string },
    access?: AccessPolicy,
  ) {
    const rows = await this.db.query.requisitions.findMany({
      where: (r, { and, eq }) => {
        const conditions = [
          eq(r.organizationId, organizationId),
          permissionScopePredicate(
            access,
            'requisition',
            ['requisitions:view_all', 'requisitions:view_own', 'requisitions:manage'],
            {
              own: (userId) => eq(r.requesterId, userId),
              department: (departmentId) => eq(r.departmentId, departmentId),
              project: (projectId) => eq(r.projectId, projectId),
            },
          ),
        ];
        if (filters?.status) conditions.push(eq(r.status, filters.status));
        if (filters?.departmentId) conditions.push(eq(r.departmentId, filters.departmentId));
        return and(...conditions);
      },
      with: { lines: true },
      orderBy: (r, { desc }) => desc(r.createdAt),
    });
    return rows.map(withoutOwnerIdempotencyKey);
  }

  async findOne(id: string, organizationId: string, access?: AccessPolicy) {
    const req = await this.db.query.requisitions.findFirst({
      where: (r, { and, eq }) =>
        and(
          eq(r.id, id),
          eq(r.organizationId, organizationId),
          permissionScopePredicate(
            access,
            'requisition',
            ['requisitions:view_all', 'requisitions:view_own', 'requisitions:manage'],
            {
              own: (userId) => eq(r.requesterId, userId),
              department: (departmentId) => eq(r.departmentId, departmentId),
              project: (projectId) => eq(r.projectId, projectId),
            },
          ),
        ),
      with: {
        lines: true,
        purchaseOrders: {
          columns: { id: true, number: true, status: true, entityId: true, issuedBy: true },
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
    if (!req) throw new NotFoundException(`Requisition ${id} not found`);
    const activeApproval = canViewRelatedRecord(
      access,
      'approval',
      ['approvals:view', 'approvals:act'],
      {
        departmentId: req.departmentId,
        projectId: req.projectId,
      },
    )
      ? await this.db.query.approvalRequests.findFirst({
          where: (approval, { and, eq }) =>
            and(
              eq(approval.organizationId, organizationId),
              eq(approval.approvableType, 'requisition'),
              eq(approval.approvableId, id),
              eq(approval.status, 'pending'),
            ),
          columns: { id: true, currentStep: true, status: true },
        })
      : null;
    const purchaseOrders = (req.purchaseOrders ?? [])
      .filter((purchaseOrder) =>
        canViewRelatedRecord(
          access,
          'purchase_order',
          [
            'purchase_orders:view_all',
            'purchase_orders:view_own',
            'purchase_orders:manage',
            'purchase_orders:issue',
          ],
          {
            ownerIds: [purchaseOrder.issuedBy, req.requesterId],
            departmentId: req.departmentId,
            projectId: req.projectId,
            entityId: purchaseOrder.entityId,
          },
        ),
      )
      .map(({ id: purchaseOrderId, number, status }) => ({
        id: purchaseOrderId,
        number,
        status,
      }));
    const commitmentEvents = (req.commitmentEvents ?? []).flatMap((event) => {
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
      purchaseOrders: _purchaseOrders,
      commitmentEvents: _commitmentEvents,
      idempotencyKey: _privateOwnerKey,
      ...requisition
    } = req;
    return { ...requisition, purchaseOrders, commitmentEvents, activeApproval };
  }

  private async findOneForMutation(
    id: string,
    organizationId: string,
    actorId: string,
    access?: AccessPolicy,
  ) {
    if (access?.can('requisitions:create')) {
      const ownDraft = await this.db.query.requisitions.findFirst({
        where: (r, { and, eq }) =>
          and(
            eq(r.id, id),
            eq(r.organizationId, organizationId),
            eq(r.requesterId, actorId),
            eq(r.status, 'draft'),
            permissionScopePredicate(access, 'requisition', ['requisitions:create'], {
              department: (departmentId) => eq(r.departmentId, departmentId),
              project: (projectId) => eq(r.projectId, projectId),
            }),
          ),
        with: { lines: true },
      });
      if (ownDraft) return ownDraft;
    }
    return this.findOne(id, organizationId, access);
  }

  async create(
    organizationId: string,
    requesterId: string,
    input: RequisitionCreateInput,
    access?: AccessPolicy,
  ) {
    requirePermission(access, 'requisitions:create');
    this.assertRequisitionScope(access, 'requisitions:create', {
      departmentId: input.departmentId ?? null,
      projectId: input.projectId ?? null,
    });
    const creation = await this.db.transaction(async (tx) => {
      const number = await this.sequenceService.next(organizationId, 'requisition', tx);
      const amounts = input.lines.map((line) => {
        const unitPrice = normalizeMoney(line.unitPrice);
        return {
          unitPrice,
          totalPrice: multiplyMoney(line.quantity, unitPrice),
        };
      });
      const totalAmount = sumMoney(amounts.map(({ totalPrice }) => totalPrice));

      const values = {
        organizationId,
        requesterId,
        number,
        title: input.title,
        description: input.description,
        departmentId: input.departmentId,
        projectId: input.projectId,
        priority: input.priority ?? 'normal',
        neededBy: input.neededBy ? new Date(input.neededBy) : null,
        currency: input.currency ?? 'USD',
        totalAmount,
        status: 'draft' as const,
        sourceType: 'manual',
        idempotencyKey: input.ownerIdempotencyKey,
      };
      const [req] = await tx.insert(requisitions).values(values).returning();
      if (!req) throw new Error('Requisition was not created');

      await tx.insert(requisitionLines).values(
        input.lines.map((l, i) => ({
          requisitionId: req.id,
          lineNumber: i + 1,
          description: l.description,
          quantity: String(l.quantity),
          unitOfMeasure: l.unitOfMeasure,
          unitPrice: amounts[i]?.unitPrice ?? '0.00',
          totalPrice: amounts[i]?.totalPrice ?? '0.00',
          vendorId: l.vendorId,
          catalogItemId: l.catalogItemId,
          glAccount: l.glAccount,
        })),
      );

      await this.audit.log(
        organizationId,
        requesterId,
        'requisition',
        req.id,
        'created',
        {
          number: req.number,
          title: input.title,
        },
        undefined,
        tx,
      );

      return { id: req.id };
    });

    const created = await this.findOne(creation.id, organizationId);
    await this.ensureSpendGuardAnalysis(organizationId, creation.id).catch(() => {});
    return created;
  }

  /** Re-run the idempotent analysis when a cross-module owner is recovered. */
  async ensureSpendGuardAnalysis(organizationId: string, requisitionId: string): Promise<void> {
    await this.spendGuard.analyzeRequisition(organizationId, requisitionId);
  }

  async update(
    id: string,
    organizationId: string,
    actorId: string,
    input: Partial<CreateRequisitionInput>,
    access?: AccessPolicy,
  ) {
    const req = await this.findOneForMutation(id, organizationId, actorId, access);
    const nextScope = {
      departmentId: input.departmentId ?? req.departmentId,
      projectId: input.projectId ?? req.projectId,
    };
    this.assertCanMutate(req, actorId, access, nextScope);
    if (req.status !== 'draft') {
      throw new BadRequestException('Only draft requisitions can be edited');
    }

    return this.db.transaction(async (tx) => {
      let totalAmount = parseFloat(String(req.totalAmount));

      if (input.lines) {
        await tx.delete(requisitionLines).where(eq(requisitionLines.requisitionId, id));
        totalAmount = input.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
        await tx.insert(requisitionLines).values(
          input.lines.map((l, i) => ({
            requisitionId: id,
            lineNumber: i + 1,
            description: l.description,
            quantity: String(l.quantity),
            unitOfMeasure: l.unitOfMeasure,
            unitPrice: String(l.unitPrice),
            totalPrice: String(l.quantity * l.unitPrice),
            vendorId: l.vendorId,
            catalogItemId: l.catalogItemId,
            glAccount: l.glAccount,
          })),
        );
      }

      await tx
        .update(requisitions)
        .set({
          title: input.title ?? req.title,
          description: input.description ?? req.description,
          departmentId: input.departmentId ?? req.departmentId,
          projectId: input.projectId ?? req.projectId,
          priority: input.priority ?? req.priority,
          currency: input.currency ?? req.currency,
          totalAmount: String(totalAmount),
          updatedAt: new Date(),
        })
        .where(eq(requisitions.id, id));

      return this.findOne(id, organizationId, access);
    });
  }

  async submit(id: string, organizationId: string, requesterId?: string, access?: AccessPolicy) {
    const req = await this.findOneForMutation(id, organizationId, requesterId ?? '', access);
    this.assertCanMutate(req, requesterId ?? req.requesterId, access);
    if (req.status !== 'draft') {
      throw new BadRequestException('Only draft requisitions can be submitted');
    }
    if (!req.lines || req.lines.length === 0) {
      throw new BadRequestException('Requisition must have at least one line item');
    }

    const actorId = requesterId ?? req.requesterId;
    const { budgetEnforcement, approvalResult, requiredApproval } =
      await this.budgets.withEnforcementLock(
        {
          organizationId,
          departmentId: req.departmentId,
          requestedAmount: req.totalAmount,
          currency: req.currency,
          fiscalYear: req.createdAt.getUTCFullYear(),
          excludeRequisitionId: req.id,
        },
        async (tx, decision) => {
          if (decision.action === 'block') {
            throw new BadRequestException(decision.message);
          }
          let requiredApproval: { approverId: string; reason: string; key: string } | undefined;
          if (decision.action === 'require_approval') {
            const ownerUserId = decision.ownerUserId;
            if (!ownerUserId) {
              throw new BadRequestException('An active budget owner is required for approval');
            }
            requiredApproval = {
              approverId: ownerUserId,
              reason: decision.message,
              key: `budget:${decision.budgetId}:requisition:${id}:owner:${ownerUserId}`,
            };
          }
          const approvalResult = await this.approvalEngine.initiateApproval(
            organizationId,
            'requisition',
            id,
            actorId,
            requiredApproval,
            async (approvalTx) => {
              const [transitioned] = await approvalTx
                .update(requisitions)
                .set({ status: 'pending_approval', submittedAt: new Date(), updatedAt: new Date() })
                .where(
                  and(
                    eq(requisitions.id, id),
                    eq(requisitions.organizationId, organizationId),
                    eq(requisitions.status, 'draft'),
                  ),
                )
                .returning({ id: requisitions.id });
              if (!transitioned) {
                throw new BadRequestException('Only draft requisitions can be submitted');
              }
            },
            tx,
            { budgetAvailable: decision.withinBudget, budgetDecision: decision },
          );
          return { budgetEnforcement: decision, approvalResult, requiredApproval };
        },
      );
    this.approvalEngine.publishInitiation(
      organizationId,
      'requisition',
      id,
      approvalResult,
      requiredApproval,
    );

    const submitted = await this.findOne(id, organizationId);
    this.webhookEvents.emit(organizationId, 'requisition.submitted', { requisition: submitted });
    this.audit
      .log(organizationId, actorId, 'requisition', id, 'submitted', {
        status: submitted.status,
        budgetEnforcement,
      })
      .catch(() => {});
    return { ...submitted, budgetEnforcement };
  }

  async cancel(id: string, organizationId: string, actorId?: string, access?: AccessPolicy) {
    const req = await this.findOneForMutation(id, organizationId, actorId ?? '', access);
    this.assertCanMutate(req, actorId ?? req.requesterId, access);
    if (['cancelled', 'converted'].includes(req.status)) {
      throw new BadRequestException(`Cannot cancel a ${req.status} requisition`);
    }

    const updated = await this.db.transaction(async (tx) => {
      const [transitioned] = await tx
        .update(requisitions)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(requisitions.id, id),
            eq(requisitions.organizationId, organizationId),
            ne(requisitions.status, 'cancelled'),
            ne(requisitions.status, 'converted'),
          ),
        )
        .returning();
      if (!transitioned) {
        throw new BadRequestException('Requisition status changed before cancellation');
      }
      await this.budgets.releaseRequisition(tx, organizationId, id, 'cancelled');
      return transitioned;
    });
    this.audit.log(organizationId, null, 'requisition', id, 'cancelled').catch(() => {});
    return withoutOwnerIdempotencyKey(updated);
  }

  private assertCanMutate(
    req: {
      requesterId: string;
      departmentId: string | null;
      projectId: string | null;
      status: string;
    },
    actorId: string,
    access?: AccessPolicy,
    nextScope?: { departmentId: string | null; projectId: string | null },
  ) {
    if (!access) return;
    if (access.can('requisitions:manage')) {
      const scope = access.scopeFor('requisition', 'requisitions:manage');
      if (
        scope.unrestricted ||
        scope.departmentIds.includes(nextScope?.departmentId ?? req.departmentId ?? '') ||
        scope.projectIds.includes(nextScope?.projectId ?? req.projectId ?? '')
      ) {
        return;
      }
    }
    if (
      access.can('requisitions:create') &&
      req.requesterId === actorId &&
      req.status === 'draft'
    ) {
      this.assertRequisitionScope(access, 'requisitions:create', nextScope ?? req);
      return;
    }
    throw new ForbiddenException('You do not have permission to manage this requisition');
  }

  private assertRequisitionScope(
    access: AccessPolicy | undefined,
    permission: 'requisitions:create' | 'requisitions:manage',
    requisition: { departmentId: string | null; projectId: string | null },
  ) {
    if (!access) return;
    const scope = access.scopeFor('requisition', permission);
    if (
      scope.unrestricted ||
      scope.departmentIds.includes(requisition.departmentId ?? '') ||
      scope.projectIds.includes(requisition.projectId ?? '')
    ) {
      return;
    }
    throw new ForbiddenException('The requisition is outside your assigned scope');
  }
}

function withoutOwnerIdempotencyKey<T extends { idempotencyKey?: unknown }>(row: T) {
  const { idempotencyKey: _privateOwnerKey, ...publicRow } = row;
  return publicRow;
}
