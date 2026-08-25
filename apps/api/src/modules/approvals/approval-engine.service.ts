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
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalDelegationsService } from '../approval-delegations/approval-delegations.service';
import { SettingsService } from '../settings/settings.service';
import { BudgetsService } from '../budgets/budgets.service';
import {
  WorkflowExecutionService,
  type WorkflowExecutionResult,
} from '../workflow-execution/workflow-execution.service';

const DEMO_ADMIN_USER_ID = '00000000-0000-0000-0000-000000000002';
// System user ID used for auto-approval actions (must be a valid UUID in users table)
const SYSTEM_USER_ID = DEMO_ADMIN_USER_ID;

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

    const result = { autoApproved: false as const, rule, requestId };
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
          rule?: { name: string; steps?: Array<{ stepOrder: number }> } | null;
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
    const initialApproverId = hasRuleStep ? DEMO_ADMIN_USER_ID : requiredApproval?.approverId;
    if (!initialApproverId) return;
    const approvalDescription = hasRuleStep
      ? `A ${entityLabel.toLowerCase()} requires your approval (rule: ${result.rule!.name}).`
      : (requiredApproval?.reason ?? 'Approval is required.');
    this.notifications
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
  ): Promise<{ departmentId: string | null; projectId: string | null; entityId: string | null }> {
    if (approvalReq.approvableType === 'requisition') {
      const requisition = await tx.query.requisitions.findFirst({
        where: (record, { eq }) => eq(record.id, approvalReq.approvableId),
      });
      return {
        departmentId: requisition?.departmentId ?? null,
        projectId: requisition?.projectId ?? null,
        entityId: null,
      };
    }

    const purchaseOrder = await tx.query.purchaseOrders.findFirst({
      where: (record, { eq }) => eq(record.id, approvalReq.approvableId),
    });
    const requisition = purchaseOrder?.requisitionId
      ? await tx.query.requisitions.findFirst({
          where: (record, { eq }) => eq(record.id, purchaseOrder.requisitionId!),
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
      if (step.approverType === 'department_head') {
        return assignment.scopeType === 'department' && assignment.scopeId === scope.departmentId;
      }
      if (assignment.scopeType === 'department') return assignment.scopeId === scope.departmentId;
      if (assignment.scopeType === 'project') return assignment.scopeId === scope.projectId;
      if (assignment.scopeType === 'entity') return assignment.scopeId === scope.entityId;
      return false;
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
        approverId: SYSTEM_USER_ID,
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
  ): Promise<{ count: number; totalAmount: number }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Find approval requests that were auto-approved (no rule, status approved) for this org's requisitions
    // We detect fast-lane auto-approvals by looking for approval_requests with status='approved' and
    // an action comment containing 'Auto-approved: requisition total'
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

    const [reqMap, poMap]: [Record<string, any>, Record<string, any>] = await Promise.all([
      reqIds.length
        ? this.db
            .execute(
              sql`
        SELECT id, number, title, total_amount AS amount, status FROM requisitions WHERE id = ANY(${sql.raw(`ARRAY[${reqIds.map((i) => `'${i}'`).join(',')}]::uuid[]`)})
      `,
            )
            .then((rows) => Object.fromEntries((rows as any[]).map((r) => [r.id, r])))
        : {},
      poIds.length
        ? this.db
            .execute(
              sql`
        SELECT po.id, po.internal_number AS number, v.name AS "vendorName", po.total_amount AS amount, po.status
        FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id
        WHERE po.id = ANY(${sql.raw(`ARRAY[${poIds.map((i) => `'${i}'`).join(',')}]::uuid[]`)})
      `,
            )
            .then((rows) => Object.fromEntries((rows as any[]).map((r) => [r.id, r])))
        : {},
    ]);

    return rows.map((r) => {
      const entity =
        r.approvableType === 'requisition' ? reqMap[r.approvableId] : poMap[r.approvableId];
      return { ...r, entitySummary: entity ?? null };
    });
  }

  // Get approval request with actions and rule steps
  async getRequest(id: string, organizationId: string) {
    const req = await this.db.query.approvalRequests.findFirst({
      where: (r, { eq }) => eq(r.id, id),
      with: {
        actions: { orderBy: (a, { asc }) => asc(a.actedAt) },
        rule: { with: { steps: true } },
      },
    });
    if (!req) throw new NotFoundException(`Approval request ${id} not found`);
    await this.assertApprovalRequestOrganization(this.db, req, organizationId);
    const [enriched] = await this.enrichWithEntityInfo([req]);
    return enriched;
  }

  // List all pending requests for an organization.
  async listPending(organizationId: string) {
    const rows = await this.db.query.approvalRequests.findMany({
      where: (record, { and, eq }) =>
        and(eq(record.organizationId, organizationId), eq(record.status, 'pending')),
      with: {
        rule: true,
        actions: { orderBy: (a, { desc }) => desc(a.actedAt) },
      },
      orderBy: (r, { asc }) => asc(r.createdAt),
    });
    return this.enrichWithEntityInfo(rows);
  }

  // Process an approve or reject action
  async processAction(
    requestId: string,
    actorId: string,
    action: 'approve' | 'reject',
    comment: string | undefined,
    organizationId: string,
  ) {
    if (
      this.workflowExecution &&
      (await this.workflowExecution.isVersionedRequest(requestId, organizationId))
    ) {
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
