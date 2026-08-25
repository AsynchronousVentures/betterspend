import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type {
  ApprovalNode,
  ApproverResolver,
  ExecutableDefinition,
  ExecutableStep,
  WorkflowDomain,
} from '@betterspend/shared';
import { executableDefinitionSchema } from '@betterspend/shared';
import type { Db, DbTransaction } from '@betterspend/db';
import {
  approvalActions,
  approvalRequests,
  purchaseOrders,
  requisitions,
  users,
  workflowApprovalAssignments,
  workflowDefinitionVersions,
  workflowDefinitions,
} from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { ApprovalDelegationsService } from '../approval-delegations/approval-delegations.service';
import { AuditService } from '../audit/audit.service';
import { BudgetsService } from '../budgets/budgets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import {
  evaluateWorkflowQuorum,
  selectWorkflowTransition,
  type WorkflowAssignmentStatus,
} from './workflow-runtime';

const REQUIRED_APPROVAL_NODE_ID = '__required_approval__';
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000002';

type SupportedApprovableType = 'requisition' | 'purchase_order';

export interface WorkflowExecutionResult {
  workflow: true;
  organizationId: string;
  autoApproved: boolean;
  rule: null;
  requestId: string;
  definitionVersionId: string;
  status: 'pending' | 'approved' | 'rejected';
  fastLane?: undefined;
  threshold?: undefined;
}

export const workflowEscalationJobDataSchema = z
  .object({
    organizationId: z.string().uuid(),
    approvalRequestId: z.string().uuid(),
    definitionVersionId: z.string().uuid(),
    parentNodeId: z.string().trim().min(1).max(100),
    timerNodeId: z.string().trim().min(1).max(100),
    attempt: z.number().int().positive().max(1_000_000),
    kind: z.enum(['warning', 'action']),
  })
  .strict();

export type WorkflowEscalationJobData = z.infer<typeof workflowEscalationJobDataSchema>;

type RuntimeRequest = typeof approvalRequests.$inferSelect;
type RuntimeAssignment = typeof workflowApprovalAssignments.$inferSelect;

type RuntimeOutcome = {
  request: RuntimeRequest;
  status: 'pending' | 'approved' | 'rejected';
  entityStatus?: 'approved' | 'rejected';
};

function workflowDomainFor(entityType: SupportedApprovableType): WorkflowDomain {
  return entityType === 'requisition' ? 'requisition' : 'po_change';
}

function assignmentStatus(value: string): WorkflowAssignmentStatus {
  if (
    value === 'waiting' ||
    value === 'pending' ||
    value === 'approved' ||
    value === 'rejected' ||
    value === 'skipped'
  ) {
    return value;
  }
  throw new ConflictException(`Unsupported workflow assignment status ${value}`);
}

@Injectable()
export class WorkflowExecutionService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @InjectQueue('workflow-escalation') private readonly escalationQueue: Queue,
    private readonly delegations: ApprovalDelegationsService,
    private readonly budgets: BudgetsService,
    private readonly notifications: NotificationsService,
    private readonly webhookEvents: WebhookEventService,
    private readonly audit: AuditService,
  ) {}

  async initiateIfConfigured(
    organizationId: string,
    entityType: SupportedApprovableType,
    entityId: string,
    initiatedBy: string,
    requiredApproval?: {
      approverId: string;
      reason: string;
      key: string;
      only?: boolean;
    },
    beforePersist?: (tx: DbTransaction) => Promise<void>,
    transaction?: DbTransaction,
  ): Promise<WorkflowExecutionResult | null> {
    if (requiredApproval?.only) return null;
    const executor = transaction ?? this.db;
    const context = await this.loadWorkflowContext(
      executor,
      organizationId,
      entityType,
      entityId,
      initiatedBy,
    );
    const version = await this.findPublishedVersion(
      executor,
      organizationId,
      workflowDomainFor(entityType),
      typeof context.entityId === 'string' ? context.entityId : null,
    );
    if (!version) return null;
    const executable = executableDefinitionSchema.parse(version.executableJson);

    const run = async (tx: DbTransaction): Promise<RuntimeOutcome> => {
      await beforePersist?.(tx);
      const [request] = await tx
        .insert(approvalRequests)
        .values({
          organizationId,
          approvableType: entityType,
          approvableId: entityId,
          approvalRuleId: null,
          definitionVersionId: version.id,
          initiatedBy,
          currentNodeId: executable.entryStepId,
          workflowContext: context,
          attempt: 1,
          currentStep: 0,
          status: 'pending',
          requiredApproverId: requiredApproval?.approverId ?? null,
          requiredApprovalReason: requiredApproval?.reason ?? null,
          requiredApprovalKey: requiredApproval?.key ?? null,
        })
        .returning();
      await tx.insert(approvalActions).values({
        approvalRequestId: request.id,
        stepOrder: 0,
        approverId: initiatedBy,
        action: 'submitted',
        nodeId: executable.entryStepId,
        comment: `Started workflow version ${version.version}`,
        metadata: { definitionVersionId: version.id, version: version.version },
      });
      await this.audit.log(
        organizationId,
        initiatedBy,
        'approval_request',
        request.id,
        'workflow_started',
        { definitionVersionId: version.id, version: version.version },
        undefined,
        tx,
      );
      return this.advanceAutomaticSteps(tx, request, executable, initiatedBy);
    };

    const outcome = transaction ? await run(transaction) : await this.db.transaction(run);
    return {
      workflow: true,
      organizationId,
      autoApproved: outcome.status === 'approved',
      rule: null,
      requestId: outcome.request.id,
      definitionVersionId: version.id,
      status: outcome.status,
    };
  }

  async isVersionedRequest(requestId: string, organizationId: string): Promise<boolean> {
    const request = await this.db.query.approvalRequests.findFirst({
      where: (record, { and, eq, isNotNull }) =>
        and(
          eq(record.id, requestId),
          eq(record.organizationId, organizationId),
          isNotNull(record.definitionVersionId),
        ),
      columns: { id: true },
    });
    return !!request;
  }

  async processAction(
    requestId: string,
    actorId: string,
    action: 'approve' | 'reject',
    comment: string | undefined,
    organizationId: string,
  ): Promise<{ status: 'pending' | 'approved' | 'rejected'; advancedToNode?: string }> {
    const outcome = await this.db.transaction(async (tx) => {
      const request = await this.lockVersionedRequest(tx, requestId, organizationId);
      if (request.status !== 'pending') {
        throw new BadRequestException(`Request is already ${request.status}`);
      }
      if (!request.currentNodeId)
        throw new ConflictException('Workflow request has no current node');

      const executable = await this.loadExecutable(tx, request);
      if (request.currentNodeId === REQUIRED_APPROVAL_NODE_ID) {
        return this.processRequiredApproval(tx, request, actorId, action, comment, executable);
      }
      const step = this.getStep(executable, request.currentNodeId);
      if (step.node.type !== 'approver_group' && step.node.type !== 'resolver') {
        throw new ConflictException(`Workflow node ${step.node.id} is not awaiting approval`);
      }
      const assignments = await this.getAssignments(tx, request.id, step.node.id);
      const assignment = assignments.find(
        (candidate) => candidate.status === 'pending' && candidate.assignedApproverId === actorId,
      );
      if (!assignment) throw new ForbiddenException('This workflow step is assigned elsewhere');

      const now = new Date();
      await tx
        .update(workflowApprovalAssignments)
        .set({
          status: action === 'approve' ? 'approved' : 'rejected',
          actedBy: actorId,
          actedAt: now,
          updatedAt: now,
        })
        .where(eq(workflowApprovalAssignments.id, assignment.id));
      await tx.insert(approvalActions).values({
        approvalRequestId: request.id,
        stepOrder: request.currentStep,
        approverId: actorId,
        action,
        nodeId: step.node.id,
        comment: comment ?? null,
        metadata: {
          assignmentId: assignment.id,
          resolvedApproverId: assignment.resolvedApproverId,
          assignedApproverId: assignment.assignedApproverId,
        },
      });
      await this.audit.log(
        organizationId,
        actorId,
        'approval_request',
        request.id,
        action === 'approve' ? 'workflow_step_approved' : 'workflow_step_rejected',
        { nodeId: step.node.id, assignmentId: assignment.id },
        undefined,
        tx,
      );

      const refreshed = assignments.map((candidate) =>
        candidate.id === assignment.id
          ? { ...candidate, status: action === 'approve' ? 'approved' : 'rejected' }
          : candidate,
      );
      const node = step.node;
      const execution = node.type === 'approver_group' ? node.config.execution : 'serial';
      const quorum =
        node.type === 'approver_group' ? node.config.quorum : ({ type: 'all' } as const);
      const progress = evaluateWorkflowQuorum(
        execution,
        quorum,
        refreshed.map((candidate) => ({
          sequence: candidate.sequence,
          status: assignmentStatus(candidate.status),
        })),
      );

      if (progress.state === 'pending') {
        if (progress.nextSequence != null) {
          await tx
            .update(workflowApprovalAssignments)
            .set({ status: 'pending', updatedAt: now })
            .where(
              and(
                eq(workflowApprovalAssignments.approvalRequestId, request.id),
                eq(workflowApprovalAssignments.nodeId, step.node.id),
                eq(workflowApprovalAssignments.sequence, progress.nextSequence),
              ),
            );
        }
        return { request, status: 'pending' as const };
      }

      await tx
        .update(workflowApprovalAssignments)
        .set({ status: 'skipped', updatedAt: now })
        .where(
          and(
            eq(workflowApprovalAssignments.approvalRequestId, request.id),
            eq(workflowApprovalAssignments.nodeId, step.node.id),
            inArray(workflowApprovalAssignments.status, ['waiting', 'pending']),
          ),
        );
      if (progress.state === 'rejected') {
        return this.finishRequest(tx, request, 'rejected', actorId, step.node.id);
      }

      const transition = selectWorkflowTransition(step, request.workflowContext);
      if (!transition)
        throw new ConflictException(`Workflow node ${step.node.id} has no transition`);
      const [advanced] = await tx
        .update(approvalRequests)
        .set({ currentNodeId: transition.targetStepId, updatedAt: now })
        .where(eq(approvalRequests.id, request.id))
        .returning();
      return this.advanceAutomaticSteps(tx, advanced, executable, actorId);
    });

    await this.publishRuntimeOutcome(outcome);
    return {
      status: outcome.status,
      ...(outcome.status === 'pending' && outcome.request.currentNodeId
        ? { advancedToNode: outcome.request.currentNodeId }
        : {}),
    };
  }

  async restartOnLatest(
    requestId: string,
    organizationId: string,
    actorId: string,
  ): Promise<{
    cancelledRequestId: string;
    replacementRequestId: string;
    definitionVersionId: string;
    version: number;
    attempt: number;
  }> {
    const result = await this.db.transaction(async (tx) => {
      const request = await this.lockVersionedRequest(tx, requestId, organizationId);
      if (request.status !== 'pending') {
        throw new ConflictException('Only pending workflow instances can be restarted');
      }
      const [scope] = await tx
        .select({
          definitionId: workflowDefinitionVersions.definitionId,
          publishedVersionId: workflowDefinitions.publishedVersionId,
        })
        .from(workflowDefinitionVersions)
        .innerJoin(
          workflowDefinitions,
          and(
            eq(workflowDefinitions.id, workflowDefinitionVersions.definitionId),
            eq(workflowDefinitions.organizationId, workflowDefinitionVersions.organizationId),
          ),
        )
        .where(
          and(
            eq(workflowDefinitionVersions.id, request.definitionVersionId!),
            eq(workflowDefinitionVersions.organizationId, organizationId),
          ),
        )
        .for('update');
      if (!scope?.publishedVersionId) {
        throw new ConflictException('The workflow definition has no published version');
      }
      const latest = await tx.query.workflowDefinitionVersions.findFirst({
        where: (version, { and, eq }) =>
          and(
            eq(version.id, scope.publishedVersionId!),
            eq(version.definitionId, scope.definitionId),
            eq(version.organizationId, organizationId),
          ),
      });
      if (!latest) throw new ConflictException('The published workflow version is unavailable');
      const executable = executableDefinitionSchema.parse(latest.executableJson);
      const now = new Date();

      await tx
        .update(approvalRequests)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(approvalRequests.id, request.id));
      const [replacement] = await tx
        .insert(approvalRequests)
        .values({
          organizationId,
          approvableType: request.approvableType,
          approvableId: request.approvableId,
          approvalRuleId: null,
          definitionVersionId: latest.id,
          initiatedBy: request.initiatedBy ?? actorId,
          currentNodeId: executable.entryStepId,
          workflowContext: request.workflowContext,
          attempt: request.attempt + 1,
          currentStep: 0,
          status: 'pending',
          requiredApproverId: request.requiredApproverId,
          requiredApprovalReason: request.requiredApprovalReason,
          requiredApprovalKey: request.requiredApprovalKey,
        })
        .returning();
      await tx.insert(approvalActions).values([
        {
          approvalRequestId: request.id,
          stepOrder: request.currentStep,
          approverId: actorId,
          action: 'cancelled',
          nodeId: request.currentNodeId,
          comment: `Restarted as ${replacement.id} on workflow version ${latest.version}`,
          metadata: { replacementRequestId: replacement.id, definitionVersionId: latest.id },
        },
        {
          approvalRequestId: replacement.id,
          stepOrder: 0,
          approverId: actorId,
          action: 'restarted',
          nodeId: executable.entryStepId,
          comment: `Restarted from ${request.id} on workflow version ${latest.version}`,
          metadata: { cancelledRequestId: request.id, definitionVersionId: latest.id },
        },
      ]);
      const outcome = await this.advanceAutomaticSteps(tx, replacement, executable, actorId);
      await this.audit.log(
        organizationId,
        actorId,
        'approval_request',
        request.id,
        'restarted_on_latest',
        {
          replacementRequestId: replacement.id,
          definitionVersionId: latest.id,
          version: latest.version,
          attempt: replacement.attempt,
        },
        undefined,
        tx,
      );
      return {
        outcome,
        response: {
          cancelledRequestId: request.id,
          replacementRequestId: replacement.id,
          definitionVersionId: latest.id,
          version: latest.version,
          attempt: replacement.attempt,
        },
      };
    });
    await this.publishRuntimeOutcome(result.outcome);
    return result.response;
  }

  async publishInitiation(result: WorkflowExecutionResult): Promise<void> {
    const request = await this.db.query.approvalRequests.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, result.requestId), eq(record.organizationId, result.organizationId)),
    });
    if (!request) return;
    await this.publishRuntimeOutcome({
      request,
      status: result.status,
      ...(result.status === 'approved' || result.status === 'rejected'
        ? { entityStatus: result.status }
        : {}),
    });
  }

  async scheduleEscalations(requestId: string, organizationId: string): Promise<void> {
    const request = await this.db.query.approvalRequests.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, requestId), eq(record.organizationId, organizationId)),
    });
    if (!request?.definitionVersionId || !request.currentNodeId || request.status !== 'pending') {
      return;
    }
    const version = await this.db.query.workflowDefinitionVersions.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, request.definitionVersionId!), eq(record.organizationId, organizationId)),
    });
    if (!version) return;
    const executable = executableDefinitionSchema.parse(version.executableJson);
    const timers = executable.steps.filter(
      (step) =>
        step.node.type === 'escalation_timer' &&
        step.node.config.parentNodeId === request.currentNodeId,
    );
    for (const timer of timers) {
      if (timer.node.type !== 'escalation_timer') continue;
      const totalDelay = timer.node.config.slaHours * 60 * 60 * 1_000;
      const baseData = {
        organizationId,
        approvalRequestId: request.id,
        definitionVersionId: version.id,
        parentNodeId: request.currentNodeId,
        timerNodeId: timer.node.id,
        attempt: request.attempt,
      };
      await Promise.all([
        this.escalationQueue.add(
          'warning',
          { ...baseData, kind: 'warning' } satisfies WorkflowEscalationJobData,
          {
            delay: Math.max(0, totalDelay * (timer.node.config.warningPercent / 100)),
            jobId: `workflow-warning-${request.id}-${request.attempt}-${timer.node.id}`,
            removeOnComplete: true,
            removeOnFail: true,
          },
        ),
        this.escalationQueue.add(
          'action',
          { ...baseData, kind: 'action' } satisfies WorkflowEscalationJobData,
          {
            delay: Math.max(0, totalDelay),
            jobId: `workflow-action-${request.id}-${request.attempt}-${timer.node.id}`,
            removeOnComplete: true,
            removeOnFail: true,
          },
        ),
      ]);
    }
  }

  async handleEscalation(data: WorkflowEscalationJobData): Promise<void> {
    const current = await this.db.query.approvalRequests.findFirst({
      where: (request, { and, eq }) =>
        and(
          eq(request.id, data.approvalRequestId),
          eq(request.organizationId, data.organizationId),
          eq(request.status, 'pending'),
          eq(request.definitionVersionId, data.definitionVersionId),
          eq(request.currentNodeId, data.parentNodeId),
          eq(request.attempt, data.attempt),
        ),
    });
    if (!current) return;
    const assignments = await this.db.query.workflowApprovalAssignments.findMany({
      where: (assignment, { and, eq }) =>
        and(
          eq(assignment.approvalRequestId, current.id),
          eq(assignment.nodeId, data.parentNodeId),
          eq(assignment.status, 'pending'),
        ),
    });
    if (data.kind === 'warning') {
      await this.notifyAssignees(current, assignments, 'Workflow approval is nearing its SLA');
      return;
    }

    const executable = await this.loadExecutable(this.db, current);
    const timer = this.getStep(executable, data.timerNodeId);
    if (
      timer.node.type !== 'escalation_timer' ||
      timer.node.config.parentNodeId !== data.parentNodeId
    ) {
      return;
    }
    const action = timer.node.config.action;
    if (action.type === 'notify') {
      await this.notifyAssignees(current, assignments, 'Workflow approval exceeded its SLA');
      return;
    }
    if (action.type === 'auto_reject') {
      const outcome = await this.db.transaction(async (tx) => {
        const locked = await this.lockVersionedRequest(tx, current.id, current.organizationId);
        return this.finishRequest(tx, locked, 'rejected', SYSTEM_USER_ID, data.parentNodeId);
      });
      await this.publishRuntimeOutcome(outcome);
      return;
    }
    if (action.type === 'auto_approve') {
      await this.autoApproveEscalatedStep(current, data.parentNodeId);
      return;
    }
    await this.reassignEscalatedStep(current, timer, action.resolvers);
  }

  private async findPublishedVersion(
    executor: Db | DbTransaction,
    organizationId: string,
    domain: WorkflowDomain,
    entityId: string | null,
  ) {
    const definitions = await executor.query.workflowDefinitions.findMany({
      where: (definition, { and, eq, isNotNull }) =>
        and(
          eq(definition.organizationId, organizationId),
          eq(definition.domain, domain),
          isNotNull(definition.publishedVersionId),
        ),
      with: { publishedVersion: true },
      orderBy: (definition, { desc }) => desc(definition.updatedAt),
    });
    return (
      definitions.find((definition) => entityId != null && definition.entityId === entityId)
        ?.publishedVersion ??
      definitions.find((definition) => definition.entityId == null)?.publishedVersion ??
      null
    );
  }

  private async loadWorkflowContext(
    executor: Db | DbTransaction,
    organizationId: string,
    entityType: SupportedApprovableType,
    entityId: string,
    initiatedBy: string,
  ): Promise<Record<string, unknown>> {
    let entity: Record<string, unknown>;
    let requesterId: string | null = null;
    let poCreatorId: string | null = null;
    if (entityType === 'requisition') {
      const requisition = await executor.query.requisitions.findFirst({
        where: (record, { and, eq }) =>
          and(eq(record.id, entityId), eq(record.organizationId, organizationId)),
      });
      if (!requisition) throw new NotFoundException(`Entity ${entityId} not found`);
      entity = requisition;
      requesterId = requisition.requesterId;
    } else {
      const purchaseOrder = await executor.query.purchaseOrders.findFirst({
        where: (record, { and, eq }) =>
          and(eq(record.id, entityId), eq(record.organizationId, organizationId)),
      });
      if (!purchaseOrder) throw new NotFoundException(`Entity ${entityId} not found`);
      entity = purchaseOrder;
      poCreatorId = purchaseOrder.issuedBy;
    }
    return {
      ...entity,
      request: entity,
      approvableType: entityType,
      approvableId: entityId,
      initiatedBy,
      actors: {
        requester: requesterId,
        submitter: initiatedBy,
        po_creator: poCreatorId,
        invoice_creator: null,
      },
    };
  }

  private async lockVersionedRequest(
    tx: DbTransaction,
    requestId: string,
    organizationId: string,
  ): Promise<RuntimeRequest> {
    const [request] = await tx
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.id, requestId),
          eq(approvalRequests.organizationId, organizationId),
        ),
      )
      .for('update');
    if (!request?.definitionVersionId) {
      throw new NotFoundException(`Versioned approval request ${requestId} not found`);
    }
    return request;
  }

  private async loadExecutable(
    executor: Db | DbTransaction,
    request: RuntimeRequest,
  ): Promise<ExecutableDefinition> {
    const version = await executor.query.workflowDefinitionVersions.findFirst({
      where: (record, { and, eq }) =>
        and(
          eq(record.id, request.definitionVersionId!),
          eq(record.organizationId, request.organizationId),
        ),
    });
    if (!version) throw new ConflictException('The pinned workflow version is unavailable');
    return executableDefinitionSchema.parse(version.executableJson);
  }

  private getStep(executable: ExecutableDefinition, nodeId: string): ExecutableStep {
    const step = executable.steps.find((candidate) => candidate.node.id === nodeId);
    if (!step) throw new ConflictException(`Workflow node ${nodeId} is unavailable`);
    return step;
  }

  private async advanceAutomaticSteps(
    tx: DbTransaction,
    initialRequest: RuntimeRequest,
    executable: ExecutableDefinition,
    actorId: string,
  ): Promise<RuntimeOutcome> {
    let request = initialRequest;
    for (let visited = 0; visited <= executable.steps.length; visited += 1) {
      if (!request.currentNodeId)
        throw new ConflictException('Workflow request has no current node');
      const step = this.getStep(executable, request.currentNodeId);
      if (step.node.type === 'approver_group' || step.node.type === 'resolver') {
        request = await this.enterApprovalNode(tx, request, step.node);
        return { request, status: 'pending' };
      }
      if (step.node.type === 'approved' || step.node.type === 'auto_approve') {
        if (request.requiredApproverId) {
          request = await this.enterRequiredApproval(tx, request);
          return { request, status: 'pending' };
        }
        return this.finishRequest(tx, request, 'approved', actorId, step.node.id);
      }
      if (step.node.type === 'reject') {
        return this.finishRequest(tx, request, 'rejected', actorId, step.node.id);
      }
      if (step.node.type === 'collect_form') {
        throw new ConflictException('Collect-form workflow execution is not available');
      }

      const sourceHandle =
        step.node.type === 'match_check'
          ? request.workflowContext.matchStatus === 'matched'
            ? 'within_tolerance'
            : 'exception'
          : step.node.type === 'budget_check'
            ? request.workflowContext.budgetAvailable === false
              ? 'breach'
              : 'available'
            : undefined;
      const transition = selectWorkflowTransition(step, request.workflowContext, sourceHandle);
      if (!transition)
        throw new ConflictException(`Workflow node ${step.node.id} has no transition`);
      const [advanced] = await tx
        .update(approvalRequests)
        .set({ currentNodeId: transition.targetStepId, updatedAt: new Date() })
        .where(eq(approvalRequests.id, request.id))
        .returning();
      await tx.insert(approvalActions).values({
        approvalRequestId: request.id,
        stepOrder: request.currentStep,
        approverId: actorId,
        action: 'advanced',
        nodeId: step.node.id,
        comment: `Advanced to ${transition.targetStepId}`,
        metadata: { edgeId: transition.edgeId },
      });
      request = advanced;
    }
    throw new ConflictException('Workflow automatic traversal exceeded the compiled step count');
  }

  private async enterApprovalNode(
    tx: DbTransaction,
    request: RuntimeRequest,
    node: ApprovalNode,
  ): Promise<RuntimeRequest> {
    const existing = await this.getAssignments(tx, request.id, node.id);
    if (existing.length === 0) {
      const resolved = await this.resolveApprovers(
        tx,
        request,
        node.config.resolvers,
        node.config.separationOfDuties.enabled ? node.config.separationOfDuties.exclude : [],
        node.config.separationOfDuties.enabled
          ? node.config.separationOfDuties.fallbackResolvers
          : [],
      );
      if (resolved.length === 0) {
        throw new ConflictException(`Workflow node ${node.id} resolved no eligible approvers`);
      }
      const execution = node.type === 'approver_group' ? node.config.execution : 'serial';
      const assignments = resolved.map((item, index) => ({
        organizationId: request.organizationId,
        approvalRequestId: request.id,
        nodeId: node.id,
        sequence: index + 1,
        resolver: item.resolver,
        resolvedApproverId: item.resolvedApproverId,
        assignedApproverId: item.assignedApproverId,
        status: execution === 'parallel' || index === 0 ? 'pending' : 'waiting',
      }));
      const created = await tx.insert(workflowApprovalAssignments).values(assignments).returning();
      await tx.insert(approvalActions).values(
        created.map((assignment) => ({
          approvalRequestId: request.id,
          stepOrder: request.currentStep + 1,
          approverId: assignment.assignedApproverId,
          action: 'assigned',
          nodeId: node.id,
          comment: 'Resolved workflow approver',
          metadata: {
            assignmentId: assignment.id,
            resolver: assignment.resolver,
            resolvedApproverId: assignment.resolvedApproverId,
            assignedApproverId: assignment.assignedApproverId,
            delegated: assignment.resolvedApproverId !== assignment.assignedApproverId,
          },
        })),
      );
    }
    const [updated] = await tx
      .update(approvalRequests)
      .set({ currentNodeId: node.id, currentStep: request.currentStep + 1, updatedAt: new Date() })
      .where(eq(approvalRequests.id, request.id))
      .returning();
    return updated;
  }

  private async enterRequiredApproval(
    tx: DbTransaction,
    request: RuntimeRequest,
  ): Promise<RuntimeRequest> {
    const approverId = request.requiredApproverId!;
    const assignedApproverId =
      (await this.delegations.getActiveDelegatee(request.organizationId, approverId, tx)) ??
      approverId;
    await tx.insert(workflowApprovalAssignments).values({
      organizationId: request.organizationId,
      approvalRequestId: request.id,
      nodeId: REQUIRED_APPROVAL_NODE_ID,
      sequence: 1,
      resolver: { type: 'user', userId: approverId },
      resolvedApproverId: approverId,
      assignedApproverId,
      status: 'pending',
    });
    const [updated] = await tx
      .update(approvalRequests)
      .set({
        currentNodeId: REQUIRED_APPROVAL_NODE_ID,
        currentStep: request.currentStep + 1,
        updatedAt: new Date(),
      })
      .where(eq(approvalRequests.id, request.id))
      .returning();
    return updated;
  }

  private async processRequiredApproval(
    tx: DbTransaction,
    request: RuntimeRequest,
    actorId: string,
    action: 'approve' | 'reject',
    comment: string | undefined,
    executable: ExecutableDefinition,
  ): Promise<RuntimeOutcome> {
    const [assignment] = await this.getAssignments(tx, request.id, REQUIRED_APPROVAL_NODE_ID);
    if (
      !assignment ||
      assignment.status !== 'pending' ||
      assignment.assignedApproverId !== actorId
    ) {
      throw new ForbiddenException('This workflow step is assigned elsewhere');
    }
    await tx
      .update(workflowApprovalAssignments)
      .set({
        status: action === 'approve' ? 'approved' : 'rejected',
        actedBy: actorId,
        actedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowApprovalAssignments.id, assignment.id));
    await tx.insert(approvalActions).values({
      approvalRequestId: request.id,
      stepOrder: request.currentStep,
      approverId: actorId,
      action,
      nodeId: REQUIRED_APPROVAL_NODE_ID,
      comment: comment ?? request.requiredApprovalReason,
      metadata: { requiredApprovalKey: request.requiredApprovalKey },
    });
    if (action === 'reject') {
      return this.finishRequest(tx, request, 'rejected', actorId, REQUIRED_APPROVAL_NODE_ID);
    }
    const terminal = executable.steps.find(
      (step) => step.node.type === 'approved' || step.node.type === 'auto_approve',
    );
    return this.finishRequest(
      tx,
      request,
      'approved',
      actorId,
      terminal?.node.id ?? REQUIRED_APPROVAL_NODE_ID,
    );
  }

  private async resolveApprovers(
    tx: DbTransaction,
    request: RuntimeRequest,
    primaryResolvers: ApproverResolver[],
    exclusions: Array<'requester' | 'submitter' | 'invoice_creator' | 'po_creator'>,
    fallbackResolvers: ApproverResolver[],
  ): Promise<
    Array<{ resolver: ApproverResolver; resolvedApproverId: string; assignedApproverId: string }>
  > {
    const actors =
      typeof request.workflowContext.actors === 'object' && request.workflowContext.actors
        ? (request.workflowContext.actors as Record<string, unknown>)
        : {};
    const excluded = new Set(
      exclusions
        .map((exclusion) => actors[exclusion])
        .filter((value): value is string => typeof value === 'string'),
    );
    const resolve = async (resolvers: ApproverResolver[]) => {
      const activeUsers = await tx.query.users.findMany({
        where: (record, { and, eq }) =>
          and(eq(record.organizationId, request.organizationId), eq(record.isActive, true)),
        with: { userRoles: true },
      });
      const output: Array<{
        resolver: ApproverResolver;
        resolvedApproverId: string;
        assignedApproverId: string;
      }> = [];
      for (const resolver of resolvers) {
        if (resolver.spendLimitBaseAmount) {
          const amount = Number(
            request.workflowContext.baseTotalAmount ?? request.workflowContext.totalAmount ?? 0,
          );
          if (amount > Number(resolver.spendLimitBaseAmount)) continue;
        }
        let matches: typeof activeUsers;
        if (resolver.type === 'user') {
          matches = activeUsers.filter((user) => user.id === resolver.userId);
        } else if (resolver.type === 'role') {
          matches = activeUsers.filter((user) =>
            user.userRoles.some((role) => {
              if (role.role !== resolver.role) return false;
              if (resolver.scope === 'global') return role.scopeType === 'global';
              const scopeId = request.workflowContext[`${resolver.scope}Id`];
              return role.scopeType === resolver.scope && role.scopeId === scopeId;
            }),
          );
        } else {
          const startId =
            typeof actors.submitter === 'string'
              ? actors.submitter
              : typeof actors.requester === 'string'
                ? actors.requester
                : null;
          const usersById = new Map(activeUsers.map((user) => [user.id, user]));
          const managers: typeof activeUsers = [];
          let current = startId ? usersById.get(startId) : undefined;
          for (let level = 0; level < resolver.maxLevels && current?.managerId; level += 1) {
            const manager = usersById.get(current.managerId);
            if (!manager || managers.some((candidate) => candidate.id === manager.id)) break;
            managers.push(manager);
            current = manager;
          }
          matches = managers;
        }
        for (const user of matches) {
          if (excluded.has(user.id)) continue;
          const assignedApproverId =
            (await this.delegations.getActiveDelegatee(request.organizationId, user.id, tx)) ??
            user.id;
          output.push({ resolver, resolvedApproverId: user.id, assignedApproverId });
        }
      }
      return output.filter(
        (item, index, all) =>
          all.findIndex((candidate) => candidate.assignedApproverId === item.assignedApproverId) ===
          index,
      );
    };

    const primary = await resolve(primaryResolvers);
    return primary.length > 0 ? primary : resolve(fallbackResolvers);
  }

  private getAssignments(
    tx: DbTransaction,
    requestId: string,
    nodeId: string,
  ): Promise<RuntimeAssignment[]> {
    return tx.query.workflowApprovalAssignments.findMany({
      where: (assignment, { and, eq }) =>
        and(eq(assignment.approvalRequestId, requestId), eq(assignment.nodeId, nodeId)),
      orderBy: (assignment) => asc(assignment.sequence),
    });
  }

  private async finishRequest(
    tx: DbTransaction,
    request: RuntimeRequest,
    status: 'approved' | 'rejected',
    actorId: string,
    nodeId: string,
  ): Promise<RuntimeOutcome> {
    const now = new Date();
    const [finished] = await tx
      .update(approvalRequests)
      .set({ status, currentNodeId: nodeId, updatedAt: now })
      .where(eq(approvalRequests.id, request.id))
      .returning();
    await tx.insert(approvalActions).values({
      approvalRequestId: request.id,
      stepOrder: request.currentStep,
      approverId: actorId,
      action: status,
      nodeId,
      comment: `Workflow reached ${nodeId}`,
      metadata: { definitionVersionId: request.definitionVersionId },
    });
    await this.updateEntityStatus(tx, finished, status, now);
    return { request: finished, status, entityStatus: status };
  }

  private async updateEntityStatus(
    tx: DbTransaction,
    request: RuntimeRequest,
    status: 'approved' | 'rejected',
    now: Date,
  ): Promise<void> {
    if (request.approvableType === 'requisition') {
      const [transitioned] = await tx
        .update(requisitions)
        .set({ status, updatedAt: now })
        .where(
          and(
            eq(requisitions.id, request.approvableId),
            eq(requisitions.organizationId, request.organizationId),
            inArray(requisitions.status, ['submitted', 'pending_approval']),
          ),
        )
        .returning({ id: requisitions.id });
      if (!transitioned) throw new ConflictException('Requisition status changed during workflow');
      if (status === 'approved') {
        await this.budgets.recordRequisitionApproval(
          tx,
          request.organizationId,
          request.approvableId,
        );
      } else {
        await this.budgets.releaseRequisition(
          tx,
          request.organizationId,
          request.approvableId,
          'rejected',
        );
      }
      return;
    }
    if (request.approvableType === 'purchase_order') {
      const [transitioned] = await tx
        .update(purchaseOrders)
        .set({ status, updatedAt: now })
        .where(
          and(
            eq(purchaseOrders.id, request.approvableId),
            eq(purchaseOrders.organizationId, request.organizationId),
            eq(purchaseOrders.status, 'pending_approval'),
          ),
        )
        .returning({ id: purchaseOrders.id });
      if (!transitioned)
        throw new ConflictException('Purchase order status changed during workflow');
      if (status === 'rejected') {
        await this.budgets.releasePurchaseOrder(
          tx,
          request.organizationId,
          request.approvableId,
          'rejected',
        );
      }
    }
  }

  private async publishRuntimeOutcome(outcome: RuntimeOutcome): Promise<void> {
    if (outcome.status === 'pending') {
      await Promise.all([
        this.scheduleEscalations(outcome.request.id, outcome.request.organizationId),
        this.notifyCurrentAssignments(outcome.request),
      ]);
      return;
    }
    const type = outcome.request.approvableType;
    const entityId = outcome.request.approvableId;
    if (type === 'requisition') {
      this.webhookEvents.emit(
        outcome.request.organizationId,
        outcome.status === 'approved' ? 'requisition.approved' : 'requisition.rejected',
        { requisitionId: entityId },
      );
    } else if (type === 'purchase_order') {
      this.webhookEvents.emit(
        outcome.request.organizationId,
        outcome.status === 'approved' ? 'po.approved' : 'po.rejected',
        { purchaseOrderId: entityId },
      );
    }
    this.webhookEvents.emit(
      outcome.request.organizationId,
      outcome.status === 'approved' ? 'approval.approved' : 'approval.rejected',
      { entityType: type, entityId },
    );
  }

  private async notifyCurrentAssignments(request: RuntimeRequest): Promise<void> {
    if (!request.currentNodeId) return;
    const assignments = await this.db.query.workflowApprovalAssignments.findMany({
      where: (assignment, { and, eq }) =>
        and(
          eq(assignment.approvalRequestId, request.id),
          eq(assignment.nodeId, request.currentNodeId!),
          eq(assignment.status, 'pending'),
        ),
    });
    await this.notifyAssignees(request, assignments, 'Workflow approval is required');
  }

  private async notifyAssignees(
    request: RuntimeRequest,
    assignments: RuntimeAssignment[],
    message: string,
  ): Promise<void> {
    await Promise.all(
      assignments.map((assignment) =>
        this.notifications.create(
          request.organizationId,
          assignment.assignedApproverId,
          'approval_request',
          'Approval Required',
          message,
          request.approvableType,
          request.approvableId,
        ),
      ),
    );
  }

  private async reassignEscalatedStep(
    request: RuntimeRequest,
    timer: ExecutableStep,
    resolvers: ApproverResolver[],
  ): Promise<void> {
    const outcome = await this.db.transaction(async (tx) => {
      const locked = await this.lockVersionedRequest(tx, request.id, request.organizationId);
      if (locked.currentNodeId !== request.currentNodeId || locked.attempt !== request.attempt) {
        return { request: locked, status: locked.status as 'pending' };
      }
      const resolved = await this.resolveApprovers(tx, locked, resolvers, [], []);
      if (resolved.length === 0) throw new ConflictException('Escalation resolved no approvers');
      const current = await this.getAssignments(tx, locked.id, locked.currentNodeId!);
      const nextSequence = Math.max(0, ...current.map((assignment) => assignment.sequence)) + 1;
      await tx
        .update(workflowApprovalAssignments)
        .set({ status: 'skipped', updatedAt: new Date() })
        .where(
          and(
            eq(workflowApprovalAssignments.approvalRequestId, locked.id),
            eq(workflowApprovalAssignments.nodeId, locked.currentNodeId!),
            inArray(workflowApprovalAssignments.status, ['waiting', 'pending']),
          ),
        );
      await tx.insert(workflowApprovalAssignments).values(
        resolved.map((item, index) => ({
          organizationId: locked.organizationId,
          approvalRequestId: locked.id,
          nodeId: locked.currentNodeId!,
          sequence: nextSequence + index,
          resolver: item.resolver,
          resolvedApproverId: item.resolvedApproverId,
          assignedApproverId: item.assignedApproverId,
          status: 'pending',
        })),
      );
      await tx.insert(approvalActions).values({
        approvalRequestId: locked.id,
        stepOrder: locked.currentStep,
        approverId: SYSTEM_USER_ID,
        action: 'reassigned',
        nodeId: locked.currentNodeId,
        comment: `Escalated by timer ${timer.node.id}`,
        metadata: { timerNodeId: timer.node.id, resolverCount: resolvers.length },
      });
      return { request: locked, status: 'pending' as const };
    });
    await this.publishRuntimeOutcome(outcome);
  }

  private async autoApproveEscalatedStep(request: RuntimeRequest, nodeId: string): Promise<void> {
    const outcome = await this.db.transaction(async (tx) => {
      const locked = await this.lockVersionedRequest(tx, request.id, request.organizationId);
      if (locked.status !== 'pending' || locked.currentNodeId !== nodeId) {
        return {
          request: locked,
          status:
            locked.status === 'approved' || locked.status === 'rejected'
              ? locked.status
              : 'pending',
        } as RuntimeOutcome;
      }
      const executable = await this.loadExecutable(tx, locked);
      const step = this.getStep(executable, nodeId);
      const now = new Date();
      await tx
        .update(workflowApprovalAssignments)
        .set({ status: 'approved', actedBy: SYSTEM_USER_ID, actedAt: now, updatedAt: now })
        .where(
          and(
            eq(workflowApprovalAssignments.approvalRequestId, locked.id),
            eq(workflowApprovalAssignments.nodeId, nodeId),
            inArray(workflowApprovalAssignments.status, ['waiting', 'pending']),
          ),
        );
      await tx.insert(approvalActions).values({
        approvalRequestId: locked.id,
        stepOrder: locked.currentStep,
        approverId: SYSTEM_USER_ID,
        action: 'approved',
        nodeId,
        comment: 'Auto-approved after the workflow SLA elapsed',
        metadata: { escalation: true },
      });
      const transition = selectWorkflowTransition(step, locked.workflowContext);
      if (!transition) throw new ConflictException(`Workflow node ${nodeId} has no transition`);
      const [advanced] = await tx
        .update(approvalRequests)
        .set({ currentNodeId: transition.targetStepId, updatedAt: now })
        .where(eq(approvalRequests.id, locked.id))
        .returning();
      return this.advanceAutomaticSteps(tx, advanced, executable, SYSTEM_USER_ID);
    });
    await this.publishRuntimeOutcome(outcome);
  }
}
