import {
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, sql, gte, inArray, lte } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db, DbTransaction } from '@betterspend/db';
import {
  approvalRules,
  approvalRuleSteps,
  approvalRequests,
  approvalActions,
  requisitions,
  purchaseOrders,
  systemSettings,
} from '@betterspend/db';
import { resolveOrganizationAdminId } from '../../common/demo-identity';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalDelegationsService } from '../approval-delegations/approval-delegations.service';
import { SettingsService } from '../settings/settings.service';
import { BudgetsService } from '../budgets/budgets.service';
import {
  WorkflowExecutionService,
  type WorkflowExecutionResult,
} from '../workflow-execution/workflow-execution.service';
import type { AccessPolicy } from '../auth/access-policy';
import {
  permissionScopePredicate,
  requireAnyPermission,
  requirePermission,
} from '../auth/access-scope';

type ApprovalScope = {
  departmentId: string | null;
  projectId: string | null;
  entityId: string | null;
};

function scopeAllowsApproval(
  access: AccessPolicy | undefined,
  scope: ApprovalScope,
  permission: 'approvals:view' | 'approvals:act' = 'approvals:view',
): boolean {
  if (!access) return true;
  if (!access.can(permission)) return false;
  const grant = access.scopeFor('approval', permission);
  if (
    grant.unrestricted ||
    grant.departmentIds.includes(scope.departmentId ?? '') ||
    grant.projectIds.includes(scope.projectId ?? '') ||
    grant.entityIds.includes(scope.entityId ?? '')
  ) {
    return true;
  }
  return false;
}

function scopeAllowsApprovalForAnyReadPermission(
  access: AccessPolicy | undefined,
  scope: ApprovalScope,
): boolean {
  return (
    scopeAllowsApproval(access, scope, 'approvals:view') ||
    scopeAllowsApproval(access, scope, 'approvals:act')
  );
}

function roleAssignmentMatchesApprovalScope(
  assignment: { scopeType: string; scopeId: string | null },
  scope: ApprovalScope,
  departmentHead: boolean,
): boolean {
  if (assignment.scopeType === 'global') return true;
  if (departmentHead) {
    return assignment.scopeType === 'department' && assignment.scopeId === scope.departmentId;
  }
  if (assignment.scopeType === 'department') return assignment.scopeId === scope.departmentId;
  if (assignment.scopeType === 'project') return assignment.scopeId === scope.projectId;
  if (assignment.scopeType === 'entity') return assignment.scopeId === scope.entityId;
  return false;
}

function uuidArray(ids: string[]) {
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
}

export interface RequiredApproval {
  approverId: string;
  reason: string;
  key: string;
  only?: boolean;
}

@Injectable()
export class ApprovalEngineService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly webhookEvents: WebhookEventService,
    @Optional() private readonly notifications: NotificationsService,
    @Optional() private readonly delegations: ApprovalDelegationsService,
    @Optional() private readonly settingsService: SettingsService,
    private readonly budgets: BudgetsService,
    @Optional() private readonly workflowExecution?: WorkflowExecutionService,
  ) {}

  // Evaluate a JSONB condition expression against an entity object
  evaluateCondition(condition: any, entity: Record<string, any>): boolean {
    if (!condition) return true;

    if (condition.operator === 'AND') {
      return condition.conditions.every((c: any) => this.evaluateCondition(c, entity));
    }
    if (condition.operator === 'OR') {
      return condition.conditions.some((c: any) => this.evaluateCondition(c, entity));
    }

    const fieldValue = parseFloat(entity[condition.field]) || entity[condition.field];
    const condValue = condition.value;

    switch (condition.operator) {
      case '>=':
        return Number(fieldValue) >= Number(condValue);
      case '>':
        return Number(fieldValue) > Number(condValue);
      case '<=':
        return Number(fieldValue) <= Number(condValue);
      case '<':
        return Number(fieldValue) < Number(condValue);
      case '==':
      case 'eq':
        return String(fieldValue) === String(condValue);
      case '!=':
      case 'neq':
        return String(fieldValue) !== String(condValue);
      default:
        return false;
    }
  }

  // Find the first matching rule for an entity
  async findMatchingRule(
    organizationId: string,
    entityType: string,
    entity: Record<string, any>,
    executor: Db | DbTransaction = this.db,
  ) {
    const rules = await executor.query.approvalRules.findMany({
      where: (r, { and, eq }) => and(eq(r.organizationId, organizationId), eq(r.isActive, true)),
      with: { steps: true },
      orderBy: (r, { asc }) => asc(r.priority),
    });

    for (const rule of rules) {
      let conditions: any = {};
      try {
        conditions =
          typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions;
      } catch {
        conditions = {};
      }
      if (this.evaluateCondition(conditions, entity)) {
        return rule;
      }
    }
    return null;
  }

  // Check if a requisition qualifies for fast-lane auto-approval based on threshold setting
  private async checkFastLaneAutoApproval(
    organizationId: string,
    entity: Record<string, any>,
    executor: Db | DbTransaction = this.db,
  ): Promise<{ eligible: boolean; threshold: number; notifyManager: boolean }> {
    if (!this.settingsService) {
      return { eligible: false, threshold: 0, notifyManager: false };
    }

    const thresholdStr = await this.settingsService.get(
      organizationId,
      'auto_approve_threshold',
      executor,
    );
    const notifyManagerStr = await this.settingsService.get(
      organizationId,
      'auto_approve_notify_manager',
      executor,
    );

    const threshold = parseFloat(thresholdStr || '0');
    const notifyManager = notifyManagerStr !== 'false';

    if (threshold <= 0) {
      return { eligible: false, threshold: 0, notifyManager };
    }

    const totalAmount = parseFloat(entity.totalAmount ?? entity.total_amount ?? '0');
    const eligible = totalAmount <= threshold;

    return { eligible, threshold, notifyManager };
  }

  // Initiate approval flow for a submitted entity
  async initiateApproval(
    organizationId: string,
    entityType: 'requisition' | 'purchase_order',
    entityId: string,
    initiatedBy: string,
    requiredApproval?: RequiredApproval,
    beforePersist?: (tx: DbTransaction) => Promise<void>,
    transaction?: DbTransaction,
    workflowContext: Record<string, unknown> = {},
  ) {
    const executor = transaction ?? this.db;
    // Fetch entity for condition evaluation
    let entity: Record<string, any> | null = null;
    if (entityType === 'requisition') {
      entity =
        (await executor.query.requisitions.findFirst({
          where: (r, { and, eq }) => and(eq(r.id, entityId), eq(r.organizationId, organizationId)),
        })) ?? null;
    } else {
      entity =
        (await executor.query.purchaseOrders.findFirst({
          where: (p, { and, eq }) => and(eq(p.id, entityId), eq(p.organizationId, organizationId)),
        })) ?? null;
    }
    if (!entity) throw new NotFoundException(`Entity ${entityId} not found`);

    if (requiredApproval) {
      const approver = await executor.query.users.findFirst({
        where: (record, { and, eq }) =>
          and(
            eq(record.id, requiredApproval.approverId),
            eq(record.organizationId, organizationId),
            eq(record.isActive, true),
          ),
      });
      if (!approver) {
        throw new BadRequestException(
          'The required approver must be an active user in this organization',
        );
      }
    }

    const workflowResult = await this.workflowExecution?.initiateIfConfigured(
      organizationId,
      entityType,
      entityId,
      initiatedBy,
      requiredApproval,
      beforePersist,
      transaction,
      workflowContext,
    );
    if (workflowResult) {
      if (!transaction) {
        this.publishInitiation(
          organizationId,
          entityType,
          entityId,
          workflowResult,
          requiredApproval,
        );
      }
      return workflowResult;
    }

    // A required budget-owner approval always wins over the fast lane.
    if (entityType === 'requisition' && !requiredApproval) {
      const { eligible, threshold, notifyManager } = await this.checkFastLaneAutoApproval(
        organizationId,
        entity,
        executor,
      );
      if (eligible) {
        return this.applyFastLaneApproval(
          organizationId,
          entityId,
          entity,
          threshold,
          notifyManager,
          initiatedBy,
          beforePersist,
          transaction,
        );
      }
    }

    const rule = requiredApproval?.only
      ? null
      : await this.findMatchingRule(organizationId, entityType, entity, executor);

    if ((!rule || !rule.steps || rule.steps.length === 0) && !requiredApproval) {
      // No matching rule → auto-approve
      await this.runInTransaction(transaction, async (tx) => {
        await beforePersist?.(tx);
        if (entityType === 'requisition') {
          const [transitioned] = await tx
            .update(requisitions)
            .set({ status: 'approved', updatedAt: new Date() })
            .where(
              and(
                eq(requisitions.id, entityId),
                eq(requisitions.organizationId, organizationId),
                inArray(requisitions.status, ['submitted', 'pending_approval']),
              ),
            )
            .returning({ id: requisitions.id });
          if (!transitioned) {
            throw new BadRequestException('Requisition status changed before auto-approval');
          }
          await this.budgets.recordRequisitionApproval(tx, organizationId, entityId);
        } else {
          const [transitioned] = await tx
            .update(purchaseOrders)
            .set({ status: 'approved', updatedAt: new Date() })
            .where(
              and(
                eq(purchaseOrders.id, entityId),
                eq(purchaseOrders.organizationId, organizationId),
                eq(purchaseOrders.status, 'pending_approval'),
              ),
            )
            .returning({ id: purchaseOrders.id });
          if (!transitioned) {
            throw new BadRequestException('Purchase order status changed before auto-approval');
          }
        }
      });
      if (entityType === 'requisition') {
        if (!transaction) {
          this.webhookEvents.emit(organizationId, 'requisition.approved', {
            requisitionId: entityId,
            autoApproved: true,
          });
        }
      } else {
        if (!transaction) {
          this.webhookEvents.emit(organizationId, 'po.approved', {
            purchaseOrderId: entityId,
            autoApproved: true,
          });
        }
      }
      return { autoApproved: true, rule: null };
    }

    // Sort steps by stepOrder
    const sortedSteps = [...(rule?.steps ?? [])].sort((a, b) => a.stepOrder - b.stepOrder);
    const firstStep = sortedSteps[0];
    const requiredApprovalStep = requiredApproval
      ? Math.max(0, ...sortedSteps.map((step) => step.stepOrder)) + 1
      : null;
    const currentStep = firstStep?.stepOrder ?? requiredApprovalStep;
    if (currentStep == null) {
      throw new BadRequestException('Approval flow has no approver steps');
    }

    for (const step of sortedSteps) {
      if (!step.approverId) continue;
      const approver = await executor.query.users.findFirst({
        where: (record, { and, eq }) =>
          and(
            eq(record.id, step.approverId!),
            eq(record.organizationId, organizationId),
            eq(record.isActive, true),
          ),
      });
      if (!approver) {
        throw new BadRequestException(
          'Every fixed approval approver must be an active user in this organization',
        );
      }
    }

    // Resolve delegation: if the first-step approver has delegated, route to delegatee
    let effectiveApproverId = initiatedBy;
    if (this.delegations && firstStep?.approverId) {
      const delegatee = await this.delegations.getActiveDelegatee(
        organizationId,
        firstStep.approverId,
        executor,
      );
      if (delegatee) {
        effectiveApproverId = delegatee;
      }
    }

    const requestId = await this.runInTransaction(transaction, async (tx) => {
      await beforePersist?.(tx);
      const [req] = await tx
        .insert(approvalRequests)
        .values({
          organizationId,
          approvableType: entityType,
          approvableId: entityId,
          approvalRuleId: rule?.id ?? null,
          initiatedBy,
          currentStep,
          status: 'pending',
          requiredApproverId: requiredApproval?.approverId ?? null,
          requiredApprovalStep,
          requiredApprovalReason: requiredApproval?.reason ?? null,
          requiredApprovalKey: requiredApproval?.key ?? null,
        })
        .returning();

      // Record the submission action
      await tx.insert(approvalActions).values({
        approvalRequestId: req.id,
        stepOrder: currentStep,
        approverId: firstStep ? effectiveApproverId : initiatedBy,
        action: 'submitted',
        comment:
          firstStep && effectiveApproverId !== initiatedBy
            ? `Submitted for approval (delegated from original approver)`
            : (requiredApproval?.reason ?? 'Submitted for approval'),
      });

      return req.id;
    });

    const result = {
      autoApproved: false as const,
      rule,
      requestId,
      initialApproverId: firstStep ? effectiveApproverId : requiredApproval?.approverId,
    };
    if (!transaction) {
      this.publishInitiation(organizationId, entityType, entityId, result, requiredApproval);
    }
    return result;
  }

  publishInitiation(
    organizationId: string,
    entityType: 'requisition' | 'purchase_order',
    entityId: string,
    result:
      | {
          autoApproved: boolean;
          fastLane?: boolean;
          threshold?: number;
          requestId?: string;
          initialApproverId?: string;
          rule?: {
            name: string;
            steps?: Array<{ stepOrder: number; approverId?: string | null }>;
          } | null;
        }
      | WorkflowExecutionResult,
    requiredApproval?: RequiredApproval,
  ): void {
    if ('workflow' in result && result.workflow) {
      this.workflowExecution?.publishInitiation(result).catch(() => {});
      return;
    }
    if (result.autoApproved) {
      const event = entityType === 'requisition' ? 'requisition.approved' : 'po.approved';
      const payload =
        entityType === 'requisition'
          ? {
              requisitionId: entityId,
              autoApproved: true,
              fastLane: result.fastLane,
              threshold: result.threshold,
            }
          : { purchaseOrderId: entityId, autoApproved: true };
      this.webhookEvents.emit(organizationId, event, payload);
      return;
    }
    this.webhookEvents.emit(organizationId, 'approval.requested', {
      requestId: result.requestId,
      entityType,
      entityId,
      ruleName: result.rule?.name ?? null,
      requiredApproverId: requiredApproval?.approverId ?? null,
    });
    if (!this.notifications) return;

    const entityLabel = entityType === 'requisition' ? 'Requisition' : 'Purchase Order';
    const hasRuleStep = !!result.rule?.steps?.length;
    const firstRuleStep = result.rule?.steps
      ?.slice()
      .sort((left, right) => left.stepOrder - right.stepOrder)[0];
    const resolvedInitialApproverId =
      'initialApproverId' in result ? result.initialApproverId : undefined;
    const approvalDescription = hasRuleStep
      ? `A ${entityLabel.toLowerCase()} requires your approval (rule: ${result.rule!.name}).`
      : (requiredApproval?.reason ?? 'Approval is required.');
    const notify = (initialApproverId: string) =>
      this.notifications!
        .create(
          organizationId,
          initialApproverId,
          'approval_request',
          `Approval Required: ${entityLabel}`,
          approvalDescription,
          entityType,
          entityId,
        )
        .catch(() => {});
    const initialApproverId =
      resolvedInitialApproverId ?? firstRuleStep?.approverId ?? requiredApproval?.approverId;
    if (initialApproverId) {
      void notify(initialApproverId);
      return;
    }
    if (hasRuleStep) {
      void resolveOrganizationAdminId(this.db, organizationId)
        .then((adminId) => {
          if (adminId) return notify(adminId);
        })
        .catch(() => {});
    }
  }

  private runInTransaction<T>(
    transaction: DbTransaction | undefined,
    run: (tx: DbTransaction) => Promise<T>,
  ): Promise<T> {
    return transaction ? run(transaction) : this.db.transaction(run);
  }

  private async getApprovalScope(
    tx: DbTransaction,
    approvalReq: typeof approvalRequests.$inferSelect,
  ): Promise<ApprovalScope> {
    if (approvalReq.approvableType === 'requisition') {
      const requisition = await tx.query.requisitions.findFirst({
        where: (record, { and, eq }) =>
          and(
            eq(record.id, approvalReq.approvableId),
            eq(record.organizationId, approvalReq.organizationId),
          ),
      });
      return {
        departmentId: requisition?.departmentId ?? null,
        projectId: requisition?.projectId ?? null,
        entityId: null,
      };
    }

    const purchaseOrder =
      approvalReq.approvableType === 'purchase_order'
        ? await tx.query.purchaseOrders.findFirst({
            where: (record, { and, eq }) =>
              and(
                eq(record.id, approvalReq.approvableId),
                eq(record.organizationId, approvalReq.organizationId),
              ),
          })
        : null;
    if (approvalReq.approvableType === 'invoice') {
      const invoice = await tx.query.invoices.findFirst({
        where: (record, { and, eq }) =>
          and(
            eq(record.id, approvalReq.approvableId),
            eq(record.organizationId, approvalReq.organizationId),
          ),
      });
      const invoicePo = invoice?.purchaseOrderId
        ? await tx.query.purchaseOrders.findFirst({
            where: (record, { and, eq }) =>
              and(
                eq(record.id, invoice.purchaseOrderId!),
                eq(record.organizationId, approvalReq.organizationId),
              ),
          })
        : null;
      const invoiceReq = invoicePo?.requisitionId
        ? await tx.query.requisitions.findFirst({
            where: (record, { and, eq }) =>
              and(
                eq(record.id, invoicePo.requisitionId!),
                eq(record.organizationId, approvalReq.organizationId),
              ),
          })
        : null;
      return {
        departmentId: invoiceReq?.departmentId ?? null,
        projectId: invoiceReq?.projectId ?? null,
        entityId: invoice?.entityId ?? invoicePo?.entityId ?? null,
      };
    }
    const requisition = purchaseOrder?.requisitionId
      ? await tx.query.requisitions.findFirst({
          where: (record, { and, eq }) =>
            and(
              eq(record.id, purchaseOrder.requisitionId!),
              eq(record.organizationId, approvalReq.organizationId),
            ),
        })
      : null;
    return {
      departmentId: requisition?.departmentId ?? null,
      projectId: requisition?.projectId ?? null,
      entityId: purchaseOrder?.entityId ?? null,
    };
  }

  private async assertDynamicRuleApprover(
    tx: DbTransaction,
    approvalReq: typeof approvalRequests.$inferSelect,
    step: typeof approvalRuleSteps.$inferSelect,
    actorId: string,
    organizationId?: string,
  ): Promise<void> {
    if (!organizationId) {
      throw new BadRequestException('The current approval step has no assigned approver');
    }
    const actor = await tx.query.users.findFirst({
      where: (record, { and, eq }) =>
        and(
          eq(record.id, actorId),
          eq(record.organizationId, organizationId),
          eq(record.isActive, true),
        ),
      with: { userRoles: true },
    });
    if (!actor) throw new ForbiddenException('The current approval step is assigned elsewhere');

    if (step.approverType === 'budget_owner') {
      const scope = await this.getApprovalScope(tx, approvalReq);
      const department = scope.departmentId
        ? await tx.query.departments.findFirst({
            where: (record, { and, eq }) =>
              and(eq(record.id, scope.departmentId!), eq(record.organizationId, organizationId)),
          })
        : null;
      if (!department?.budgetOwnerId) {
        throw new BadRequestException('The current approval step has no assigned approver');
      }
      if (department.budgetOwnerId === actorId) return;
      const delegatee = this.delegations
        ? await this.delegations.getActiveDelegatee(organizationId, department.budgetOwnerId, tx)
        : null;
      if (delegatee === actorId) return;
      throw new ForbiddenException('The current approval step is assigned elsewhere');
    }

    const matchingRole =
      step.approverType === 'role'
        ? step.approverRole
        : step.approverType === 'department_head'
          ? 'approver'
          : null;
    if (!matchingRole) {
      throw new BadRequestException('The current approval step has no assigned approver');
    }
    const roleAssignments = actor.userRoles.filter(
      (assignment) => assignment.role === matchingRole,
    );
    if (roleAssignments.some((assignment) => assignment.scopeType === 'global')) return;

    const scope = await this.getApprovalScope(tx, approvalReq);
    const authorized = roleAssignments.some((assignment) => {
      return roleAssignmentMatchesApprovalScope(
        assignment,
        scope,
        step.approverType === 'department_head',
      );
    });
    if (!authorized)
      throw new ForbiddenException('The current approval step is assigned elsewhere');
  }

  async hasCompletedRequiredApproval(
    entityType: 'requisition' | 'purchase_order',
    entityId: string,
    approverId: string,
    key: string,
    approvedAtOrAfter: Date,
  ): Promise<boolean> {
    const request = await this.db.query.approvalRequests.findFirst({
      where: (record, { and, eq, gte }) =>
        and(
          eq(record.approvableType, entityType),
          eq(record.approvableId, entityId),
          eq(record.status, 'approved'),
          eq(record.requiredApproverId, approverId),
          eq(record.requiredApprovalKey, key),
          gte(record.updatedAt, approvedAtOrAfter),
        ),
    });
    return !!request;
  }

  // Apply fast-lane auto-approval for low-value requisitions
  private async applyFastLaneApproval(
    organizationId: string,
    entityId: string,
    entity: Record<string, any>,
    threshold: number,
    notifyManager: boolean,
    initiatedBy: string,
    beforePersist?: (tx: DbTransaction) => Promise<void>,
    transaction?: DbTransaction,
  ) {
    const totalAmount = parseFloat(entity.totalAmount ?? entity.total_amount ?? '0');
    const note = `Auto-approved: requisition total $${totalAmount.toFixed(2)} is below the configured threshold of $${threshold.toFixed(2)}`;

    // Create an approval request in auto-approved state and record the action
    const requestId = await this.runInTransaction(transaction, async (tx) => {
      const systemUserId = await resolveOrganizationAdminId(tx, organizationId);
      if (!systemUserId) {
        throw new BadRequestException('No active organization administrator is configured');
      }
      await beforePersist?.(tx);
      const [req] = await tx
        .insert(approvalRequests)
        .values({
          organizationId,
          approvableType: 'requisition',
          approvableId: entityId,
          approvalRuleId: null,
          initiatedBy,
          currentStep: 1,
          status: 'approved',
        })
        .returning();

      // Record submission action
      await tx.insert(approvalActions).values({
        approvalRequestId: req.id,
        stepOrder: 1,
        approverId: initiatedBy,
        action: 'submitted',
        comment: 'Submitted for approval',
      });

      // Record auto-approved action
      await tx.insert(approvalActions).values({
        approvalRequestId: req.id,
        stepOrder: 1,
        approverId: systemUserId,
        action: 'approved',
        comment: notifyManager ? note : 'Auto-approved: below configured threshold',
      });

      const [transitioned] = await tx
        .update(requisitions)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(
          and(
            eq(requisitions.id, entityId),
            eq(requisitions.organizationId, organizationId),
            inArray(requisitions.status, ['submitted', 'pending_approval']),
          ),
        )
        .returning({ id: requisitions.id });
      if (!transitioned) {
        throw new BadRequestException('Requisition status changed before fast-lane approval');
      }
      await this.budgets.recordRequisitionApproval(tx, organizationId, entityId);

      return req.id;
    });

    if (!transaction) {
      this.webhookEvents.emit(organizationId, 'requisition.approved', {
        requisitionId: entityId,
        autoApproved: true,
        fastLane: true,
        threshold,
      });
    }

    return { autoApproved: true, fastLane: true, rule: null, requestId };
  }

  // Get auto-approved summary for the current calendar month
  async getAutoApprovedSummary(
    organizationId: string,
    access?: AccessPolicy,
  ): Promise<{ count: number; totalAmount: number }> {
    requirePermission(access, 'approvals:view');
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Find approval requests that were auto-approved (no rule, status approved) for this org's requisitions
    // We detect fast-lane auto-approvals by looking for approval_requests with status='approved' and
    // an action comment containing 'Auto-approved: requisition total'
    const scopePredicate = permissionScopePredicate(access, 'requisition', ['approvals:view'], {
      department: (departmentId) => sql`r.department_id = ${departmentId}`,
      project: (projectId) => sql`r.project_id = ${projectId}`,
    });
    const rows = (await this.db.execute(sql`
      SELECT
        COUNT(DISTINCT ar.id)::int AS count,
        COALESCE(SUM(r.total_amount), 0) AS total_amount
      FROM approval_requests ar
      INNER JOIN approval_actions aa ON aa.approval_request_id = ar.id
        AND aa.action = 'approved'
        AND (aa.comment LIKE 'Auto-approved:%' OR aa.comment LIKE 'Auto-approved:%')
      INNER JOIN requisitions r ON r.id = ar.approvable_id
        AND ar.approvable_type = 'requisition'
        AND r.organization_id = ${organizationId}
      WHERE ar.status = 'approved'
        AND ar.created_at >= ${startOfMonth.toISOString()}
        AND ar.created_at <= ${endOfMonth.toISOString()}
        AND ${scopePredicate}
    `)) as any[];

    const row = rows[0] ?? { count: 0, total_amount: '0' };
    return {
      count: Number(row.count ?? 0),
      totalAmount: parseFloat(row.total_amount ?? '0'),
    };
  }

  // Enrich approval requests with entity summary (title/number, link, amount)
  private async enrichWithEntityInfo(rows: any[]): Promise<any[]> {
    if (!rows.length) return rows;

    const reqIds = rows
      .filter((r) => r.approvableType === 'requisition')
      .map((r) => r.approvableId);
    const poIds = rows
      .filter((r) => r.approvableType === 'purchase_order')
      .map((r) => r.approvableId);
    const invoiceIds = rows
      .filter((r) => r.approvableType === 'invoice')
      .map((r) => r.approvableId);

    const [reqMap, poMap, invoiceMap]: [
      Record<string, any>,
      Record<string, any>,
      Record<string, any>,
    ] = await Promise.all([
      reqIds.length
        ? this.db
            .execute(
              sql`
        SELECT id, number, title, total_amount AS amount, currency, status,
          department_id AS "departmentId", project_id AS "projectId", NULL::uuid AS "entityId"
        FROM requisitions
        WHERE id = ANY(${uuidArray(reqIds)})
      `,
            )
            .then((rows) => Object.fromEntries((rows as any[]).map((r) => [r.id, r])))
        : {},
      poIds.length
        ? this.db
            .execute(
              sql`
        SELECT po.id, po.number, v.name AS "vendorName", po.total_amount AS amount, po.currency, po.status,
          r.department_id AS "departmentId", r.project_id AS "projectId", po.entity_id AS "entityId"
        FROM purchase_orders po
        LEFT JOIN requisitions r ON r.id = po.requisition_id
        LEFT JOIN vendors v ON v.id = po.vendor_id
        WHERE po.id = ANY(${uuidArray(poIds)})
      `,
            )
            .then((rows) => Object.fromEntries((rows as any[]).map((r) => [r.id, r])))
        : {},
      invoiceIds.length
        ? this.db
            .execute(
              sql`
        SELECT i.id, i.internal_number AS "internalNumber", i.invoice_number AS "invoiceNumber",
          v.name AS "vendorName", i.total_amount AS amount, i.currency, i.match_status AS "matchStatus",
          i.due_date AS "dueDate", i.status, i.entity_id AS "entityId",
          r.department_id AS "departmentId", r.project_id AS "projectId"
        FROM invoices i
        LEFT JOIN vendors v ON v.id = i.vendor_id
        LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
        LEFT JOIN requisitions r ON r.id = po.requisition_id
        WHERE i.id = ANY(${uuidArray(invoiceIds)})
      `,
            )
            .then((rows) => Object.fromEntries((rows as any[]).map((r) => [r.id, r])))
        : {},
    ]);

    return rows.map((r) => {
      const entity =
        r.approvableType === 'requisition'
          ? reqMap[r.approvableId]
          : r.approvableType === 'purchase_order'
            ? poMap[r.approvableId]
            : invoiceMap[r.approvableId];
      return { ...r, entitySummary: entity ?? null };
    });
  }

  // Get approval request with actions and rule steps
  async getRequest(
    id: string,
    organizationId: string,
    _actorId?: string,
    access?: AccessPolicy,
    requiredPermission?: 'approvals:view' | 'approvals:act',
  ) {
    requireAnyPermission(access, ['approvals:view', 'approvals:act']);
    const req = await this.db.query.approvalRequests.findFirst({
      where: (r, { and, eq }) => and(eq(r.id, id), eq(r.organizationId, organizationId)),
      with: {
        actions: { orderBy: (a, { asc }) => asc(a.actedAt) },
        rule: { with: { steps: true } },
      },
    });
    if (!req) throw new NotFoundException(`Approval request ${id} not found`);
    const [enriched] = await this.enrichWithEntityInfo([req]);
    const inScope = requiredPermission
      ? scopeAllowsApproval(access, enriched.entitySummary ?? {}, requiredPermission)
      : scopeAllowsApprovalForAnyReadPermission(access, enriched.entitySummary ?? {});
    if (!inScope) {
      throw new NotFoundException(`Approval request ${id} not found`);
    }
    return enriched;
  }

  // List all pending requests for an organization.
  async listPending(organizationId: string, actorId?: string, access?: AccessPolicy) {
    requirePermission(access, 'approvals:view');
    if (!actorId) return [];
    const rows = await this.db.query.approvalRequests.findMany({
      where: (record, { and, eq }) =>
        and(eq(record.organizationId, organizationId), eq(record.status, 'pending')),
      with: {
        rule: { with: { steps: true } },
        actions: { orderBy: (a, { desc }) => desc(a.actedAt) },
      },
      orderBy: (r, { asc }) => asc(r.createdAt),
    });
    const actor = actorId
      ? await this.db.query.users.findFirst({
          where: (user, { and, eq }) =>
            and(eq(user.id, actorId), eq(user.organizationId, organizationId)),
          with: { userRoles: true },
        })
      : null;
    const enriched = await this.enrichWithEntityInfo(rows);
    const pending = await Promise.all(
      enriched.map(async (row) => {
        const currentStep = row.rule?.steps?.find(
          (step: { stepOrder: number }) => step.stepOrder === row.currentStep,
        );
        const approverRole =
          currentStep?.approverType === 'role'
            ? currentStep.approverRole
            : currentStep?.approverType === 'department_head'
              ? 'approver'
              : null;
        const roleAssigned = approverRole
          ? actor?.userRoles.some(
              (assignment) =>
                assignment.role === approverRole &&
                roleAssignmentMatchesApprovalScope(
                  assignment,
                  row.entitySummary ?? {},
                  currentStep?.approverType === 'department_head',
                ),
            )
          : false;
        const delegateApproverIds = [row.requiredApproverId, currentStep?.approverId].filter(
          (approverId): approverId is string => !!approverId,
        );
        const delegatedToActor =
          !!actorId &&
          !!this.delegations &&
          (
            await Promise.all(
              delegateApproverIds.map((approverId) =>
                this.delegations!.getActiveDelegatee(organizationId, approverId, this.db),
              ),
            )
          ).includes(actorId);
        const actorAssigned =
          row.requiredApproverId === actorId ||
          currentStep?.approverId === actorId ||
          delegatedToActor ||
          roleAssigned;
        return { row, actorAssigned };
      }),
    );
    return pending
      .filter(
        ({ row, actorAssigned }) =>
          actorAssigned && scopeAllowsApproval(access, row.entitySummary ?? {}),
      )
      .map(({ row }) => row);
  }

  // Process an approve or reject action
  async processAction(
    requestId: string,
    actorId: string,
    action: 'approve' | 'reject',
    comment: string | undefined,
    organizationId: string,
    access?: AccessPolicy,
  ) {
    requirePermission(access, 'approvals:act');
    if (
      this.workflowExecution &&
      (await this.workflowExecution.isVersionedRequest(requestId, organizationId))
    ) {
      const request = await this.getRequest(
        requestId,
        organizationId,
        actorId,
        access,
        'approvals:act',
      );
      if (!scopeAllowsApproval(access, request.entitySummary ?? {}, 'approvals:act')) {
        throw new ForbiddenException('This approval request is outside your assigned scope');
      }
      return this.workflowExecution.processAction(
        requestId,
        actorId,
        action,
        comment,
        organizationId,
      );
    }
    const outcome = await this.db.transaction(async (tx) => {
      const [approvalReq] = await tx
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, requestId))
        .for('update');
      if (!approvalReq) throw new NotFoundException(`Approval request ${requestId} not found`);
      await this.assertApprovalRequestOrganization(tx, approvalReq, organizationId);
      const actor = await tx.query.users.findFirst({
        where: (record, { and, eq }) =>
          and(
            eq(record.id, actorId),
            eq(record.organizationId, organizationId),
            eq(record.isActive, true),
          ),
      });
      if (!actor) throw new ForbiddenException('The approval actor is not an active user here');
      const approvalScope = await this.getApprovalScope(tx, approvalReq);
      if (!scopeAllowsApproval(access, approvalScope, 'approvals:act')) {
        throw new ForbiddenException('This approval request is outside your assigned scope');
      }
      if (approvalReq.status !== 'pending') {
        throw new BadRequestException(`Request is already ${approvalReq.status}`);
      }

      const rule = approvalReq.approvalRuleId
        ? await tx.query.approvalRules.findFirst({
            where: (record, { and, eq }) =>
              and(
                eq(record.id, approvalReq.approvalRuleId!),
                eq(record.organizationId, organizationId),
              ),
            with: { steps: true },
          })
        : null;
      const sortedSteps = [...(rule?.steps ?? [])].sort((a, b) => a.stepOrder - b.stepOrder);
      const atRequiredApproval = approvalReq.requiredApprovalStep === approvalReq.currentStep;
      if (
        atRequiredApproval &&
        approvalReq.requiredApproverId &&
        approvalReq.requiredApproverId !== actorId
      ) {
        const delegatee =
          this.delegations && organizationId
            ? await this.delegations.getActiveDelegatee(
                organizationId,
                approvalReq.requiredApproverId,
                tx,
              )
            : null;
        if (delegatee !== actorId) {
          throw new ForbiddenException('This approval step is assigned to the budget owner');
        }
      }
      const currentRuleStep = atRequiredApproval
        ? undefined
        : sortedSteps.find((step) => step.stepOrder === approvalReq.currentStep);
      if (!atRequiredApproval && !currentRuleStep) {
        throw new BadRequestException('The current approval step is no longer configured');
      }
      if (currentRuleStep && !currentRuleStep.approverId) {
        await this.assertDynamicRuleApprover(
          tx,
          approvalReq,
          currentRuleStep,
          actorId,
          organizationId,
        );
      } else if (currentRuleStep?.approverId && currentRuleStep.approverId !== actorId) {
        const delegatee =
          this.delegations && organizationId
            ? await this.delegations.getActiveDelegatee(
                organizationId,
                currentRuleStep.approverId,
                tx,
              )
            : null;
        if (delegatee !== actorId) {
          throw new ForbiddenException('This approval step is assigned to another approver');
        }
      }
      const nextRuleStep = atRequiredApproval
        ? undefined
        : sortedSteps.find((step) => step.stepOrder > approvalReq.currentStep);
      const nextStep =
        nextRuleStep?.stepOrder ??
        (!atRequiredApproval &&
        approvalReq.requiredApprovalStep != null &&
        approvalReq.requiredApprovalStep > approvalReq.currentStep
          ? approvalReq.requiredApprovalStep
          : undefined);
      const now = new Date();

      await tx.insert(approvalActions).values({
        approvalRequestId: requestId,
        stepOrder: approvalReq.currentStep,
        approverId: actorId,
        action,
        comment: comment ?? null,
      });

      if (action === 'reject') {
        await tx
          .update(approvalRequests)
          .set({ status: 'rejected', updatedAt: now })
          .where(eq(approvalRequests.id, requestId));
        await this.updateEntityStatus(
          tx,
          organizationId,
          approvalReq.approvableType,
          approvalReq.approvableId,
          'rejected',
          now,
        );
        return {
          result: { status: 'rejected' as const },
          approvalReq,
          entityStatus: 'rejected' as const,
        };
      }

      if (nextStep != null) {
        await tx
          .update(approvalRequests)
          .set({ currentStep: nextStep, updatedAt: now })
          .where(eq(approvalRequests.id, requestId));
        await tx.insert(approvalActions).values({
          approvalRequestId: requestId,
          stepOrder: nextStep,
          approverId: actorId,
          action: 'forwarded',
          comment: `Advanced to step ${nextStep}`,
        });
        return {
          result: { status: 'pending' as const, advancedToStep: nextStep },
          approvalReq,
          notifyRequiredOwner: nextStep === approvalReq.requiredApprovalStep,
        };
      }

      await tx
        .update(approvalRequests)
        .set({ status: 'approved', updatedAt: now })
        .where(eq(approvalRequests.id, requestId));
      await this.updateEntityStatus(
        tx,
        organizationId,
        approvalReq.approvableType,
        approvalReq.approvableId,
        'approved',
        now,
      );
      return {
        result: { status: 'approved' as const },
        approvalReq,
        entityStatus: 'approved' as const,
      };
    });

    if (
      outcome.notifyRequiredOwner &&
      this.notifications &&
      organizationId &&
      outcome.approvalReq.requiredApproverId
    ) {
      this.notifications
        .create(
          organizationId,
          outcome.approvalReq.requiredApproverId,
          'approval_request',
          'Budget Owner Approval Required',
          outcome.approvalReq.requiredApprovalReason ?? 'A budget overrun requires your approval.',
          outcome.approvalReq.approvableType,
          outcome.approvalReq.approvableId,
        )
        .catch(() => {});
    }
    if (outcome.entityStatus && organizationId) {
      this.emitEntityStatusEvents(
        organizationId,
        outcome.approvalReq.approvableType,
        outcome.approvalReq.approvableId,
        outcome.entityStatus,
      );
    }
    return outcome.result;
  }

  private async updateEntityStatus(
    tx: DbTransaction,
    organizationId: string,
    entityType: string,
    entityId: string,
    status: 'approved' | 'rejected',
    updatedAt: Date,
  ) {
    if (entityType === 'requisition') {
      const [transitioned] = await tx
        .update(requisitions)
        .set({ status, updatedAt })
        .where(
          and(
            eq(requisitions.id, entityId),
            eq(requisitions.organizationId, organizationId),
            inArray(requisitions.status, ['submitted', 'pending_approval']),
          ),
        )
        .returning({ id: requisitions.id });
      if (!transitioned) {
        throw new BadRequestException('Requisition status changed before approval completed');
      }
      if (status === 'approved') {
        await this.budgets.recordRequisitionApproval(tx, organizationId, entityId);
      } else {
        await this.budgets.releaseRequisition(tx, organizationId, entityId, 'rejected');
      }
    } else if (entityType === 'purchase_order') {
      const [transitioned] = await tx
        .update(purchaseOrders)
        .set({ status, updatedAt })
        .where(
          and(
            eq(purchaseOrders.id, entityId),
            eq(purchaseOrders.organizationId, organizationId),
            eq(purchaseOrders.status, 'pending_approval'),
          ),
        )
        .returning({ id: purchaseOrders.id });
      if (!transitioned) {
        throw new BadRequestException('Purchase order status changed before approval completed');
      }
      if (status === 'rejected') {
        await this.budgets.releasePurchaseOrder(tx, organizationId, entityId, 'rejected');
      }
    }
  }

  private async assertApprovalRequestOrganization(
    _executor: Db | DbTransaction,
    approvalReq: typeof approvalRequests.$inferSelect,
    organizationId: string,
  ): Promise<void> {
    if (approvalReq.organizationId !== organizationId) {
      throw new NotFoundException(`Approval request ${approvalReq.id} not found`);
    }
  }

  private emitEntityStatusEvents(
    organizationId: string,
    entityType: string,
    entityId: string,
    status: 'approved' | 'rejected',
  ) {
    const entityPayload =
      entityType === 'requisition' ? { requisitionId: entityId } : { purchaseOrderId: entityId };
    if (entityType === 'requisition') {
      this.webhookEvents.emit(
        organizationId,
        status === 'approved' ? 'requisition.approved' : 'requisition.rejected',
        entityPayload,
      );
    } else {
      this.webhookEvents.emit(
        organizationId,
        status === 'approved' ? 'po.approved' : 'po.rejected',
        entityPayload,
      );
    }
    this.webhookEvents.emit(
      organizationId,
      status === 'approved' ? 'approval.approved' : 'approval.rejected',
      { entityType, entityId },
    );
  }
}
