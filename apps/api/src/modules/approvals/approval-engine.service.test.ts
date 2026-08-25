import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Db } from '@betterspend/db';
import { approvalActions, approvalRequests } from '@betterspend/db';
import type { WebhookEventService } from '../webhooks/webhook-event.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { ApprovalDelegationsService } from '../approval-delegations/approval-delegations.service';
import type { SettingsService } from '../settings/settings.service';
import type { BudgetsService } from '../budgets/budgets.service';
import { ApprovalEngineService } from './approval-engine.service';

function createService(
  ruleSteps: Array<{
    stepOrder: number;
    approverId?: string;
    approverType?: string;
    approverRole?: string;
  }> = [],
  lockedRequest?: Record<string, unknown>,
  requiredApproverIsActive = true,
  actorRoles: Array<{ role: string; scopeType: string; scopeId: string | null }> = [],
  delegatedApproverId?: string,
) {
  const approvalRequestValues: Array<Record<string, unknown>> = [];
  const approvalActionValues: Array<Record<string, unknown>> = [];
  const updateValues: Array<Record<string, unknown>> = [];
  const emitted: Array<Record<string, unknown>> = [];
  const commitmentActions: string[] = [];
  const transaction = {
    query: {
      approvalRules: {
        findFirst: async () => (ruleSteps.length > 0 ? { steps: ruleSteps } : null),
      },
      requisitions: { findFirst: async () => ({ id: 'requisition-1' }) },
      purchaseOrders: { findFirst: async () => ({ id: 'purchase-order-1' }) },
      users: {
        findFirst: async () => ({ id: 'role-approver', userRoles: actorRoles }),
      },
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                for: async () =>
                  lockedRequest ? [{ organizationId: 'organization-1', ...lockedRequest }] : [],
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          if (table === approvalRequests) {
            approvalRequestValues.push(values);
            return { returning: async () => [{ id: 'approval-request-1' }] };
          }
          if (table === approvalActions) approvalActionValues.push(values);
          return Promise.resolve();
        },
      };
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          updateValues.push(values);
          return {
            where: () => ({ returning: async () => [{ id: 'transitioned-entity' }] }),
          };
        },
      };
    },
  };
  const db = {
    query: {
      requisitions: { findFirst: async () => ({ id: 'requisition-1', totalAmount: '25' }) },
      purchaseOrders: {
        findFirst: async () => ({ id: 'purchase-order-1', totalAmount: '25' }),
      },
      users: { findFirst: async () => (requiredApproverIsActive ? { id: 'owner-1' } : null) },
      approvalRules: {
        findMany: async () =>
          ruleSteps.length > 0
            ? [
                {
                  id: 'rule-1',
                  name: 'Standard rule',
                  conditions: '{"field":"totalAmount","operator":">=","value":0}',
                  steps: ruleSteps,
                },
              ]
            : [],
      },
    },
    transaction: async (callback: (tx: typeof transaction) => Promise<string>) =>
      callback(transaction),
  } as unknown as Db;
  const webhookEvents = {
    emit: (_organizationId: string, _event: string, payload: Record<string, unknown>) => {
      emitted.push(payload);
    },
  } as unknown as WebhookEventService;
  const settings = {
    get: async () => {
      throw new Error('Fast-lane settings must not be read for required approvals');
    },
  } as unknown as SettingsService;
  const delegations = delegatedApproverId
    ? ({
        getActiveDelegatee: async () => delegatedApproverId,
      } as unknown as ApprovalDelegationsService)
    : (undefined as unknown as ApprovalDelegationsService);
  const budgets = {
    recordRequisitionApproval: async () => commitmentActions.push('reserved'),
    releaseRequisition: async () => commitmentActions.push('released'),
    releasePurchaseOrder: async () => commitmentActions.push('po_released'),
  } as unknown as BudgetsService;

  return {
    approvalRequestValues,
    approvalActionValues,
    updateValues,
    emitted,
    service: new ApprovalEngineService(
      db,
      webhookEvents,
      undefined as unknown as NotificationsService,
      delegations,
      settings,
      budgets,
    ),
    commitmentActions,
  };
}

describe('ApprovalEngineService required approvals', () => {
  it('creates a budget-owner-only request instead of fast-lane auto-approving', async () => {
    const { approvalRequestValues, service } = createService();

    const result = await service.initiateApproval(
      'organization-1',
      'requisition',
      'requisition-1',
      'requester-1',
      {
        approverId: 'owner-1',
        reason: 'Budget owner approval is required.',
        key: 'budget:1:requisition:1:owner:1',
      },
    );

    assert.equal(result.autoApproved, false);
    assert.deepEqual(approvalRequestValues[0], {
      organizationId: 'organization-1',
      approvableType: 'requisition',
      approvableId: 'requisition-1',
      approvalRuleId: null,
      initiatedBy: 'requester-1',
      currentStep: 1,
      status: 'pending',
      requiredApproverId: 'owner-1',
      requiredApprovalStep: 1,
      requiredApprovalReason: 'Budget owner approval is required.',
      requiredApprovalKey: 'budget:1:requisition:1:owner:1',
    });
  });

  it('appends the budget owner after the last configured rule step', async () => {
    const { approvalRequestValues, service } = createService([{ stepOrder: 2 }, { stepOrder: 4 }]);

    await service.initiateApproval(
      'organization-1',
      'requisition',
      'requisition-1',
      'requester-1',
      {
        approverId: 'owner-1',
        reason: 'Budget owner approval is required.',
        key: 'budget:1:requisition:1:owner:1',
      },
    );

    assert.equal(approvalRequestValues[0]?.currentStep, 2);
    assert.equal(approvalRequestValues[0]?.requiredApprovalStep, 5);
  });

  it('can create a required-owner-only request after normal approval', async () => {
    const { approvalRequestValues, service } = createService([
      { stepOrder: 2, approverId: 'normal-approver' },
    ]);

    await service.initiateApproval(
      'organization-1',
      'purchase_order',
      'purchase-order-1',
      'requester-1',
      {
        approverId: 'owner-1',
        reason: 'Budget owner approval is required.',
        key: 'budget:1:purchase-order:1:owner:1',
        only: true,
      },
    );

    assert.equal(approvalRequestValues[0]?.approvalRuleId, null);
    assert.equal(approvalRequestValues[0]?.currentStep, 1);
    assert.equal(approvalRequestValues[0]?.requiredApprovalStep, 1);
  });

  it('rejects a required approver outside the active organization users', async () => {
    const { service } = createService([], undefined, false);

    await assert.rejects(
      service.initiateApproval('organization-1', 'requisition', 'requisition-1', 'requester-1', {
        approverId: 'other-org-owner',
        reason: 'Budget owner approval is required.',
        key: 'budget:1:requisition:1:owner:other',
      }),
      /active user in this organization/,
    );
  });

  it('rejects actions from anyone except the owner at the required step', async () => {
    const { service } = createService([], {
      id: 'approval-request-1',
      approvableType: 'requisition',
      approvableId: 'requisition-1',
      status: 'pending',
      approvalRuleId: null,
      currentStep: 1,
      requiredApprovalStep: 1,
      requiredApproverId: 'owner-1',
    });

    await assert.rejects(
      service.processAction(
        'approval-request-1',
        'different-user',
        'approve',
        undefined,
        'organization-1',
      ),
      /assigned to the budget owner/,
    );
  });

  it('allows an active delegate to act at the required owner step', async () => {
    const { commitmentActions, service, updateValues } = createService(
      [],
      {
        id: 'approval-request-1',
        approvableType: 'requisition',
        approvableId: 'requisition-1',
        status: 'pending',
        approvalRuleId: null,
        currentStep: 1,
        requiredApprovalStep: 1,
        requiredApproverId: 'owner-1',
      },
      true,
      [],
      'owner-delegate',
    );

    const result = await service.processAction(
      'approval-request-1',
      'owner-delegate',
      'approve',
      undefined,
      'organization-1',
    );

    assert.deepEqual(result, { status: 'approved' });
    assert.ok(updateValues.some((values) => values.status === 'approved'));
    assert.deepEqual(commitmentActions, ['reserved']);
  });

  it('releases the linked budget commitment when a purchase order is rejected', async () => {
    const { commitmentActions, service } = createService([], {
      id: 'approval-request-1',
      approvableType: 'purchase_order',
      approvableId: 'purchase-order-1',
      status: 'pending',
      approvalRuleId: null,
      currentStep: 1,
      requiredApprovalStep: 1,
      requiredApproverId: 'owner-1',
    });

    const result = await service.processAction(
      'approval-request-1',
      'owner-1',
      'reject',
      undefined,
      'organization-1',
    );

    assert.deepEqual(result, { status: 'rejected' });
    assert.deepEqual(commitmentActions, ['po_released']);
  });

  it('advances the final rule step into the required owner step', async () => {
    const { approvalActionValues, service, updateValues } = createService(
      [
        { stepOrder: 2, approverId: 'first-approver' },
        { stepOrder: 4, approverId: 'rule-approver' },
      ],
      {
        id: 'approval-request-1',
        approvableType: 'requisition',
        approvableId: 'requisition-1',
        status: 'pending',
        approvalRuleId: 'rule-1',
        currentStep: 4,
        requiredApprovalStep: 5,
        requiredApproverId: 'owner-1',
      },
    );

    const result = await service.processAction(
      'approval-request-1',
      'rule-approver',
      'approve',
      undefined,
      'organization-1',
    );

    assert.deepEqual(result, { status: 'pending', advancedToStep: 5 });
    assert.ok(updateValues.some((values) => values.currentStep === 5));
    assert.ok(!updateValues.some((values) => values.status === 'approved'));
    assert.equal(approvalActionValues.filter((values) => values.action === 'approve').length, 1);
    assert.equal(approvalActionValues.filter((values) => values.action === 'forwarded').length, 1);
  });

  it('rejects an actor who is not assigned to the current rule step', async () => {
    const { service } = createService([{ stepOrder: 4, approverId: 'assigned-approver' }], {
      id: 'approval-request-1',
      approvableType: 'requisition',
      approvableId: 'requisition-1',
      status: 'pending',
      approvalRuleId: 'rule-1',
      currentStep: 4,
      requiredApprovalStep: 5,
      requiredApproverId: 'owner-1',
    });

    await assert.rejects(
      service.processAction(
        'approval-request-1',
        'different-user',
        'approve',
        undefined,
        'organization-1',
      ),
      /assigned to another approver/,
    );
  });

  it('rejects an approval request whose current rule step was removed', async () => {
    const { approvalActionValues, service } = createService(
      [{ stepOrder: 4, approverId: 'assigned-approver' }],
      {
        id: 'approval-request-1',
        approvableType: 'requisition',
        approvableId: 'requisition-1',
        status: 'pending',
        approvalRuleId: 'rule-1',
        currentStep: 3,
      },
    );

    await assert.rejects(
      service.processAction(
        'approval-request-1',
        'assigned-approver',
        'approve',
        undefined,
        'organization-1',
      ),
      /no longer configured/,
    );
    assert.equal(approvalActionValues.length, 0);
  });

  it('rejects a rule step without a concrete approver', async () => {
    const { approvalActionValues, service } = createService([{ stepOrder: 4 }], {
      id: 'approval-request-1',
      approvableType: 'requisition',
      approvableId: 'requisition-1',
      status: 'pending',
      approvalRuleId: 'rule-1',
      currentStep: 4,
    });

    await assert.rejects(
      service.processAction(
        'approval-request-1',
        'arbitrary-user',
        'approve',
        undefined,
        'organization-1',
      ),
      /no assigned approver/,
    );
    assert.equal(approvalActionValues.length, 0);
  });

  it('authorizes an actor through a global role assignment', async () => {
    const { approvalActionValues, service } = createService(
      [{ stepOrder: 4, approverType: 'role', approverRole: 'approver' }],
      {
        id: 'approval-request-1',
        approvableType: 'requisition',
        approvableId: 'requisition-1',
        status: 'pending',
        approvalRuleId: 'rule-1',
        currentStep: 4,
      },
      true,
      [{ role: 'approver', scopeType: 'global', scopeId: null }],
    );

    const result = await service.processAction(
      'approval-request-1',
      'role-approver',
      'approve',
      undefined,
      'organization-1',
    );

    assert.deepEqual(result, { status: 'approved' });
    assert.equal(approvalActionValues.filter((values) => values.action === 'approve').length, 1);
  });

  it('finalizes when the assigned owner approves the required step', async () => {
    const { service, updateValues } = createService([{ stepOrder: 4 }], {
      id: 'approval-request-1',
      approvableType: 'requisition',
      approvableId: 'requisition-1',
      status: 'pending',
      approvalRuleId: 'rule-1',
      currentStep: 5,
      requiredApprovalStep: 5,
      requiredApproverId: 'owner-1',
    });

    const result = await service.processAction(
      'approval-request-1',
      'owner-1',
      'approve',
      undefined,
      'organization-1',
    );

    assert.deepEqual(result, { status: 'approved' });
    assert.ok(updateValues.some((values) => values.status === 'approved'));
    assert.ok(!updateValues.some((values) => values.currentStep === 6));
  });
});
