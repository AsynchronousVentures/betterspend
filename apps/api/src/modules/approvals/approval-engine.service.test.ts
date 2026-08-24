import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Db } from '@betterspend/db';
import { approvalRequests } from '@betterspend/db';
import type { WebhookEventService } from '../webhooks/webhook-event.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { ApprovalDelegationsService } from '../approval-delegations/approval-delegations.service';
import type { SettingsService } from '../settings/settings.service';
import { ApprovalEngineService } from './approval-engine.service';

function createService(
  ruleSteps: Array<{ stepOrder: number }> = [],
  lockedRequest?: Record<string, unknown>,
  requiredApproverIsActive = true,
) {
  const approvalRequestValues: Array<Record<string, unknown>> = [];
  const emitted: Array<Record<string, unknown>> = [];
  const transaction = {
    query: {
      approvalRules: { findFirst: async () => null },
    },
    select() {
      return {
        from() {
          return {
            where() {
              return { for: async () => (lockedRequest ? [lockedRequest] : []) };
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
          return Promise.resolve();
        },
      };
    },
  };
  const db = {
    query: {
      requisitions: { findFirst: async () => ({ id: 'requisition-1', totalAmount: '25' }) },
      purchaseOrders: { findFirst: async () => null },
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

  return {
    approvalRequestValues,
    emitted,
    service: new ApprovalEngineService(
      db,
      webhookEvents,
      undefined as unknown as NotificationsService,
      undefined as unknown as ApprovalDelegationsService,
      settings,
    ),
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
      { approverId: 'owner-1', reason: 'Budget owner approval is required.' },
    );

    assert.equal(result.autoApproved, false);
    assert.deepEqual(approvalRequestValues[0], {
      approvableType: 'requisition',
      approvableId: 'requisition-1',
      approvalRuleId: null,
      currentStep: 1,
      status: 'pending',
      requiredApproverId: 'owner-1',
      requiredApprovalStep: 1,
      requiredApprovalReason: 'Budget owner approval is required.',
    });
  });

  it('appends the budget owner after the last configured rule step', async () => {
    const { approvalRequestValues, service } = createService([{ stepOrder: 2 }, { stepOrder: 4 }]);

    await service.initiateApproval(
      'organization-1',
      'requisition',
      'requisition-1',
      'requester-1',
      { approverId: 'owner-1', reason: 'Budget owner approval is required.' },
    );

    assert.equal(approvalRequestValues[0]?.currentStep, 2);
    assert.equal(approvalRequestValues[0]?.requiredApprovalStep, 5);
  });

  it('rejects a required approver outside the active organization users', async () => {
    const { service } = createService([], undefined, false);

    await assert.rejects(
      service.initiateApproval('organization-1', 'requisition', 'requisition-1', 'requester-1', {
        approverId: 'other-org-owner',
        reason: 'Budget owner approval is required.',
      }),
      /active user in this organization/,
    );
  });

  it('rejects actions from anyone except the owner at the required step', async () => {
    const { service } = createService([], {
      id: 'approval-request-1',
      status: 'pending',
      approvalRuleId: null,
      currentStep: 1,
      requiredApprovalStep: 1,
      requiredApproverId: 'owner-1',
    });

    await assert.rejects(
      service.processAction('approval-request-1', 'different-user', 'approve'),
      /assigned to the budget owner/,
    );
  });
});
