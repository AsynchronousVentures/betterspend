import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Queue } from 'bullmq';
import type { Db } from '@betterspend/db';
import {
  approvalActions,
  approvalRequests,
  requisitions,
  workflowApprovalAssignments,
  workflowRuntimePublications,
} from '@betterspend/db';
import type { ExecutableDefinition } from '@betterspend/shared';
import type { ApprovalDelegationsService } from '../approval-delegations/approval-delegations.service';
import type { AuditService } from '../audit/audit.service';
import type { BudgetsService } from '../budgets/budgets.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { WebhookEventService } from '../webhooks/webhook-event.service';
import { WorkflowExecutionService } from './workflow-execution.service';

const ORGANIZATION_ID = '00000000-0000-0000-0000-000000000101';
const OTHER_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000102';
const APPROVER_ID = '00000000-0000-4000-8000-000000000201';
const DELEGATE_ID = '00000000-0000-4000-8000-000000000202';
const FALLBACK_ID = '00000000-0000-4000-8000-000000000203';

function executableWithApproval(enforceSeparationOfDuties = false): ExecutableDefinition {
  return {
    schemaVersion: 1,
    domain: 'requisition',
    entryStepId: 'start',
    steps: [
      {
        node: {
          id: 'start',
          name: 'Submitted',
          type: 'trigger',
          disabled: false,
          config: { event: 'requisition_submitted' },
        },
        transitions: [
          {
            edgeId: 'start-review',
            targetStepId: 'review',
            sourceHandle: 'out',
            isDefault: false,
          },
        ],
      },
      {
        node: {
          id: 'review',
          name: 'Review',
          type: 'approver_group',
          disabled: false,
          config: {
            execution: 'serial',
            resolvers: [{ type: 'user', userId: APPROVER_ID }],
            quorum: { type: 'all' },
            separationOfDuties: enforceSeparationOfDuties
              ? {
                  enabled: true,
                  exclude: ['submitter'],
                  fallbackResolvers: [{ type: 'user', userId: FALLBACK_ID }],
                }
              : { enabled: false, exclude: [], fallbackResolvers: [] },
          },
        },
        transitions: [
          {
            edgeId: 'review-approved',
            targetStepId: 'approved',
            sourceHandle: 'out',
            isDefault: false,
          },
        ],
      },
      {
        node: {
          id: 'approved',
          name: 'Approved',
          type: 'approved',
          disabled: false,
          config: {},
        },
        transitions: [],
      },
    ],
  };
}

function createRestartFixture(
  publicationFails = false,
  enforceSeparationOfDuties = false,
  budgetAction: 'allow' | 'require_approval' | 'block' = 'allow',
) {
  const executable = executableWithApproval(enforceSeparationOfDuties);
  const oldRequest = {
    id: '00000000-0000-0000-0000-000000000301',
    organizationId: ORGANIZATION_ID,
    approvableType: 'requisition',
    approvableId: '00000000-0000-0000-0000-000000000401',
    approvalRuleId: null,
    definitionVersionId: '00000000-0000-0000-0000-000000000501',
    initiatedBy: enforceSeparationOfDuties ? DELEGATE_ID : '00000000-0000-0000-0000-000000000601',
    currentNodeId: 'old-review',
    workflowContext: {
      totalAmount: '100',
      budgetAvailable: true,
    },
    attempt: 1,
    currentStep: 1,
    status: 'pending',
    requiredApproverId: null,
    requiredApprovalStep: null,
    requiredApprovalReason: null,
    requiredApprovalKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const latest = {
    id: '00000000-0000-0000-0000-000000000502',
    definitionId: '00000000-0000-0000-0000-000000000503',
    organizationId: ORGANIZATION_ID,
    version: 2,
    executableJson: executable,
  };
  const currentEntity = {
    id: oldRequest.approvableId,
    organizationId: ORGANIZATION_ID,
    requesterId: oldRequest.initiatedBy,
    departmentId: '00000000-0000-0000-0000-000000000801',
    totalAmount: '250',
    baseTotalAmount: '250',
    currency: 'USD',
    status: 'pending_approval',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date(),
  };
  let replacement: Record<string, unknown> | null = null;
  const assignments: Array<Record<string, unknown>> = [
    {
      id: '00000000-0000-0000-0000-000000000700',
      organizationId: ORGANIZATION_ID,
      approvalRequestId: oldRequest.id,
      nodeId: oldRequest.currentNodeId,
      sequence: 1,
      resolver: { type: 'user', userId: APPROVER_ID },
      resolvedApproverId: APPROVER_ID,
      assignedApproverId: APPROVER_ID,
      status: 'pending',
      actedBy: null,
      actedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  const requestUpdates: Array<Record<string, unknown>> = [];
  const entityUpdates: Array<Record<string, unknown>> = [];
  const actions: Array<Record<string, unknown>> = [];
  const notifications: string[] = [];
  const publications: Array<Record<string, unknown>> = [];
  const queueJobs: Array<{ name: string; data: Record<string, unknown> }> = [];

  const transaction = {
    query: {
      workflowDefinitionVersions: { findFirst: async () => latest },
      workflowApprovalAssignments: {
        findMany: async (query?: {
          where?: (
            assignment: typeof workflowApprovalAssignments,
            operators: {
              and: (...conditions: unknown[]) => unknown;
              eq: (column: unknown, value: unknown) => unknown;
            },
          ) => unknown;
        }) => {
          const activeRequest = replacement ?? oldRequest;
          let requestedNodeId: string | undefined;
          query?.where?.(workflowApprovalAssignments, {
            and: (...conditions) => conditions,
            eq: (column, value) => {
              if (column === workflowApprovalAssignments.nodeId && typeof value === 'string') {
                requestedNodeId = value;
              }
              return { column, value };
            },
          });
          return assignments.filter(
            (assignment) =>
              assignment.approvalRequestId === activeRequest.id &&
              (!requestedNodeId || assignment.nodeId === requestedNodeId),
          );
        },
      },
      requisitions: { findFirst: async () => currentEntity },
      users: {
        findMany: async () => [
          {
            id: APPROVER_ID,
            organizationId: ORGANIZATION_ID,
            managerId: null,
            isActive: true,
            userRoles: [],
          },
          {
            id: FALLBACK_ID,
            organizationId: ORGANIZATION_ID,
            managerId: null,
            isActive: true,
            userRoles: [],
          },
        ],
      },
    },
    select(fields?: Record<string, unknown>) {
      return {
        from() {
          if (!fields) {
            return { where: () => ({ for: async () => [replacement ?? oldRequest] }) };
          }
          return {
            innerJoin: () => ({
              where: () => ({
                for: async () => [
                  { definitionId: latest.definitionId, publishedVersionId: latest.id },
                ],
              }),
            }),
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown> | Array<Record<string, unknown>>) {
          const rows = Array.isArray(values) ? values : [values];
          if (table === approvalRequests) {
            replacement = {
              ...oldRequest,
              ...rows[0],
              id: '00000000-0000-0000-0000-000000000302',
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return { returning: async () => [replacement] };
          }
          if (table === workflowApprovalAssignments) {
            const created = rows.map((row, index) => ({
              ...row,
              id: `00000000-0000-0000-0000-${String(assignments.length + index + 701).padStart(12, '0')}`,
              createdAt: new Date(),
              updatedAt: new Date(),
              actedBy: null,
              actedAt: null,
            }));
            assignments.push(...created);
            return { returning: async () => created };
          }
          if (table === approvalActions) {
            const priorActions = [...actions];
            actions.push(...rows);
            return {
              returning: async () => rows,
              onConflictDoNothing: () => {
                const inserted = rows.filter(
                  (row) =>
                    !priorActions.some(
                      (existing) =>
                        existing.approvalRequestId === row.approvalRequestId &&
                        existing.nodeId === row.nodeId &&
                        existing.action === row.action,
                    ),
                );
                actions.splice(priorActions.length, rows.length, ...inserted);
                return { returning: async () => inserted };
              },
            };
          }
          if (table === workflowRuntimePublications) {
            const created = rows.map((row, index) => ({
              ...row,
              id: `00000000-0000-4000-8000-${String(publications.length + index + 1).padStart(12, '0')}`,
              status: 'pending',
              deliveryAttempts: 0,
              lastError: null,
              publishedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            }));
            publications.push(...created);
            return { returning: async () => created };
          }
          return { returning: async () => rows };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              if (table === workflowApprovalAssignments) {
                const activeRequest = replacement ?? oldRequest;
                const candidates = assignments.filter(
                  (assignment) =>
                    assignment.approvalRequestId === activeRequest.id &&
                    (assignment.status === 'waiting' || assignment.status === 'pending'),
                );
                const targets = values.status === 'skipped' ? candidates : candidates.slice(0, 1);
                targets.forEach((assignment) => Object.assign(assignment, values));
                return { returning: async () => targets };
              }
              if (table === workflowRuntimePublications) {
                const publication = publications.find((item) => item.status === 'pending');
                if (publication) Object.assign(publication, values);
                return { returning: async () => (publication ? [publication] : []) };
              }
              if (table !== approvalRequests) {
                entityUpdates.push(values);
                return { returning: async () => [{ id: currentEntity.id }] };
              }
              requestUpdates.push(values);
              if (values.status === 'cancelled') Object.assign(oldRequest, values);
              else if (replacement) Object.assign(replacement, values);
              return { returning: async () => (replacement ? [replacement] : []) };
            },
          };
        },
      };
    },
  };
  const db = {
    transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    query: {
      approvalRequests: { findFirst: async () => replacement },
      workflowDefinitionVersions: { findFirst: async () => latest },
      workflowApprovalAssignments: {
        findMany: async () =>
          assignments.filter((assignment) => assignment.approvalRequestId === replacement?.id),
      },
      workflowRuntimePublications: {
        findFirst: async () => publications.find((publication) => publication.status === 'pending'),
        findMany: async () =>
          publications.filter((publication) => publication.status === 'pending'),
      },
    },
    update: transaction.update,
  } as unknown as Db;
  const queue = {
    add: async (name: string, data: Record<string, unknown>) => {
      queueJobs.push({ name, data });
    },
  } as unknown as Queue;
  const delegations = {
    getActiveDelegatee: async (_organizationId: string, userId: string) =>
      userId === APPROVER_ID ? DELEGATE_ID : null,
  } as unknown as ApprovalDelegationsService;
  const evaluateBudget = async () => {
    if (budgetAction === 'require_approval') {
      return {
        action: 'require_approval',
        withinBudget: false,
        reason: 'overrun',
        budgetId: '00000000-0000-4000-8000-000000000901',
        ownerUserId: FALLBACK_ID,
        message: 'Current budget needs owner approval',
      };
    }
    if (budgetAction === 'block') {
      return {
        action: 'block',
        withinBudget: false,
        reason: 'overrun',
        message: 'Current budget blocks this request',
      };
    }
    return {
      action: 'allow',
      withinBudget: false,
      reason: 'overrun',
      message: 'Current budget is overrun',
    };
  };
  const budgets = {
    evaluateEnforcement: evaluateBudget,
    evaluateEnforcementLocked: evaluateBudget,
    recordRequisitionApproval: async () => entityUpdates.push({ budget: 'approved' }),
    releaseRequisition: async () => entityUpdates.push({ budget: 'released' }),
  } as unknown as BudgetsService;
  const notificationService = {
    create: async (_organizationId: string, userId: string) => {
      if (publicationFails) throw new Error('notification transport unavailable');
      notifications.push(userId);
    },
  } as unknown as NotificationsService;
  const webhooks = {
    emit: () => entityUpdates.push({ webhook: true }),
    enqueue: async () => {
      entityUpdates.push({ webhook: true });
    },
  } as unknown as WebhookEventService;
  const audit = { log: async () => undefined } as unknown as AuditService;

  return {
    actions,
    assignments,
    currentEntity,
    entityUpdates,
    executable,
    getReplacement: () => replacement,
    notifications,
    oldRequest,
    publications,
    queueJobs,
    requestUpdates,
    service: new WorkflowExecutionService(
      db,
      queue,
      delegations,
      budgets,
      notificationService,
      webhooks,
      audit,
    ),
  };
}

describe('WorkflowExecutionService restart', () => {
  it('restarts on the latest compiled version and waits at its first live approval step', async () => {
    const fixture = createRestartFixture();

    const result = await fixture.service.restartOnLatest(
      fixture.oldRequest.id,
      ORGANIZATION_ID,
      fixture.oldRequest.initiatedBy,
    );

    assert.equal(result.attempt, 2);
    assert.equal(result.definitionVersionId, '00000000-0000-0000-0000-000000000502');
    assert.ok(fixture.requestUpdates.some((update) => update.status === 'cancelled'));
    assert.ok(fixture.requestUpdates.some((update) => update.currentNodeId === 'review'));
    assert.ok(!fixture.requestUpdates.some((update) => update.status === 'approved'));
    assert.deepEqual(fixture.entityUpdates, []);
    const oldAssignment = fixture.assignments.find(
      (assignment) => assignment.approvalRequestId === fixture.oldRequest.id,
    );
    const replacementAssignment = fixture.assignments.find(
      (assignment) => assignment.approvalRequestId !== fixture.oldRequest.id,
    );
    assert.equal(oldAssignment?.status, 'skipped');
    assert.equal(replacementAssignment?.resolvedApproverId, APPROVER_ID);
    assert.equal(replacementAssignment?.assignedApproverId, DELEGATE_ID);
    assert.equal(
      (fixture.getReplacement()?.workflowContext as Record<string, unknown>).totalAmount,
      '250',
    );
    assert.equal(
      (fixture.getReplacement()?.workflowContext as Record<string, unknown>).budgetAvailable,
      false,
    );
    assert.deepEqual(fixture.notifications, []);
    assert.equal(fixture.publications.length, 1);
    assert.equal(fixture.queueJobs[0]?.name, 'publication');
    await fixture.service.handleRuntimePublication(String(fixture.publications[0]?.id));
    assert.deepEqual(fixture.notifications, [DELEGATE_ID]);
    assert.equal(fixture.publications[0]?.status, 'published');
    assert.ok(fixture.actions.some((action) => action.action === 'restarted'));
    assert.ok(fixture.actions.some((action) => action.action === 'assigned'));
  });

  it('does not mutate a request that is outside the supplied organization', async () => {
    const writes: string[] = [];
    const transaction = {
      select: () => ({
        from: () => ({ where: () => ({ for: async () => [] }) }),
      }),
      update: () => {
        writes.push('update');
      },
      insert: () => {
        writes.push('insert');
      },
    };
    const db = {
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as Db;
    const service = new WorkflowExecutionService(
      db,
      {} as Queue,
      {} as ApprovalDelegationsService,
      {} as BudgetsService,
      {} as NotificationsService,
      {} as WebhookEventService,
      {} as AuditService,
    );

    await assert.rejects(
      service.restartOnLatest(
        '00000000-0000-0000-0000-000000000301',
        OTHER_ORGANIZATION_ID,
        APPROVER_ID,
      ),
      /not found/,
    );
    assert.deepEqual(writes, []);
  });

  it('keeps a committed restart retryable when publication delivery fails', async () => {
    const fixture = createRestartFixture(true);

    const result = await fixture.service.restartOnLatest(
      fixture.oldRequest.id,
      ORGANIZATION_ID,
      fixture.oldRequest.initiatedBy,
    );

    assert.equal(result.replacementRequestId, '00000000-0000-0000-0000-000000000302');
    assert.ok(fixture.requestUpdates.some((update) => update.status === 'cancelled'));
    assert.ok(fixture.requestUpdates.some((update) => update.currentNodeId === 'review'));
    await assert.rejects(
      fixture.service.handleRuntimePublication(String(fixture.publications[0]?.id)),
      /notification transport unavailable/,
    );
    assert.equal(fixture.publications[0]?.status, 'pending');
    assert.equal(fixture.publications[0]?.deliveryAttempts, 1);
    fixture.queueJobs.splice(0);
    await fixture.service.onModuleInit();
    assert.deepEqual(fixture.queueJobs, [
      {
        name: 'publication',
        data: {
          kind: 'publication',
          publicationId: fixture.publications[0]?.id,
        },
      },
    ]);
  });

  it('uses the separation-of-duties fallback when delegation resolves to an excluded actor', async () => {
    const fixture = createRestartFixture(false, true);

    await fixture.service.restartOnLatest(
      fixture.oldRequest.id,
      ORGANIZATION_ID,
      fixture.oldRequest.initiatedBy,
    );

    const replacementAssignment = fixture.assignments.find(
      (assignment) => assignment.approvalRequestId !== fixture.oldRequest.id,
    );
    assert.equal(replacementAssignment?.resolvedApproverId, FALLBACK_ID);
    assert.equal(replacementAssignment?.assignedApproverId, FALLBACK_ID);
  });

  it('uses the current budget owner requirement on the replacement attempt', async () => {
    const fixture = createRestartFixture(false, false, 'require_approval');

    await fixture.service.restartOnLatest(
      fixture.oldRequest.id,
      ORGANIZATION_ID,
      fixture.oldRequest.initiatedBy,
    );

    const replacement = fixture.getReplacement();
    assert.equal(replacement?.requiredApproverId, FALLBACK_ID);
    assert.equal(replacement?.requiredApprovalReason, 'Current budget needs owner approval');
    assert.equal(
      replacement?.requiredApprovalKey,
      `budget:00000000-0000-4000-8000-000000000901:requisition:${fixture.oldRequest.approvableId}:owner:${FALLBACK_ID}`,
    );
  });

  it('refreshes the SLA clock when a serial workflow advances to its next approver', async () => {
    const fixture = createRestartFixture();
    const review = fixture.executable.steps.find((step) => step.node.id === 'review');
    assert.ok(review?.node.type === 'approver_group');
    review.node.config.resolvers.push({ type: 'user', userId: FALLBACK_ID });

    await fixture.service.restartOnLatest(
      fixture.oldRequest.id,
      ORGANIZATION_ID,
      fixture.oldRequest.initiatedBy,
    );
    const replacement = fixture.getReplacement();
    assert.ok(replacement);
    const previousUpdatedAt = new Date('2026-01-01T00:00:00Z');
    replacement.updatedAt = previousUpdatedAt;

    const result = await fixture.service.processAction(
      String(replacement.id),
      DELEGATE_ID,
      'approve',
      undefined,
      ORGANIZATION_ID,
    );

    assert.equal(result.status, 'pending');
    assert.ok(replacement.updatedAt instanceof Date);
    assert.ok(replacement.updatedAt.getTime() > previousUpdatedAt.getTime());
  });

  it('finishes at the terminal node that triggered required approval', async () => {
    const fixture = createRestartFixture(false, false, 'require_approval');
    const review = fixture.executable.steps.find((step) => step.node.id === 'review');
    assert.ok(review);
    review.transitions[0]!.targetStepId = 'approved-after-review';
    fixture.executable.steps.push({
      node: {
        id: 'approved-after-review',
        name: 'Approved after review',
        type: 'approved',
        disabled: false,
        config: {},
      },
      transitions: [],
    });

    await fixture.service.restartOnLatest(
      fixture.oldRequest.id,
      ORGANIZATION_ID,
      fixture.oldRequest.initiatedBy,
    );
    const replacement = fixture.getReplacement();
    assert.ok(replacement);

    const result = await fixture.service.processAction(
      String(replacement.id),
      DELEGATE_ID,
      'approve',
      undefined,
      ORGANIZATION_ID,
    );
    assert.equal(result.status, 'pending');
    const requiredResult = await fixture.service.processAction(
      String(replacement.id),
      FALLBACK_ID,
      'approve',
      undefined,
      ORGANIZATION_ID,
    );

    assert.equal(requiredResult.status, 'approved');
    assert.equal(replacement.currentNodeId, 'approved-after-review');
    assert.ok(
      fixture.actions.some(
        (action) => action.action === 'approved' && action.nodeId === 'approved-after-review',
      ),
    );
  });

  it('does not replace a request blocked by the current budget policy', async () => {
    const fixture = createRestartFixture(false, false, 'block');

    await assert.rejects(
      fixture.service.restartOnLatest(
        fixture.oldRequest.id,
        ORGANIZATION_ID,
        fixture.oldRequest.initiatedBy,
      ),
      /Budget policy blocks this workflow restart/,
    );

    assert.equal(fixture.getReplacement(), null);
    assert.equal(fixture.oldRequest.status, 'pending');
  });

  it('approves after an SLA reassign skips the obsolete assignment', async () => {
    const fixture = createRestartFixture();
    await fixture.service.restartOnLatest(
      fixture.oldRequest.id,
      ORGANIZATION_ID,
      fixture.oldRequest.initiatedBy,
    );
    fixture.executable.steps.push({
      node: {
        id: 'review-timer',
        name: 'Review SLA',
        type: 'escalation_timer',
        disabled: false,
        config: {
          parentNodeId: 'review',
          slaHours: 1,
          warningPercent: 50,
          action: {
            type: 'reassign',
            resolvers: [
              { type: 'user', userId: FALLBACK_ID },
              { type: 'user', userId: APPROVER_ID },
            ],
          },
        },
      },
      transitions: [],
    });
    const replacement = fixture.getReplacement();
    assert.ok(replacement);
    replacement.updatedAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);

    await fixture.service.handleEscalation({
      organizationId: ORGANIZATION_ID,
      approvalRequestId: String(replacement.id),
      definitionVersionId: String(replacement.definitionVersionId),
      parentNodeId: 'review',
      timerNodeId: 'review-timer',
      attempt: Number(replacement.attempt),
      kind: 'action',
    });
    const replacementAssignments = fixture.assignments.filter(
      (assignment) => assignment.approvalRequestId === replacement.id,
    );
    assert.deepEqual(
      replacementAssignments.map((assignment) => assignment.status),
      ['skipped', 'pending', 'waiting'],
    );

    const firstResult = await fixture.service.processAction(
      String(replacement.id),
      FALLBACK_ID,
      'approve',
      undefined,
      ORGANIZATION_ID,
    );
    assert.equal(firstResult.status, 'pending');
    assert.deepEqual(
      replacementAssignments.map((assignment) => assignment.status),
      ['skipped', 'approved', 'pending'],
    );
    const result = await fixture.service.processAction(
      String(replacement.id),
      DELEGATE_ID,
      'approve',
      undefined,
      ORGANIZATION_ID,
    );

    assert.equal(result.status, 'approved');
    assert.deepEqual(
      replacementAssignments.map((assignment) => assignment.status),
      ['skipped', 'approved', 'approved'],
    );
    assert.equal(replacement.status, 'approved');
    for (const publication of fixture.publications.filter((item) => item.status === 'pending')) {
      await fixture.service.handleRuntimePublication(String(publication.id));
    }
    assert.equal(
      fixture.publications.find((publication) => publication.outcomeStatus === 'approved')?.status,
      'published',
    );
    assert.equal(fixture.entityUpdates.filter((update) => update.webhook === true).length, 2);
  });

  it('keeps current assignments when an SLA reassign cannot satisfy a fixed quorum', async () => {
    const fixture = createRestartFixture();
    const review = fixture.executable.steps.find((step) => step.node.id === 'review');
    assert.ok(review?.node.type === 'approver_group');
    review.node.config.resolvers.push({ type: 'user', userId: FALLBACK_ID });
    review.node.config.quorum = { type: 'count', count: 2 };
    fixture.executable.steps.push({
      node: {
        id: 'review-timer',
        name: 'Review SLA',
        type: 'escalation_timer',
        disabled: false,
        config: {
          parentNodeId: 'review',
          slaHours: 1,
          warningPercent: 50,
          action: {
            type: 'reassign',
            resolvers: [{ type: 'user', userId: FALLBACK_ID }],
          },
        },
      },
      transitions: [],
    });
    await fixture.service.restartOnLatest(
      fixture.oldRequest.id,
      ORGANIZATION_ID,
      fixture.oldRequest.initiatedBy,
    );
    const replacement = fixture.getReplacement();
    assert.ok(replacement);
    replacement.updatedAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);

    await assert.rejects(
      fixture.service.handleEscalation({
        organizationId: ORGANIZATION_ID,
        approvalRequestId: String(replacement.id),
        definitionVersionId: String(replacement.definitionVersionId),
        parentNodeId: 'review',
        timerNodeId: 'review-timer',
        attempt: Number(replacement.attempt),
        kind: 'action',
      }),
      /resolved 1 replacement approvers, but 2 are required/,
    );

    assert.deepEqual(
      fixture.assignments
        .filter((assignment) => assignment.approvalRequestId === replacement.id)
        .map((assignment) => assignment.status),
      ['pending', 'waiting'],
    );
  });

  it('preserves prior approvals and excludes their assignees from SLA replacements', async () => {
    const fixture = createRestartFixture();
    const review = fixture.executable.steps.find((step) => step.node.id === 'review');
    assert.ok(review?.node.type === 'approver_group');
    review.node.config.resolvers.push({ type: 'user', userId: FALLBACK_ID });
    review.node.config.quorum = { type: 'count', count: 2 };
    fixture.executable.steps.push({
      node: {
        id: 'review-timer',
        name: 'Review SLA',
        type: 'escalation_timer',
        disabled: false,
        config: {
          parentNodeId: 'review',
          slaHours: 1,
          warningPercent: 50,
          action: {
            type: 'reassign',
            resolvers: [
              { type: 'user', userId: APPROVER_ID },
              { type: 'user', userId: FALLBACK_ID },
            ],
          },
        },
      },
      transitions: [],
    });
    await fixture.service.restartOnLatest(
      fixture.oldRequest.id,
      ORGANIZATION_ID,
      fixture.oldRequest.initiatedBy,
    );
    const replacement = fixture.getReplacement();
    assert.ok(replacement);
    await fixture.service.processAction(
      String(replacement.id),
      DELEGATE_ID,
      'approve',
      undefined,
      ORGANIZATION_ID,
    );
    replacement.updatedAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);

    await fixture.service.handleEscalation({
      organizationId: ORGANIZATION_ID,
      approvalRequestId: String(replacement.id),
      definitionVersionId: String(replacement.definitionVersionId),
      parentNodeId: 'review',
      timerNodeId: 'review-timer',
      attempt: Number(replacement.attempt),
      kind: 'action',
    });

    const activeAttemptAssignments = fixture.assignments.filter(
      (assignment) => assignment.approvalRequestId === replacement.id,
    );
    assert.deepEqual(
      activeAttemptAssignments.map((assignment) => assignment.status),
      ['approved', 'skipped', 'pending'],
    );
    assert.deepEqual(
      activeAttemptAssignments.map((assignment) => assignment.assignedApproverId),
      [DELEGATE_ID, FALLBACK_ID, FALLBACK_ID],
    );
  });

  it('skips active assignments when an SLA auto-rejects the request', async () => {
    const fixture = createRestartFixture();
    await fixture.service.restartOnLatest(
      fixture.oldRequest.id,
      ORGANIZATION_ID,
      fixture.oldRequest.initiatedBy,
    );
    fixture.executable.steps.push({
      node: {
        id: 'review-timer',
        name: 'Review SLA',
        type: 'escalation_timer',
        disabled: false,
        config: {
          parentNodeId: 'review',
          slaHours: 1,
          warningPercent: 50,
          action: { type: 'auto_reject' },
        },
      },
      transitions: [],
    });
    const replacement = fixture.getReplacement();
    assert.ok(replacement);
    replacement.updatedAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);

    await fixture.service.handleEscalation({
      organizationId: ORGANIZATION_ID,
      approvalRequestId: String(replacement.id),
      definitionVersionId: String(replacement.definitionVersionId),
      parentNodeId: 'review',
      timerNodeId: 'review-timer',
      attempt: Number(replacement.attempt),
      kind: 'action',
    });

    const activeAttemptAssignments = fixture.assignments.filter(
      (assignment) => assignment.approvalRequestId === replacement.id,
    );
    assert.deepEqual(
      activeAttemptAssignments.map((assignment) => assignment.status),
      ['skipped'],
    );
    assert.equal(replacement.status, 'rejected');
  });

  it('claims an escalation action once before notifying assignees', async () => {
    const fixture = createRestartFixture();
    await fixture.service.restartOnLatest(
      fixture.oldRequest.id,
      ORGANIZATION_ID,
      fixture.oldRequest.initiatedBy,
    );
    fixture.notifications.splice(0);
    fixture.executable.steps.push({
      node: {
        id: 'review-timer',
        name: 'Review SLA',
        type: 'escalation_timer',
        disabled: false,
        config: {
          parentNodeId: 'review',
          slaHours: 1,
          warningPercent: 50,
          action: { type: 'notify' },
        },
      },
      transitions: [],
    });
    const replacement = fixture.getReplacement();
    assert.ok(replacement);
    replacement.updatedAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    const job = {
      organizationId: ORGANIZATION_ID,
      approvalRequestId: String(replacement.id),
      definitionVersionId: String(replacement.definitionVersionId),
      parentNodeId: 'review',
      timerNodeId: 'review-timer',
      attempt: Number(replacement.attempt),
      kind: 'action' as const,
    };

    await fixture.service.handleEscalation(job);
    await fixture.service.handleEscalation(job);

    assert.deepEqual(fixture.notifications, [DELEGATE_ID]);
    assert.equal(
      fixture.actions.filter(
        (action) => action.action === 'escalation_action' && action.nodeId === 'review-timer',
      ).length,
      1,
    );
  });
});

describe('WorkflowExecutionService escalation scheduling', () => {
  it('creates durable warning and action jobs tied to the pinned attempt', async () => {
    const jobs: Array<{
      name: string;
      data: Record<string, unknown>;
      options: Record<string, unknown>;
    }> = [];
    const executable = executableWithApproval();
    executable.steps.push({
      node: {
        id: 'review-timer',
        name: 'Review SLA',
        type: 'escalation_timer',
        disabled: false,
        config: {
          parentNodeId: 'review',
          slaHours: 2,
          warningPercent: 75,
          action: { type: 'auto_reject' },
        },
      },
      transitions: [],
    });
    const request = {
      id: '00000000-0000-0000-0000-000000000301',
      organizationId: ORGANIZATION_ID,
      definitionVersionId: '00000000-0000-0000-0000-000000000502',
      currentNodeId: 'review',
      attempt: 3,
      status: 'pending',
      updatedAt: new Date(Date.now() + 60_000),
    };
    const db = {
      query: {
        approvalRequests: { findFirst: async () => request },
        workflowDefinitionVersions: {
          findFirst: async () => ({ id: request.definitionVersionId, executableJson: executable }),
        },
      },
    } as unknown as Db;
    const queue = {
      add: async (
        name: string,
        data: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => {
        jobs.push({ name, data, options });
      },
    } as unknown as Queue;
    const service = new WorkflowExecutionService(
      db,
      queue,
      {} as ApprovalDelegationsService,
      {} as BudgetsService,
      {} as NotificationsService,
      {} as WebhookEventService,
      {} as AuditService,
    );

    await service.scheduleEscalations(request.id, ORGANIZATION_ID);

    assert.deepEqual(
      jobs.map((job) => [job.name, job.options.delay, job.options.jobId]),
      [
        ['warning', 5_400_000, `workflow-warning-${request.id}-${request.attempt}-review-timer`],
        ['action', 7_200_000, `workflow-action-${request.id}-${request.attempt}-review-timer`],
      ],
    );
    assert.ok(jobs.every((job) => job.data.definitionVersionId === request.definitionVersionId));
    assert.ok(
      jobs.every(
        (job) =>
          job.options.attempts === 5 &&
          (job.options.backoff as { type?: string }).type === 'exponential' &&
          job.options.removeOnFail === undefined,
      ),
    );

    jobs.splice(0);
    request.updatedAt = new Date(Date.now() - 5_400_000);
    await service.scheduleEscalations(request.id, ORGANIZATION_ID);
    assert.equal(jobs[0]?.options.delay, 0);
    assert.ok(Number(jobs[1]?.options.delay) > 1_790_000);
    assert.ok(Number(jobs[1]?.options.delay) <= 1_800_000);
  });

  it('ignores a valid action job before the pinned step SLA has elapsed', async () => {
    const executable = executableWithApproval();
    executable.steps.push({
      node: {
        id: 'review-timer',
        name: 'Review SLA',
        type: 'escalation_timer',
        disabled: false,
        config: {
          parentNodeId: 'review',
          slaHours: 1,
          warningPercent: 75,
          action: { type: 'auto_reject' },
        },
      },
      transitions: [],
    });
    const current = {
      id: '00000000-0000-4000-8000-000000000301',
      organizationId: ORGANIZATION_ID,
      approvableType: 'requisition',
      approvableId: '00000000-0000-4000-8000-000000000401',
      approvalRuleId: null,
      definitionVersionId: '00000000-0000-4000-8000-000000000501',
      initiatedBy: '00000000-0000-4000-8000-000000000601',
      currentNodeId: 'review',
      workflowContext: {},
      attempt: 1,
      currentStep: 1,
      status: 'pending',
      requiredApproverId: null,
      requiredApprovalStep: null,
      requiredApprovalReason: null,
      requiredApprovalKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let transactions = 0;
    const db = {
      query: {
        approvalRequests: { findFirst: async () => current },
        workflowDefinitionVersions: { findFirst: async () => ({ executableJson: executable }) },
        workflowApprovalAssignments: {
          findMany: async () => {
            throw new Error('Assignments must not be loaded before the trusted deadline');
          },
        },
      },
      transaction: async () => {
        transactions += 1;
      },
    } as unknown as Db;
    const service = new WorkflowExecutionService(
      db,
      {} as Queue,
      {} as ApprovalDelegationsService,
      {} as BudgetsService,
      {} as NotificationsService,
      {} as WebhookEventService,
      {} as AuditService,
    );

    await service.handleEscalation({
      organizationId: current.organizationId,
      approvalRequestId: current.id,
      definitionVersionId: current.definitionVersionId,
      parentNodeId: current.currentNodeId,
      timerNodeId: 'review-timer',
      attempt: current.attempt,
      kind: 'action',
    });

    assert.equal(transactions, 0);
  });

  for (const escalationAction of [
    { type: 'auto_reject' as const },
    { type: 'reassign' as const, resolvers: [{ type: 'user' as const, userId: APPROVER_ID }] },
  ]) {
    it(`does not ${escalationAction.type} after the request changed under its row lock`, async () => {
      const executable = executableWithApproval();
      executable.steps.push({
        node: {
          id: 'review-timer',
          name: 'Review SLA',
          type: 'escalation_timer',
          disabled: false,
          config: {
            parentNodeId: 'review',
            slaHours: 1,
            warningPercent: 75,
            action: escalationAction,
          },
        },
        transitions: [],
      });
      const current = {
        id: '00000000-0000-4000-8000-000000000301',
        organizationId: '00000000-0000-4000-8000-000000000101',
        approvableType: 'requisition',
        approvableId: '00000000-0000-4000-8000-000000000401',
        approvalRuleId: null,
        definitionVersionId: '00000000-0000-4000-8000-000000000501',
        initiatedBy: '00000000-0000-4000-8000-000000000601',
        currentNodeId: 'review',
        workflowContext: {},
        attempt: 1,
        currentStep: 1,
        status: 'pending',
        requiredApproverId: null,
        requiredApprovalStep: null,
        requiredApprovalReason: null,
        requiredApprovalKey: null,
        createdAt: new Date(),
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1_000),
      };
      const locked = { ...current, status: 'cancelled' };
      const writes: string[] = [];
      const transaction = {
        select: () => ({
          from: () => ({ where: () => ({ for: async () => [locked] }) }),
        }),
        update: () => writes.push('update'),
        insert: () => writes.push('insert'),
      };
      const db = {
        query: {
          approvalRequests: { findFirst: async () => current },
          workflowApprovalAssignments: { findMany: async () => [] },
          workflowDefinitionVersions: {
            findFirst: async () => ({ executableJson: executable }),
          },
        },
        transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      } as unknown as Db;
      const service = new WorkflowExecutionService(
        db,
        {} as Queue,
        {} as ApprovalDelegationsService,
        {} as BudgetsService,
        {} as NotificationsService,
        {} as WebhookEventService,
        {} as AuditService,
      );

      await service.handleEscalation({
        organizationId: current.organizationId,
        approvalRequestId: current.id,
        definitionVersionId: current.definitionVersionId,
        parentNodeId: current.currentNodeId,
        timerNodeId: 'review-timer',
        attempt: current.attempt,
        kind: 'action',
      });

      assert.deepEqual(writes, []);
    });
  }

  it('ignores a warning whose compiled timer does not belong to the waiting step', async () => {
    const executable = executableWithApproval();
    executable.steps.push({
      node: {
        id: 'foreign-timer',
        name: 'Foreign SLA',
        type: 'escalation_timer',
        disabled: false,
        config: {
          parentNodeId: 'different-review',
          slaHours: 1,
          warningPercent: 75,
          action: { type: 'auto_reject' },
        },
      },
      transitions: [],
    });
    const request = {
      id: '00000000-0000-4000-8000-000000000301',
      organizationId: '00000000-0000-4000-8000-000000000101',
      definitionVersionId: '00000000-0000-4000-8000-000000000502',
      currentNodeId: 'review',
      attempt: 1,
      status: 'pending',
    };
    const writes: string[] = [];
    const db = {
      query: {
        approvalRequests: { findFirst: async () => request },
        workflowApprovalAssignments: { findMany: async () => [] },
        workflowDefinitionVersions: {
          findFirst: async () => ({ executableJson: executable }),
        },
      },
      transaction: async () => writes.push('transaction'),
    } as unknown as Db;
    const service = new WorkflowExecutionService(
      db,
      {} as Queue,
      {} as ApprovalDelegationsService,
      {} as BudgetsService,
      {} as NotificationsService,
      {} as WebhookEventService,
      {} as AuditService,
    );

    await service.handleEscalation({
      organizationId: request.organizationId,
      approvalRequestId: request.id,
      definitionVersionId: request.definitionVersionId,
      parentNodeId: request.currentNodeId,
      timerNodeId: 'foreign-timer',
      attempt: request.attempt,
      kind: 'warning',
    });

    assert.deepEqual(writes, []);
  });
});
