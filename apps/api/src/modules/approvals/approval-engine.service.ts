import { Injectable, Inject, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { approvalRules, approvalRuleSteps, approvalRequests, approvalActions, requisitions, purchaseOrders, systemSettings } from '@betterspend/db';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalDelegationsService } from '../approval-delegations/approval-delegations.service';
import { SettingsService } from '../settings/settings.service';

const DEMO_ADMIN_USER_ID = '00000000-0000-0000-0000-000000000002';
// System user ID used for auto-approval actions (must be a valid UUID in users table)
const SYSTEM_USER_ID = DEMO_ADMIN_USER_ID;

@Injectable()
export class ApprovalEngineService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly webhookEvents: WebhookEventService,
    @Optional() private readonly notifications: NotificationsService,
    @Optional() private readonly delegations: ApprovalDelegationsService,
    @Optional() private readonly settingsService: SettingsService,
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
      case '>=': return Number(fieldValue) >= Number(condValue);
      case '>':  return Number(fieldValue) > Number(condValue);
      case '<=': return Number(fieldValue) <= Number(condValue);
      case '<':  return Number(fieldValue) < Number(condValue);
      case '==':
      case 'eq': return String(fieldValue) === String(condValue);
      case '!=':
      case 'neq': return String(fieldValue) !== String(condValue);
      default: return false;
    }
  }

  // Find the first matching rule for an entity
  async findMatchingRule(organizationId: string, entityType: string, entity: Record<string, any>) {
    const rules = await this.db.query.approvalRules.findMany({
      where: (r, { and, eq }) => and(
        eq(r.organizationId, organizationId),
        eq(r.isActive, true),
      ),
      with: { steps: true },
      orderBy: (r, { asc }) => asc(r.priority),
    });

    for (const rule of rules) {
      let conditions: any = {};
      try {
        conditions = typeof rule.conditions === 'string'
          ? JSON.parse(rule.conditions)
          : rule.conditions;
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
  ): Promise<{ eligible: boolean; threshold: number; notifyManager: boolean }> {
    if (!this.settingsService) {
      return { eligible: false, threshold: 0, notifyManager: false };
    }

    const thresholdStr = await this.settingsService.get(organizationId, 'auto_approve_threshold');
    const notifyManagerStr = await this.settingsService.get(organizationId, 'auto_approve_notify_manager');

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
  ) {
    // Fetch entity for condition evaluation
    let entity: Record<string, any> | null = null;
    if (entityType === 'requisition') {
      entity = await this.db.query.requisitions.findFirst({
        where: (r, { eq }) => eq(r.id, entityId),
      }) ?? null;
    } else {
      entity = await this.db.query.purchaseOrders.findFirst({
        where: (p, { eq }) => eq(p.id, entityId),
      }) ?? null;
    }
    if (!entity) throw new NotFoundException(`Entity ${entityId} not found`);

    // Check fast-lane auto-approval threshold (only for requisitions)
    if (entityType === 'requisition') {
      const { eligible, threshold, notifyManager } = await this.checkFastLaneAutoApproval(organizationId, entity);
      if (eligible) {
        return this.applyFastLaneApproval(organizationId, entityId, entity, threshold, notifyManager, initiatedBy);
      }
    }

    const rule = await this.findMatchingRule(organizationId, entityType, entity);

    if (!rule || !rule.steps || rule.steps.length === 0) {
      // No matching rule → auto-approve
      if (entityType === 'requisition') {
        await this.db.update(requisitions)
          .set({ status: 'approved', updatedAt: new Date() })
          .where(eq(requisitions.id, entityId));
        this.webhookEvents.emit(organizationId, 'requisition.approved', { requisitionId: entityId, autoApproved: true });
      } else {
        await this.db.update(purchaseOrders)
          .set({ status: 'approved', updatedAt: new Date() })
          .where(eq(purchaseOrders.id, entityId));
        this.webhookEvents.emit(organizationId, 'po.approved', { purchaseOrderId: entityId, autoApproved: true });
      }
      return { autoApproved: true, rule: null };
    }

    // Sort steps by stepOrder
    const sortedSteps = [...rule.steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const firstStep = sortedSteps[0];

    // Resolve delegation: if the first-step approver has delegated, route to delegatee
    let effectiveApproverId = initiatedBy;
    if (this.delegations && firstStep.approverId) {
      const delegatee = await this.delegations.getActiveDelegatee(organizationId, firstStep.approverId);
      if (delegatee) {
        effectiveApproverId = delegatee;
      }
    }

    // The schema for approvalRequests has no organizationId, initiatedBy, or dueAt —
    // those fields are tracked via the actions log and the approvableType/approvableId pattern
    const requestId = await this.db.transaction(async (tx) => {
      const [req] = await tx.insert(approvalRequests).values({
        approvableType: entityType,
        approvableId: entityId,
        approvalRuleId: rule.id,
        currentStep: firstStep.stepOrder,
        status: 'pending',
      }).returning();

      // Record the submission action
      await tx.insert(approvalActions).values({
        approvalRequestId: req.id,
        stepOrder: firstStep.stepOrder,
        approverId: effectiveApproverId,
        action: 'submitted',
        comment: effectiveApproverId !== initiatedBy
          ? `Submitted for approval (delegated from original approver)`
          : 'Submitted for approval',
      });

      return req.id;
    });

    this.webhookEvents.emit(organizationId, 'approval.requested', {
      requestId,
      entityType,
      entityId,
      ruleName: rule.name,
    });

    if (this.notifications) {
      const entityLabel = entityType === 'requisition' ? 'Requisition' : 'Purchase Order';
      this.notifications.create(
        organizationId,
        DEMO_ADMIN_USER_ID,
        'approval_request',
        `Approval Required: ${entityLabel}`,
        `A ${entityLabel.toLowerCase()} requires your approval (rule: ${rule.name}).`,
        entityType,
        entityId,
      ).catch(() => {});
    }

    return { autoApproved: false, rule, requestId };
  }

  // Apply fast-lane auto-approval for low-value requisitions
  private async applyFastLaneApproval(
    organizationId: string,
    entityId: string,
    entity: Record<string, any>,
    threshold: number,
    notifyManager: boolean,
    initiatedBy: string,
  ) {
    const totalAmount = parseFloat(entity.totalAmount ?? entity.total_amount ?? '0');
    const note = `Auto-approved: requisition total $${totalAmount.toFixed(2)} is below the configured threshold of $${threshold.toFixed(2)}`;

    // Create an approval request in auto-approved state and record the action
    const requestId = await this.db.transaction(async (tx) => {
      const [req] = await tx.insert(approvalRequests).values({
        approvableType: 'requisition',
        approvableId: entityId,
        approvalRuleId: null,
        currentStep: 1,
        status: 'approved',
      }).returning();

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

      return req.id;
    });

    // Update the requisition status to approved
    await this.db.update(requisitions)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(requisitions.id, entityId));

    this.webhookEvents.emit(organizationId, 'requisition.approved', {
      requisitionId: entityId,
      autoApproved: true,
      fastLane: true,
      threshold,
    });

    return { autoApproved: true, fastLane: true, rule: null, requestId };
  }

  // Get auto-approved summary for the current calendar month
  async getAutoApprovedSummary(organizationId: string): Promise<{ count: number; totalAmount: number }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Find approval requests that were auto-approved (no rule, status approved) for this org's requisitions
    // We detect fast-lane auto-approvals by looking for approval_requests with status='approved' and
    // an action comment containing 'Auto-approved: requisition total'
    const rows = await this.db.execute(sql`
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
    `) as any[];

    const row = rows[0] ?? { count: 0, total_amount: '0' };
    return {
      count: Number(row.count ?? 0),
      totalAmount: parseFloat(row.total_amount ?? '0'),
    };
  }

  // Enrich approval requests with entity summary (title/number, link, amount)
  private async enrichWithEntityInfo(rows: any[]): Promise<any[]> {
    if (!rows.length) return rows;

    const reqIds = rows.filter(r => r.approvableType === 'requisition').map(r => r.approvableId);
    const poIds  = rows.filter(r => r.approvableType === 'purchase_order').map(r => r.approvableId);

    const [reqMap, poMap]: [Record<string, any>, Record<string, any>] = await Promise.all([
      reqIds.length ? this.db.execute(sql`
        SELECT id, number, title, total_amount AS amount, status FROM requisitions WHERE id = ANY(${sql.raw(`ARRAY[${reqIds.map(i => `'${i}'`).join(',')}]::uuid[]`)})
      `).then((rows) => Object.fromEntries((rows as any[]).map(r => [r.id, r]))) : {},
      poIds.length ? this.db.execute(sql`
        SELECT po.id, po.internal_number AS number, v.name AS "vendorName", po.total_amount AS amount, po.status
        FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id
        WHERE po.id = ANY(${sql.raw(`ARRAY[${poIds.map(i => `'${i}'`).join(',')}]::uuid[]`)})
      `).then((rows) => Object.fromEntries((rows as any[]).map(r => [r.id, r]))) : {},
    ]);

    return rows.map((r) => {
      const entity = r.approvableType === 'requisition' ? reqMap[r.approvableId] : poMap[r.approvableId];
      return { ...r, entitySummary: entity ?? null };
    });
  }

  // Get approval request with actions and rule steps
  async getRequest(id: string) {
    const req = await this.db.query.approvalRequests.findFirst({
      where: (r, { eq }) => eq(r.id, id),
      with: {
        actions: { orderBy: (a, { asc }) => asc(a.actedAt) },
        rule: { with: { steps: true } },
      },
    });
    if (!req) throw new NotFoundException(`Approval request ${id} not found`);
    const [enriched] = await this.enrichWithEntityInfo([req]);
    return enriched;
  }

  // List all pending requests for an organization (filtered by approvable entity org)
  async listPending(organizationId: string) {
    const rows = await this.db.query.approvalRequests.findMany({
      where: (r, { eq }) => eq(r.status, 'pending'),
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
    comment?: string,
    organizationId?: string,
  ) {
    const approvalReq = await this.getRequest(requestId);

    if (approvalReq.status !== 'pending') {
      throw new BadRequestException(`Request is already ${approvalReq.status}`);
    }

    const rule = await this.db.query.approvalRules.findFirst({
      where: (r, { eq }) => eq(r.id, approvalReq.approvalRuleId!),
      with: { steps: true },
    });

    const sortedSteps = [...(rule?.steps ?? [])].sort((a, b) => a.stepOrder - b.stepOrder);
    const nextStep = sortedSteps.find(s => s.stepOrder > approvalReq.currentStep);

    // Record the action
    await this.db.insert(approvalActions).values({
      approvalRequestId: requestId,
      stepOrder: approvalReq.currentStep,
      approverId: actorId,
      action,
      comment: comment ?? null,
    });

    if (action === 'reject') {
      await this.db.update(approvalRequests)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(approvalRequests.id, requestId));

      await this.updateEntityStatus(approvalReq.approvableType, approvalReq.approvableId, 'rejected', organizationId);
      return { status: 'rejected' };
    }

    // action === 'approve'
    if (nextStep) {
      // Advance to next step
      await this.db.update(approvalRequests)
        .set({ currentStep: nextStep.stepOrder, updatedAt: new Date() })
        .where(eq(approvalRequests.id, requestId));

      await this.db.insert(approvalActions).values({
        approvalRequestId: requestId,
        stepOrder: nextStep.stepOrder,
        approverId: actorId,
        action: 'forwarded',
        comment: `Advanced to step ${nextStep.stepOrder}`,
      });

      return { status: 'pending', advancedToStep: nextStep.stepOrder };
    } else {
      // Final approval
      await this.db.update(approvalRequests)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(approvalRequests.id, requestId));

      await this.updateEntityStatus(approvalReq.approvableType, approvalReq.approvableId, 'approved', organizationId);
      return { status: 'approved' };
    }
  }

  private async updateEntityStatus(
    entityType: string,
    entityId: string,
    status: 'approved' | 'rejected',
    organizationId?: string,
  ) {
    if (entityType === 'requisition') {
      await this.db.update(requisitions)
        .set({ status, updatedAt: new Date() })
        .where(eq(requisitions.id, entityId));
      if (organizationId) {
        this.webhookEvents.emit(organizationId, status === 'approved' ? 'requisition.approved' : 'requisition.rejected', { requisitionId: entityId });
      }
    } else if (entityType === 'purchase_order') {
      await this.db.update(purchaseOrders)
        .set({ status, updatedAt: new Date() })
        .where(eq(purchaseOrders.id, entityId));
      if (organizationId) {
        this.webhookEvents.emit(organizationId, status === 'approved' ? 'po.approved' : 'po.rejected', { purchaseOrderId: entityId });
      }
    }
    if (organizationId) {
      this.webhookEvents.emit(organizationId, status === 'approved' ? 'approval.approved' : 'approval.rejected', {
        entityType,
        entityId,
      });
    }
  }
}
