import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Queue } from 'bullmq';
import type { Db } from '@betterspend/db';
import {
  approvalActions,
  approvalRequests,
  requisitions,
  workflowApprovalAssignments,
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

function executableWithApproval(): ExecutableDefinition {
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
            separationOfDuties: { enabled: false, exclude: [], fallbackResolvers: [] },
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

function createRestartFixture() {
  const executable = executableWithApproval();
  const oldRequest = {
    id: '00000000-0000-0000-0000-000000000301',
    organizationId: ORGANIZATION_ID,
    approvableType: 'requisition',
    approvableId: '00000000-0000-0000-0000-000000000401',
    approvalRuleId: null,
    definitionVersionId: '00000000-0000-0000-0000-000000000501',
    initiatedBy: '00000000-0000-0000-0000-000000000601',
    currentNodeId: 'old-review',
    workflowContext: { totalAmount: '100' },
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
  let replacement: Record<string, unknown> | null = null;
  const assignments: Array<Record<string, unknown>> = [];
  const requestUpdates: Array<Record<string, unknown>> = [];
  const entityUpdates: Array<Record<string, unknown>> = [];
  const actions: Array<Record<string, unknown>> = [];
  const notifications: string[] = [];

  const transaction = {
    query: {
      workflowDefinitionVersions: { findFirst: async () => latest },
      workflowApprovalAssignments: { findMany: async () => assignments },
      users: {
        findMany: async () => [
          {
            id: APPROVER_ID,
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
            return { where: () => ({ for: async () => [oldRequest] }) };
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
              id: `00000000-0000-0000-0000-${String(index + 701).padStart(12, '0')}`,
              createdAt: new Date(),
              updatedAt: new Date(),
              actedBy: null,
              actedAt: null,
            }));
            assignments.push(...created);
            return { returning: async () => created };
          }
          if (table === approvalActions) actions.push(...rows);
          return { returning: async () => rows };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              if (table !== approvalRequests) {
                entityUpdates.push(values);
                return { returning: async () => [] };
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
      workflowApprovalAssignments: { findMany: async () => assignments },
    },
  } as unknown as Db;
  const queue = { add: async () => undefined } as unknown as Queue;
  const delegations = {
    getActiveDelegatee: async () => DELEGATE_ID,
  } as unknown as ApprovalDelegationsService;
  const budgets = {
    recordRequisitionApproval: async () => entityUpdates.push({ budget: 'approved' }),
    releaseRequisition: async () => entityUpdates.push({ budget: 'released' }),
  } as unknown as BudgetsService;
  const notificationService = {
    create: async (_organizationId: string, userId: string) => notifications.push(userId),
  } as unknown as NotificationsService;
  const webhooks = {
    emit: () => entityUpdates.push({ webhook: true }),
  } as unknown as WebhookEventService;
  const audit = { log: async () => undefined } as unknown as AuditService;

  return {
    actions,
    assignments,
    entityUpdates,
    notifications,
    oldRequest,
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
    assert.equal(fixture.assignments.length, 1);
    assert.equal(fixture.assignments[0]?.resolvedApproverId, APPROVER_ID);
    assert.equal(fixture.assignments[0]?.assignedApproverId, DELEGATE_ID);
    assert.deepEqual(fixture.notifications, [DELEGATE_ID]);
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
  });

  it('ignores a timer whose compiled parent does not match the waiting step', async () => {
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
      kind: 'action',
    });

    assert.deepEqual(writes, []);
  });
});
