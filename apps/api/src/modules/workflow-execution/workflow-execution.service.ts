import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type {
  ApprovalNode,
  ApproverResolver,
  ExecutableDefinition,
  ExecutableStep,
  WorkflowDomain,
} from '@betterspend/shared';
import { executableDefinitionSchema, REQUIRED_APPROVAL_NODE_ID } from '@betterspend/shared';
import type { Db, DbTransaction } from '@betterspend/db';
import {
  approvalActions,
  approvalRequests,
  invoices,
  purchaseOrders,
  requisitions,
  users,
  workflowApprovalAssignments,
  workflowDefinitionVersions,
  workflowDefinitions,
  workflowRuntimePublications,
} from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { ApprovalDelegationsService } from '../approval-delegations/approval-delegations.service';
import { AuditService } from '../audit/audit.service';
import { addMoney, convertMoney } from '../budgets/budget-enforcement';
import { invoiceCommitmentAmounts } from '../budgets/budget-commitments';
import { BudgetsService } from '../budgets/budgets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhookEventService } from '../webhooks/webhook-event.service';
import { GlExportService } from '../gl/gl-export.service';
import { SettingsService } from '../settings/settings.service';
import {
  compareWorkflowDecimals,
  evaluateWorkflowQuorum,
  selectWorkflowTransition,
  type WorkflowAssignmentStatus,
  type WorkflowQuorum,
} from './workflow-runtime';

type SupportedApprovableType = 'requisition' | 'purchase_order' | 'invoice';

export interface WorkflowExecutionResult {
  workflow: true;
  organizationId: string;
  autoApproved: boolean;
  rule: null;
  requestId: string;
  definitionVersionId: string;
  status: 'pending' | 'approved' | 'rejected';
  publicationId?: string;
  fastLane?: undefined;
  threshold?: undefined;
}

export interface WorkflowRestartResult {
  cancelledRequestId: string;
  replacementRequestId: string;
  definitionVersionId: string;
  version: number;
  attempt: number;
  status: 'pending' | 'approved' | 'rejected';
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

export const workflowPublicationJobDataSchema = z
  .object({
    kind: z.literal('publication'),
    publicationId: z.string().uuid(),
  })
  .strict();

export type WorkflowPublicationJobData = z.infer<typeof workflowPublicationJobDataSchema>;
export const workflowQueueJobDataSchema = z.union([
  workflowEscalationJobDataSchema,
  workflowPublicationJobDataSchema,
]);
export type WorkflowQueueJobData = z.infer<typeof workflowQueueJobDataSchema>;

type RuntimeRequest = typeof approvalRequests.$inferSelect;
type RuntimeAssignment = typeof workflowApprovalAssignments.$inferSelect;

type RuntimeOutcome = {
  request: RuntimeRequest;
  status: 'pending' | 'approved' | 'rejected';
  entityStatus?: 'approved' | 'rejected';
  publicationId?: string;
};

const REQUIRED_APPROVAL_TERMINAL_CONTEXT_KEY = '__requiredApprovalTerminalNodeId';

function workflowDomainFor(entityType: SupportedApprovableType): WorkflowDomain {
  if (entityType === 'requisition') return 'requisition';
  return entityType === 'invoice' ? 'invoice' : 'po_change';
}

function supportedApprovableType(value: string): SupportedApprovableType {
  if (value === 'requisition' || value === 'purchase_order' || value === 'invoice') return value;
  throw new ConflictException(`Unsupported versioned approvable type ${value}`);
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
export class WorkflowExecutionService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowExecutionService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @InjectQueue('workflow-escalation') private readonly escalationQueue: Queue,
    private readonly delegations: ApprovalDelegationsService,
    private readonly budgets: BudgetsService,
    private readonly notifications: NotificationsService,
    private readonly webhookEvents: WebhookEventService,
    private readonly audit: AuditService,
    private readonly glExport: GlExportService,
    @Optional() private readonly settings?: SettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const pending = await this.db.query.workflowRuntimePublications.findMany({
      where: (publication, { eq }) => eq(publication.status, 'pending'),
      columns: { id: true },
    });
    await Promise.all(pending.map((publication) => this.enqueueRuntimePublication(publication.id)));
    if (pending.length > 0) {
      this.logger.log(`Recovered ${pending.length} workflow publications awaiting delivery`);
    }
  }

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
    additionalContext: Record<string, unknown> = {},
  ): Promise<WorkflowExecutionResult | null> {
    if (requiredApproval?.only) return null;
    const executor = transaction ?? this.db;
    const context = await this.loadWorkflowContext(
      executor,
      organizationId,
      entityType,
      entityId,
      initiatedBy,
      additionalContext,
    );
    const version = await this.findPublishedVersion(
      executor,
      organizationId,
      workflowDomainFor(entityType),
      typeof context.legalEntityId === 'string' ? context.legalEntityId : null,
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
      const outcome = await this.advanceAutomaticSteps(tx, request, executable, initiatedBy);
      return this.recordRuntimePublication(tx, outcome);
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
      publicationId: outcome.publicationId,
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
    const actionResult = await this.db.transaction(async (tx) => {
      const withPublication = async (outcome: RuntimeOutcome) => ({
        outcome: await this.recordRuntimePublication(tx, outcome),
        publicationRequired: true as const,
      });
      const request = await this.lockVersionedRequest(tx, requestId, organizationId);
      if (request.status !== 'pending') {
        throw new BadRequestException(`Request is already ${request.status}`);
      }
      if (!request.currentNodeId)
        throw new ConflictException('Workflow request has no current node');

      const executable = await this.loadExecutable(tx, request);
      if (request.currentNodeId === REQUIRED_APPROVAL_NODE_ID) {
        const outcome = await this.processRequiredApproval(
          tx,
          request,
          actorId,
          action,
          comment,
          executable,
        );
        return withPublication(outcome);
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
          const [pendingRequest] = await tx
            .update(approvalRequests)
            .set({ updatedAt: now })
            .where(eq(approvalRequests.id, request.id))
            .returning();
          return withPublication({
            request: pendingRequest,
            status: 'pending' as const,
          });
        }
        return {
          outcome: { request, status: 'pending' as const },
          publicationRequired: false as const,
        };
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
        const outcome = await this.finishRequest(tx, request, 'rejected', actorId, step.node.id);
        return withPublication(outcome);
      }

      const transition = selectWorkflowTransition(step, request.workflowContext);
      if (!transition)
        throw new ConflictException(`Workflow node ${step.node.id} has no transition`);
      const [advanced] = await tx
        .update(approvalRequests)
        .set({ currentNodeId: transition.targetStepId, updatedAt: now })
        .where(eq(approvalRequests.id, request.id))
        .returning();
      const outcome = await this.advanceAutomaticSteps(tx, advanced, executable, actorId);
      return withPublication(outcome);
    });

    if (actionResult.publicationRequired) {
      await this.publishRuntimeOutcomeAfterCommit(actionResult.outcome);
    }
    const { outcome } = actionResult;
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
  ): Promise<WorkflowRestartResult> {
    const result = await this.db.transaction((tx) =>
      this.restartOnLatestInTransaction(requestId, organizationId, actorId, tx),
    );
    await this.publishCommittedRequest(result.replacementRequestId, organizationId);
    return result;
  }

  /** Restart inside a caller-owned transaction so a material edit and reapproval are atomic. */
  async restartOnLatestInTransaction(
    requestId: string,
    organizationId: string,
    actorId: string,
    tx: DbTransaction,
    options: { allowApproved?: boolean } = {},
  ): Promise<WorkflowRestartResult> {
    const request = await this.lockVersionedRequest(tx, requestId, organizationId);
    if (request.status !== 'pending' && !(options.allowApproved && request.status === 'approved')) {
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
    let requiredApproverId = request.requiredApproverId;
    let requiredApprovalReason = request.requiredApprovalReason;
    let requiredApprovalKey = request.requiredApprovalKey;
    let freshContext: Record<string, unknown>;
    if (request.approvableType === 'invoice') {
      const currentContext = await this.loadWorkflowContext(
        tx,
        organizationId,
        'invoice',
        request.approvableId,
        request.initiatedBy ?? actorId,
        {},
      );
      const supplementalContext = Object.fromEntries(
        Object.entries(request.workflowContext).filter(
          ([key]) => !Object.hasOwn(currentContext, key),
        ),
      );
      freshContext = { ...supplementalContext, ...currentContext };
    } else {
      const restartContext = await this.loadRestartWorkflowContext(
        tx,
        request,
        request.initiatedBy ?? actorId,
      );
      freshContext = restartContext.workflowContext;
      const { budgetDecision } = restartContext;
      if (budgetDecision.action === 'block') {
        throw new ConflictException('Budget policy blocks this workflow restart');
      }
      if (budgetDecision.action === 'require_approval') {
        if (!budgetDecision.ownerUserId || !budgetDecision.budgetId) {
          throw new ConflictException('The current budget approval has no eligible owner');
        }
        requiredApproverId = budgetDecision.ownerUserId;
        requiredApprovalReason = budgetDecision.message;
        requiredApprovalKey =
          request.approvableType === 'requisition'
            ? `budget:${budgetDecision.budgetId}:requisition:${request.approvableId}:owner:${budgetDecision.ownerUserId}`
            : `budget:${budgetDecision.budgetId}:po:${request.approvableId}:version:${String(freshContext.version)}:owner:${budgetDecision.ownerUserId}`;
      } else if (requiredApprovalKey?.startsWith('budget:')) {
        requiredApproverId = null;
        requiredApprovalReason = null;
        requiredApprovalKey = null;
      }
    }
    const now = new Date();

    await tx
      .update(approvalRequests)
      .set({ status: 'cancelled', updatedAt: now })
      .where(eq(approvalRequests.id, request.id));
    await tx
      .update(workflowApprovalAssignments)
      .set({ status: 'skipped', updatedAt: now })
      .where(
        and(
          eq(workflowApprovalAssignments.approvalRequestId, request.id),
          inArray(workflowApprovalAssignments.status, ['waiting', 'pending']),
        ),
      );
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
        workflowContext: freshContext,
        attempt: request.attempt + 1,
        currentStep: 0,
        status: 'pending',
        requiredApproverId,
        requiredApprovalReason,
        requiredApprovalKey,
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
    const recordedOutcome = await this.recordRuntimePublication(tx, outcome);
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
      cancelledRequestId: request.id,
      replacementRequestId: replacement.id,
      definitionVersionId: latest.id,
      version: latest.version,
      attempt: replacement.attempt,
      status: recordedOutcome.status,
    };
  }

  /** Cancel a workflow invalidated by an entity edit without creating a replacement instance. */
  async cancelForEditInTransaction(
    requestId: string,
    organizationId: string,
    actorId: string,
    tx: DbTransaction,
    options: {
      allowApproved?: boolean;
      reason?: 'material_edit_requires_rematch' | 'invoice_match_invalidated';
    } = {},
  ): Promise<void> {
    const request = await this.lockVersionedRequest(tx, requestId, organizationId);
    if (request.status !== 'pending' && !(options.allowApproved && request.status === 'approved')) {
      throw new ConflictException('Only pending workflow instances can be cancelled for an edit');
    }
    const now = new Date();
    await tx
      .update(approvalRequests)
      .set({ status: 'cancelled', updatedAt: now })
      .where(eq(approvalRequests.id, request.id));
    await tx
      .update(workflowApprovalAssignments)
      .set({ status: 'skipped', updatedAt: now })
      .where(
        and(
          eq(workflowApprovalAssignments.approvalRequestId, request.id),
          inArray(workflowApprovalAssignments.status, ['waiting', 'pending']),
        ),
      );
    const reason = options.reason ?? 'material_edit_requires_rematch';
    await tx.insert(approvalActions).values({
      approvalRequestId: request.id,
      stepOrder: request.currentStep,
      approverId: actorId,
      action: 'cancelled',
      nodeId: request.currentNodeId,
      comment:
        reason === 'invoice_match_invalidated'
          ? 'Cancelled because the invoice no longer fully matches'
          : 'Cancelled because a material edit requires a new successful match',
      metadata: { reason },
    });
    await this.audit.log(
      organizationId,
      actorId,
      'approval_request',
      request.id,
      'cancelled_for_material_edit',
      { approvableType: request.approvableType, approvableId: request.approvableId },
      undefined,
      tx,
    );
  }

  async publishCommittedRequest(requestId: string, organizationId: string): Promise<void> {
    const publication = await this.db.query.workflowRuntimePublications.findFirst({
      where: (record, { and, eq }) =>
        and(
          eq(record.approvalRequestId, requestId),
          eq(record.organizationId, organizationId),
          eq(record.status, 'pending'),
        ),
      orderBy: (record, { desc }) => desc(record.createdAt),
    });
    if (!publication) return;
    try {
      await this.enqueueRuntimePublication(publication.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Workflow publication ${publication.id} awaits recovery: ${message}`);
    }
  }

  async publishInitiation(result: WorkflowExecutionResult): Promise<void> {
    if (!result.publicationId) {
      this.logger.error(`Workflow ${result.requestId} has no durable publication record`);
      return;
    }
    await this.enqueueRuntimePublication(result.publicationId);
  }

  async scheduleEscalations(requestId: string, organizationId: string): Promise<void> {
    const request = await this.db.query.approvalRequests.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, requestId), eq(record.organizationId, organizationId)),
    });
    if (!request?.definitionVersionId || !request.currentNodeId || request.status !== 'pending') {
      return;
    }
    await this.scheduleEscalationsForRequest(this.db, request);
  }

  private async scheduleEscalationsForRequest(
    executor: Db | DbTransaction,
    request: RuntimeRequest,
  ): Promise<void> {
    if (!request.definitionVersionId || !request.currentNodeId || request.status !== 'pending') {
      return;
    }
    const version = await executor.query.workflowDefinitionVersions.findFirst({
      where: (record, { and, eq }) =>
        and(
          eq(record.id, request.definitionVersionId!),
          eq(record.organizationId, request.organizationId),
        ),
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
      const elapsed = Math.max(0, Date.now() - request.updatedAt.getTime());
      const baseData = {
        organizationId: request.organizationId,
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
            delay: Math.max(0, totalDelay * (timer.node.config.warningPercent / 100) - elapsed),
            jobId: `workflow-warning-${request.id}-${request.attempt}-${timer.node.id}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: true,
          },
        ),
        this.escalationQueue.add(
          'action',
          { ...baseData, kind: 'action' } satisfies WorkflowEscalationJobData,
          {
            delay: Math.max(0, totalDelay - elapsed),
            jobId: `workflow-action-${request.id}-${request.attempt}-${timer.node.id}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: true,
          },
        ),
      ]);
    }
  }

  async handleRuntimePublication(publicationId: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const [publication] = await tx
          .select()
          .from(workflowRuntimePublications)
          .where(
            and(
              eq(workflowRuntimePublications.id, publicationId),
              eq(workflowRuntimePublications.status, 'pending'),
            ),
          )
          .for('update');
        if (!publication) return;

        const request = await this.lockVersionedRequest(
          tx,
          publication.approvalRequestId,
          publication.organizationId,
        );
        const isCurrent =
          request.status === publication.outcomeStatus &&
          request.currentNodeId === publication.nodeId &&
          request.attempt === publication.attempt;
        if (isCurrent) {
          if (publication.outcomeStatus === 'pending') {
            await this.notifyCurrentAssignments(request, tx);
            await this.scheduleEscalationsForRequest(tx, request);
          } else if (
            publication.outcomeStatus === 'approved' ||
            publication.outcomeStatus === 'rejected'
          ) {
            await this.publishRuntimeOutcome(tx, {
              request,
              status: publication.outcomeStatus,
              entityStatus: publication.outcomeStatus,
              publicationId: publication.id,
            });
          } else {
            throw new ConflictException(
              `Unsupported workflow publication outcome ${publication.outcomeStatus}`,
            );
          }
        }
        await tx
          .update(workflowRuntimePublications)
          .set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(workflowRuntimePublications.id, publication.id),
              eq(workflowRuntimePublications.status, 'pending'),
            ),
          );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db
        .update(workflowRuntimePublications)
        .set({
          deliveryAttempts: sql`${workflowRuntimePublications.deliveryAttempts} + 1`,
          lastError: message.slice(0, 2_000),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowRuntimePublications.id, publicationId),
            eq(workflowRuntimePublications.status, 'pending'),
          ),
        );
      throw error;
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
    const executable = await this.loadExecutable(this.db, current);
    const timer = executable.steps.find((step) => step.node.id === data.timerNodeId);
    if (
      !timer ||
      timer.node.type !== 'escalation_timer' ||
      timer.node.config.parentNodeId !== data.parentNodeId
    ) {
      return;
    }
    const timerNode = timer.node;
    const elapsedMilliseconds = Date.now() - current.updatedAt.getTime();
    const slaMilliseconds = timerNode.config.slaHours * 60 * 60 * 1_000;
    const minimumElapsed =
      data.kind === 'warning'
        ? slaMilliseconds * (timerNode.config.warningPercent / 100)
        : slaMilliseconds;
    if (elapsedMilliseconds < minimumElapsed) return;

    if (data.kind === 'warning') {
      await this.notifyClaimedEscalation(
        current,
        data,
        timerNode,
        'Workflow approval is nearing its SLA',
      );
      return;
    }
    const action = timerNode.config.action;
    if (action.type === 'notify') {
      await this.notifyClaimedEscalation(
        current,
        data,
        timerNode,
        'Workflow approval exceeded its SLA',
      );
      return;
    }
    if (action.type === 'auto_reject') {
      const outcome = await this.db.transaction(async (tx) => {
        const locked = await this.claimEscalation(tx, current, data, timerNode);
        if (!locked) return null;
        await tx
          .update(workflowApprovalAssignments)
          .set({ status: 'skipped', updatedAt: new Date() })
          .where(
            and(
              eq(workflowApprovalAssignments.approvalRequestId, locked.id),
              eq(workflowApprovalAssignments.nodeId, data.parentNodeId),
              inArray(workflowApprovalAssignments.status, ['waiting', 'pending']),
            ),
          );
        const outcome = await this.finishRequest(tx, locked, 'rejected', null, data.parentNodeId);
        return this.recordRuntimePublication(tx, outcome);
      });
      if (outcome) await this.publishRuntimeOutcomeAfterCommit(outcome);
      return;
    }
    if (action.type === 'auto_approve') {
      await this.autoApproveEscalatedStep(current, data, timerNode);
      return;
    }
    const parentStep = this.getStep(executable, data.parentNodeId);
    if (parentStep.node.type !== 'approver_group' && parentStep.node.type !== 'resolver') return;
    const execution =
      parentStep.node.type === 'approver_group' ? parentStep.node.config.execution : 'serial';
    const quorum =
      parentStep.node.type === 'approver_group'
        ? parentStep.node.config.quorum
        : ({ type: 'all' } as const);
    await this.reassignEscalatedStep(current, data, timerNode, action.resolvers, execution, quorum);
  }

  /**
   * Claims one timer delivery inside the same transaction as its side effects.
   * The escalation-claim unique index makes duplicate queue deliveries no-ops.
   */
  private async claimEscalation(
    tx: DbTransaction,
    request: RuntimeRequest,
    data: WorkflowEscalationJobData,
    timer: Extract<ExecutableStep['node'], { type: 'escalation_timer' }>,
  ): Promise<RuntimeRequest | null> {
    const locked = await this.lockVersionedRequest(tx, request.id, request.organizationId);
    if (
      locked.status !== 'pending' ||
      locked.currentNodeId !== data.parentNodeId ||
      locked.definitionVersionId !== data.definitionVersionId ||
      locked.attempt !== data.attempt
    ) {
      return null;
    }

    const slaMilliseconds = timer.config.slaHours * 60 * 60 * 1_000;
    const minimumElapsed =
      data.kind === 'warning'
        ? slaMilliseconds * (timer.config.warningPercent / 100)
        : slaMilliseconds;
    if (Date.now() - locked.updatedAt.getTime() < minimumElapsed) return null;

    const [claim] = await tx
      .insert(approvalActions)
      .values({
        approvalRequestId: locked.id,
        stepOrder: locked.currentStep,
        approverId: null,
        action: data.kind === 'warning' ? 'escalation_warning' : 'escalation_action',
        nodeId: data.timerNodeId,
        comment: `Claimed workflow escalation ${data.kind}`,
        metadata: {
          attempt: data.attempt,
          definitionVersionId: data.definitionVersionId,
          parentNodeId: data.parentNodeId,
        },
      })
      .onConflictDoNothing()
      .returning({ id: approvalActions.id });
    return claim ? locked : null;
  }

  private async notifyClaimedEscalation(
    request: RuntimeRequest,
    data: WorkflowEscalationJobData,
    timer: Extract<ExecutableStep['node'], { type: 'escalation_timer' }>,
    message: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const locked = await this.claimEscalation(tx, request, data, timer);
      if (!locked) return;
      const assignments = (await this.getAssignments(tx, locked.id, data.parentNodeId)).filter(
        (assignment) => assignment.status === 'pending',
      );
      await this.notifyAssignees(locked, assignments, message, tx);
    });
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
    additionalContext: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let entity: Record<string, unknown>;
    let requesterId: string | null = null;
    let poCreatorId: string | null = null;
    let invoiceCreatorId: string | null = null;
    if (entityType === 'requisition') {
      const requisition = await executor.query.requisitions.findFirst({
        where: (record, { and, eq }) =>
          and(eq(record.id, entityId), eq(record.organizationId, organizationId)),
      });
      if (!requisition) throw new NotFoundException(`Entity ${entityId} not found`);
      entity = requisition;
      requesterId = requisition.requesterId;
    } else if (entityType === 'purchase_order') {
      const purchaseOrder = await executor.query.purchaseOrders.findFirst({
        where: (record, { and, eq }) =>
          and(eq(record.id, entityId), eq(record.organizationId, organizationId)),
      });
      if (!purchaseOrder) throw new NotFoundException(`Entity ${entityId} not found`);
      entity = purchaseOrder;
      poCreatorId = purchaseOrder.issuedBy;
      if (purchaseOrder.requisitionId) {
        const linkedRequisition = await executor.query.requisitions.findFirst({
          where: (record, { and, eq }) =>
            and(
              eq(record.id, purchaseOrder.requisitionId!),
              eq(record.organizationId, organizationId),
            ),
          columns: { requesterId: true },
        });
        requesterId = linkedRequisition?.requesterId ?? null;
      }
    } else {
      const invoice = await executor.query.invoices.findFirst({
        where: (record, { and, eq }) =>
          and(eq(record.id, entityId), eq(record.organizationId, organizationId)),
        with: { lines: true },
      });
      if (!invoice) throw new NotFoundException(`Entity ${entityId} not found`);
      entity = { ...invoice, lines: invoice.lines };
      invoiceCreatorId = invoice.createdBy;
    }
    return {
      ...entity,
      request: entity,
      approvableType: entityType,
      approvableId: entityId,
      initiatedBy,
      ...additionalContext,
      legalEntityId:
        entityType !== 'requisition' && typeof entity.entityId === 'string'
          ? entity.entityId
          : typeof additionalContext.legalEntityId === 'string'
            ? additionalContext.legalEntityId
            : null,
      actors: {
        requester: requesterId,
        submitter: initiatedBy,
        po_creator: poCreatorId,
        invoice_creator: invoiceCreatorId,
      },
    };
  }

  private async loadRestartWorkflowContext(
    tx: DbTransaction,
    request: RuntimeRequest,
    initiatedBy: string,
  ): Promise<{
    workflowContext: Record<string, unknown>;
    budgetDecision: Awaited<ReturnType<BudgetsService['evaluateEnforcement']>>;
  }> {
    if (request.approvableType !== 'requisition' && request.approvableType !== 'purchase_order') {
      throw new ConflictException(
        `Budget-aware workflow restart does not support ${request.approvableType} requests`,
      );
    }
    const context = await this.loadWorkflowContext(
      tx,
      request.organizationId,
      request.approvableType,
      request.approvableId,
      initiatedBy,
      {},
    );
    const totalAmount = context.totalAmount;
    const currency = context.currency;
    const createdAt = context.createdAt;
    if (
      typeof totalAmount !== 'string' ||
      typeof currency !== 'string' ||
      !(createdAt instanceof Date)
    ) {
      throw new ConflictException('The approvable is missing current budget context');
    }

    let departmentId = typeof context.departmentId === 'string' ? context.departmentId : null;
    let fiscalYear = createdAt.getUTCFullYear();
    let excludeRequisitionId: string | undefined;
    let excludePurchaseOrderId: string | undefined;
    if (request.approvableType === 'requisition') {
      excludeRequisitionId = request.approvableId;
    } else {
      excludePurchaseOrderId = request.approvableId;
      if (typeof context.requisitionId === 'string') {
        const linkedRequisition = await tx.query.requisitions.findFirst({
          where: (record, { and, eq }) =>
            and(
              eq(record.id, context.requisitionId as string),
              eq(record.organizationId, request.organizationId),
            ),
        });
        if (!linkedRequisition) {
          throw new ConflictException('The linked requisition is unavailable for restart');
        }
        departmentId = linkedRequisition.departmentId;
        fiscalYear = linkedRequisition.createdAt.getUTCFullYear();
        excludeRequisitionId = linkedRequisition.id;
      }
    }

    const budgetDecision = await this.budgets.evaluateEnforcementLocked(tx, {
      organizationId: request.organizationId,
      departmentId,
      requestedAmount: totalAmount,
      currency,
      fiscalYear,
      excludeRequisitionId,
      excludePurchaseOrderId,
    });
    return {
      workflowContext: {
        ...context,
        budgetAvailable: budgetDecision.withinBudget,
        budgetDecision,
      },
      budgetDecision,
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
    actorId: string | null,
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
          request = await this.enterRequiredApproval(tx, request, step.node.id);
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
          ? request.workflowContext.matchStatus === 'full_match'
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
        status:
          execution === 'parallel' || index === 0 ? ('pending' as const) : ('waiting' as const),
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
    terminalNodeId: string,
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
        workflowContext: {
          ...request.workflowContext,
          [REQUIRED_APPROVAL_TERMINAL_CONTEXT_KEY]: terminalNodeId,
        },
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
    await this.audit.log(
      request.organizationId,
      actorId,
      'approval_request',
      request.id,
      action === 'approve' ? 'workflow_step_approved' : 'workflow_step_rejected',
      { nodeId: REQUIRED_APPROVAL_NODE_ID, assignmentId: assignment.id },
      undefined,
      tx,
    );
    if (action === 'reject') {
      return this.finishRequest(tx, request, 'rejected', actorId, REQUIRED_APPROVAL_NODE_ID);
    }
    const terminalNodeId = request.workflowContext[REQUIRED_APPROVAL_TERMINAL_CONTEXT_KEY];
    const terminal =
      typeof terminalNodeId === 'string'
        ? executable.steps.find(
            (step) =>
              step.node.id === terminalNodeId &&
              (step.node.type === 'approved' || step.node.type === 'auto_approve'),
          )
        : undefined;
    if (!terminal) {
      throw new ConflictException('The required approval terminal node is unavailable');
    }
    return this.finishRequest(tx, request, 'approved', actorId, terminal.node.id);
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
          const comparison = compareWorkflowDecimals(
            request.workflowContext.baseTotalAmount ?? request.workflowContext.totalAmount ?? '0',
            resolver.spendLimitBaseAmount,
          );
          if (comparison == null || comparison > 0) continue;
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
          if (excluded.has(assignedApproverId)) continue;
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
    actorId: string | null,
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
    await this.audit.log(
      request.organizationId,
      actorId,
      'approval_request',
      request.id,
      status === 'approved' ? 'workflow_approved' : 'workflow_rejected',
      { nodeId, definitionVersionId: request.definitionVersionId },
      undefined,
      tx,
    );
    await this.updateEntityStatus(tx, finished, status, now, actorId);
    return { request: finished, status, entityStatus: status };
  }

  private async updateEntityStatus(
    tx: DbTransaction,
    request: RuntimeRequest,
    status: 'approved' | 'rejected',
    now: Date,
    actorId: string | null,
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
      // Approval keeps the requisition reservation intact. PO issuance owns the
      // reservation-to-commitment conversion in PurchaseOrdersService.issue.
      if (status === 'rejected') {
        await this.budgets.releasePurchaseOrder(
          tx,
          request.organizationId,
          request.approvableId,
          'rejected',
        );
      }
      return;
    }
    if (request.approvableType === 'invoice') {
      if (status === 'approved') {
        const invoice = await tx.query.invoices.findFirst({
          where: (record, { and, eq }) =>
            and(
              eq(record.id, request.approvableId),
              eq(record.organizationId, request.organizationId),
            ),
          columns: { createdBy: true, submissionSource: true },
        });
        const makerCheckerEnabled =
          (await this.settings?.get(
            request.organizationId,
            'prevent_invoice_self_approval',
            tx,
          )) !== 'false';
        if (
          makerCheckerEnabled &&
          ((actorId === null && invoice?.submissionSource !== 'vendor_portal') ||
            (actorId !== null && invoice?.createdBy === actorId) ||
            (invoice?.submissionSource !== 'vendor_portal' && !invoice?.createdBy))
        ) {
          throw new ForbiddenException('Invoice maker-checker policy blocks this approval');
        }
      }
      const transitionCondition =
        status === 'approved'
          ? and(
              eq(invoices.status, 'pending_approval'),
              isNotNull(invoices.purchaseOrderId),
              eq(invoices.matchStatus, 'full_match'),
            )
          : inArray(invoices.status, [
              'pending_match',
              'partial_match',
              'exception',
              'matched',
              'pending_approval',
            ]);
      const [transitioned] = await tx
        .update(invoices)
        .set({
          status,
          approvedBy: status === 'approved' ? actorId : null,
          approvedAt: status === 'approved' ? now : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(invoices.id, request.approvableId),
            eq(invoices.organizationId, request.organizationId),
            transitionCondition,
          ),
        )
        .returning({ id: invoices.id });
      if (!transitioned) throw new ConflictException('Invoice status changed during workflow');
      if (status === 'approved') {
        const invoice = await tx.query.invoices.findFirst({
          where: (record, { and, eq }) =>
            and(
              eq(record.id, request.approvableId),
              eq(record.organizationId, request.organizationId),
            ),
          with: { lines: { with: { taxCode: true } } },
        });
        if (invoice?.purchaseOrderId) {
          const recoverableTaxAmount = addMoney(
            invoice.lines
              .filter((line) => line.taxCode?.isRecoverable)
              .map((line) => String(line.taxAmount ?? '0')),
          );
          const amounts = invoiceCommitmentAmounts(
            String(invoice.baseTotalAmount),
            convertMoney(recoverableTaxAmount, String(invoice.exchangeRate)),
          );
          await this.budgets.expenseInvoice(
            tx,
            request.organizationId,
            request.approvableId,
            amounts.expense,
            amounts.commitmentRelease,
            now,
          );
        }
      }
    }
  }

  private async publishRuntimeOutcome(tx: DbTransaction, outcome: RuntimeOutcome): Promise<void> {
    if (outcome.status === 'pending') return;
    if (!outcome.publicationId) {
      throw new ConflictException('Terminal workflow publication has no durable identifier');
    }
    const type = outcome.request.approvableType;
    const entityId = outcome.request.approvableId;
    const jobs: Promise<void>[] = [];
    if (type === 'requisition') {
      const eventType =
        outcome.status === 'approved' ? 'requisition.approved' : 'requisition.rejected';
      jobs.push(
        this.webhookEvents.enqueue(
          outcome.request.organizationId,
          eventType,
          { requisitionId: entityId },
          `workflow-publication-${outcome.publicationId}-${eventType.replace('.', '-')}`,
        ),
      );
    } else if (type === 'purchase_order') {
      const eventType = outcome.status === 'approved' ? 'po.approved' : 'po.rejected';
      jobs.push(
        this.webhookEvents.enqueue(
          outcome.request.organizationId,
          eventType,
          { purchaseOrderId: entityId },
          `workflow-publication-${outcome.publicationId}-${eventType.replace('.', '-')}`,
        ),
      );
    } else if (type === 'invoice') {
      const eventType = outcome.status === 'approved' ? 'invoice.approved' : 'invoice.rejected';
      const invoice = await tx.query.invoices.findFirst({
        where: (record, { and, eq }) =>
          and(eq(record.id, entityId), eq(record.organizationId, outcome.request.organizationId)),
      });
      if (!invoice) throw new ConflictException(`Invoice ${entityId} not found for publication`);
      jobs.push(
        this.webhookEvents.enqueue(
          outcome.request.organizationId,
          eventType,
          { invoice },
          `workflow-publication-${outcome.publicationId}-${eventType.replace('.', '-')}`,
        ),
      );
      if (outcome.status === 'approved') {
        jobs.push(
          this.glExport.enqueue(
            outcome.request.organizationId,
            entityId,
            'qbo',
            `workflow-publication-${outcome.publicationId}-gl-qbo`,
          ),
        );
      }
    }
    const approvalEventType =
      outcome.status === 'approved' ? 'approval.approved' : 'approval.rejected';
    jobs.push(
      this.webhookEvents.enqueue(
        outcome.request.organizationId,
        approvalEventType,
        { entityType: type, entityId },
        `workflow-publication-${outcome.publicationId}-${approvalEventType.replace('.', '-')}`,
      ),
    );
    await Promise.all(jobs);
  }

  private async publishRuntimeOutcomeAfterCommit(outcome: RuntimeOutcome): Promise<void> {
    if (!outcome.publicationId) {
      this.logger.error(`Workflow ${outcome.request.id} has no durable publication record`);
      return;
    }
    try {
      await this.enqueueRuntimePublication(outcome.publicationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Workflow ${outcome.request.id} publication ${outcome.publicationId} awaits recovery: ${message}`,
      );
    }
  }

  private async recordRuntimePublication(
    tx: DbTransaction,
    outcome: RuntimeOutcome,
  ): Promise<RuntimeOutcome> {
    if (!outcome.request.currentNodeId) {
      throw new ConflictException('Workflow outcome has no publication node');
    }
    const [publication] = await tx
      .insert(workflowRuntimePublications)
      .values({
        organizationId: outcome.request.organizationId,
        approvalRequestId: outcome.request.id,
        nodeId: outcome.request.currentNodeId,
        attempt: outcome.request.attempt,
        outcomeStatus: outcome.status,
      })
      .returning({ id: workflowRuntimePublications.id });
    return { ...outcome, publicationId: publication.id };
  }

  private async enqueueRuntimePublication(publicationId: string): Promise<void> {
    await this.escalationQueue.add(
      'publication',
      { kind: 'publication', publicationId } satisfies WorkflowPublicationJobData,
      {
        jobId: `workflow-publication-${publicationId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: true,
      },
    );
  }

  private async notifyCurrentAssignments(
    request: RuntimeRequest,
    transaction?: DbTransaction,
  ): Promise<void> {
    if (!request.currentNodeId) return;
    const assignments = await (transaction ?? this.db).query.workflowApprovalAssignments.findMany({
      where: (assignment, { and, eq }) =>
        and(
          eq(assignment.approvalRequestId, request.id),
          eq(assignment.nodeId, request.currentNodeId!),
          eq(assignment.status, 'pending'),
        ),
    });
    await this.notifyAssignees(request, assignments, 'Workflow approval is required', transaction);
  }

  private async notifyAssignees(
    request: RuntimeRequest,
    assignments: RuntimeAssignment[],
    message: string,
    transaction?: DbTransaction,
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
          transaction,
        ),
      ),
    );
  }

  private async reassignEscalatedStep(
    request: RuntimeRequest,
    data: WorkflowEscalationJobData,
    timer: Extract<ExecutableStep['node'], { type: 'escalation_timer' }>,
    resolvers: ApproverResolver[],
    execution: 'serial' | 'parallel',
    quorum: WorkflowQuorum,
  ): Promise<void> {
    const outcome = await this.db.transaction(async (tx) => {
      const locked = await this.claimEscalation(tx, request, data, timer);
      if (!locked) return null;
      const current = await this.getAssignments(tx, locked.id, locked.currentNodeId!);
      const approvedApproverIds = new Set(
        current
          .filter((assignment) => assignment.status === 'approved')
          .map((assignment) => assignment.assignedApproverId),
      );
      const resolved = (await this.resolveApprovers(tx, locked, resolvers, [], [])).filter(
        (item) => !approvedApproverIds.has(item.assignedApproverId),
      );
      if (resolved.length === 0) throw new ConflictException('Escalation resolved no approvers');
      const remainingApprovalCount =
        quorum.type === 'count' ? Math.max(0, quorum.count - approvedApproverIds.size) : 0;
      if (resolved.length < remainingApprovalCount) {
        throw new ConflictException(
          `Escalation resolved ${resolved.length} replacement approvers, but ${remainingApprovalCount} are required`,
        );
      }
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
          status:
            execution === 'parallel' || index === 0 ? ('pending' as const) : ('waiting' as const),
        })),
      );
      await tx.insert(approvalActions).values({
        approvalRequestId: locked.id,
        stepOrder: locked.currentStep,
        approverId: null,
        action: 'reassigned',
        nodeId: locked.currentNodeId,
        comment: `Escalated by timer ${timer.id}`,
        metadata: { timerNodeId: timer.id, resolverCount: resolvers.length },
      });
      await this.audit.log(
        locked.organizationId,
        null,
        'approval_request',
        locked.id,
        'workflow_reassigned',
        { nodeId: locked.currentNodeId, timerNodeId: timer.id },
        undefined,
        tx,
      );
      return this.recordRuntimePublication(tx, {
        request: locked,
        status: 'pending' as const,
      });
    });
    if (outcome) await this.publishRuntimeOutcomeAfterCommit(outcome);
  }

  private async autoApproveEscalatedStep(
    request: RuntimeRequest,
    data: WorkflowEscalationJobData,
    timer: Extract<ExecutableStep['node'], { type: 'escalation_timer' }>,
  ): Promise<void> {
    const outcome = await this.db.transaction(async (tx) => {
      const locked = await this.claimEscalation(tx, request, data, timer);
      if (!locked) return null;
      const nodeId = data.parentNodeId;
      const executable = await this.loadExecutable(tx, locked);
      const step = this.getStep(executable, nodeId);
      const now = new Date();
      await tx
        .update(workflowApprovalAssignments)
        .set({ status: 'approved', actedBy: null, actedAt: now, updatedAt: now })
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
        approverId: null,
        action: 'approved',
        nodeId,
        comment: 'Auto-approved after the workflow SLA elapsed',
        metadata: { escalation: true },
      });
      await this.audit.log(
        locked.organizationId,
        null,
        'approval_request',
        locked.id,
        'workflow_step_auto_approved',
        { nodeId, escalation: true },
        undefined,
        tx,
      );
      const transition = selectWorkflowTransition(step, locked.workflowContext);
      if (!transition) throw new ConflictException(`Workflow node ${nodeId} has no transition`);
      const [advanced] = await tx
        .update(approvalRequests)
        .set({ currentNodeId: transition.targetStepId, updatedAt: now })
        .where(eq(approvalRequests.id, locked.id))
        .returning();
      const advancedOutcome = await this.advanceAutomaticSteps(tx, advanced, executable, null);
      return this.recordRuntimePublication(tx, advancedOutcome);
    });
    if (outcome) await this.publishRuntimeOutcomeAfterCommit(outcome);
  }
}
