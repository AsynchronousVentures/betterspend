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
import type { WebhookEventService } from '../webhooks/webhook-event.service';
import type { MatchingService } from './matching.service';
import { InvoicesService } from './invoices.service';

function createService(recordSpend: BudgetsService['recordSpend']) {
  const approved = {
    id: 'invoice-1',
    organizationId: 'organization-1',
    purchaseOrderId: 'po-1',
    status: 'approved',
    matchStatus: 'full_match',
    totalAmount: '125.00',
    exchangeRate: '1',
    internalNumber: 'INV-2026-0001',
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
  const audit = { log: async () => {} } as unknown as AuditService;

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
    ),
    transaction: transaction as unknown as DbTransaction,
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
});
