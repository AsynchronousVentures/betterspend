import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Db, DbTransaction } from '@betterspend/db';
import type { SequenceService } from '../../common/services/sequence.service';
import type { AuditService } from '../audit/audit.service';
import type { BudgetsService } from '../budgets/budgets.service';
import type { EntitiesService } from '../entities/entities.service';
import type { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import type { GlExportService } from '../gl/gl-export.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SpendGuardService } from '../spend-guard/spend-guard.service';
import type { SettingsService } from '../settings/settings.service';
import type { WebhookEventService } from '../webhooks/webhook-event.service';
import type { MatchingService } from './matching.service';
import { InvoicesService } from './invoices.service';

function createService(
  recordSpend: BudgetsService['recordSpend'],
  matchStatus = 'full_match',
  options: { createdBy?: string; makerCheckerEnabled?: boolean } = {},
) {
  const auditActions: string[] = [];
  const approved = {
    id: 'invoice-1',
    organizationId: 'organization-1',
    purchaseOrderId: 'po-1',
    status: 'approved',
    matchStatus,
    totalAmount: '125.00',
    exchangeRate: '1',
    internalNumber: 'INV-2026-0001',
    createdBy: options.createdBy ?? 'maker-1',
    lines: [{ taxAmount: '25.00', taxCode: { isRecoverable: true } }],
  };
  const transaction = {
    query: {
      invoices: { findFirst: async () => approved },
      purchaseOrders: {
        findFirst: async () => ({ id: 'po-1', requisitionId: 'requisition-1' }),
      },
      requisitions: {
        findFirst: async () => ({
          id: 'requisition-1',
          departmentId: 'department-1',
          createdAt: new Date('2026-03-01T00:00:00Z'),
        }),
      },
      users: {
        findFirst: async () => ({ id: 'maker-1', departmentId: 'finance' }),
        findMany: async () => [
          {
            id: 'fallback-1',
            name: 'Independent Approver',
            departmentId: 'operations',
            isActive: true,
            userRoles: [{ role: 'approver', scopeType: 'global', customRole: null }],
          },
        ],
      },
    },
    select() {
      return {
        from() {
          return {
            where() {
              return { for: async () => [{ ...approved, status: 'matched' }] };
            },
          };
        },
      };
    },
    update() {
      return {
        set() {
          return {
            where() {
              return { returning: async () => [{ id: 'invoice-1' }] };
            },
          };
        },
      };
    },
  };
  const db = {
    transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  } as unknown as Db;
  const webhookEvents = { emit() {} } as unknown as WebhookEventService;
  const glExport = { enqueue() {} } as unknown as GlExportService;
  const budgets = { recordSpend } as unknown as BudgetsService;
  const audit = {
    log: async (
      _organizationId: string,
      _userId: string | null,
      _entityType: string,
      _entityId: string,
      action: string,
    ) => {
      auditActions.push(action);
    },
  } as unknown as AuditService;
  const settings = {
    get: async () => (options.makerCheckerEnabled === false ? 'false' : 'true'),
  } as unknown as SettingsService;

  return {
    service: new InvoicesService(
      db,
      undefined as unknown as SequenceService,
      undefined as unknown as MatchingService,
      webhookEvents,
      glExport,
      budgets,
      audit,
      undefined as unknown as NotificationsService,
      undefined as unknown as EntitiesService,
      undefined as unknown as ExchangeRatesService,
      undefined as unknown as SpendGuardService,
      settings,
    ),
    transaction: transaction as unknown as DbTransaction,
    auditActions,
  };
}

describe('InvoicesService approval budget accounting', () => {
  it('propagates spend failures from the invoice approval transaction', async () => {
    let receivedTransaction: DbTransaction | undefined;
    let receivedBaseAmount: string | undefined;
    const { service, transaction } = createService(
      async (organizationId, departmentId, baseAmount, fiscalYear, executor) => {
        assert.equal(organizationId, 'organization-1');
        assert.equal(departmentId, 'department-1');
        assert.equal(fiscalYear, 2026);
        receivedBaseAmount = baseAmount;
        receivedTransaction = executor as DbTransaction;
        throw new Error('budget update failed');
      },
    );

    await assert.rejects(
      service.approve('invoice-1', 'organization-1', 'approver-1'),
      /budget update failed/,
    );
    assert.equal(receivedBaseAmount, '100.00');
    assert.equal(receivedTransaction, transaction);
  });

  it('rejects partial matches before posting budget spend', async () => {
    let spendRecorded = false;
    const { service } = createService(async () => {
      spendRecorded = true;
      return { updated: true, budgetId: 'budget-1' };
    }, 'partial_match');

    await assert.rejects(
      service.approve('invoice-1', 'organization-1', 'approver-1'),
      /full three-way match/,
    );
    assert.equal(spendRecorded, false);
  });

  it('blocks the invoice maker and records the independent fallback', async () => {
    let spendRecorded = false;
    const { service, auditActions } = createService(
      async () => {
        spendRecorded = true;
        return { updated: true, budgetId: 'budget-1' };
      },
      'full_match',
      { createdBy: 'maker-1' },
    );

    await assert.rejects(
      service.approve('invoice-1', 'organization-1', 'maker-1'),
      (error: unknown) => {
        assert.ok(error && typeof error === 'object' && 'getResponse' in error);
        const response = (error as { getResponse(): unknown }).getResponse();
        assert.deepEqual(response, {
          code: 'INVOICE_SELF_APPROVAL_BLOCKED',
          message:
            'Invoice creators cannot approve their own invoices. Route this invoice to Independent Approver.',
          fallbackApprover: { id: 'fallback-1', name: 'Independent Approver' },
        });
        return true;
      },
    );
    assert.equal(spendRecorded, false);
    assert.deepEqual(auditActions, ['self_approval_blocked']);
  });

  it('allows self-approval only when an admin disables the policy', async () => {
    let spendRecorded = false;
    const { service } = createService(
      async () => {
        spendRecorded = true;
        return { updated: true, budgetId: 'budget-1' };
      },
      'full_match',
      { createdBy: 'maker-1', makerCheckerEnabled: false },
    );

    await service.approve('invoice-1', 'organization-1', 'maker-1');

    assert.equal(spendRecorded, true);
  });
});
