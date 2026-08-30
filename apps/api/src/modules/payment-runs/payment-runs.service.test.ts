import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  auditLog,
  invoices,
  vendorPaymentAccounts,
  vendors,
  type Db,
  type DbTransaction,
} from '@betterspend/db';
import type { AuditService } from '../audit/audit.service';
import type { BudgetsService } from '../budgets/budgets.service';
import type { WebhookEventService } from '../webhooks/webhook-event.service';
import type { WorkflowExecutionService } from '../workflow-execution/workflow-execution.service';
import { PaymentRunsService } from './payment-runs.service';

const organizationId = '00000000-0000-4000-8000-000000000001';

function createAccountChangeHarness(
  options: { workflowConfigured?: boolean; workflowError?: Error } = {},
) {
  const invoiceUpdates: Array<Record<string, unknown>> = [];
  const whereClauses: unknown[] = [];
  let reopenedInvoiceId: string | null = null;
  let cancelledRequest: { id: string; reason?: string } | null = null;
  let initiatedTransaction: unknown;
  let initiatedRequestId: string | null = null;
  let publishedRequestId: string | null = null;

  const invoice = {
    id: 'invoice-1',
    status: 'approved',
  };
  const transaction = {
    query: {
      approvalRequests: {
        findFirst: async () => ({
          id: 'request-1',
          status: 'approved',
          definitionVersionId: 'version-1',
        }),
      },
    },
    execute: async () => [
      {
        changesJson: '{}',
        metadataJson: '{}',
        createdAtText: '2026-08-30T00:00:00.000000Z',
      },
    ],
    select() {
      let table: unknown;
      const query = {
        from(nextTable: unknown) {
          table = nextTable;
          return query;
        },
        where(condition: unknown) {
          whereClauses.push(condition);
          return query;
        },
        orderBy() {
          return query;
        },
        limit: async () => (table === auditLog ? [] : []),
        for: async () => {
          if (table === invoices) return [invoice];
          if (table === vendors) return [{ id: 'vendor-1' }];
          if (table === vendorPaymentAccounts) return [{ vendorId: 'vendor-1' }];
          return [];
        },
      };
      return query;
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          if (table === invoices) invoiceUpdates.push(values);
          return {
            where() {
              return {
                returning: async () => [{ id: 'invoice-1' }],
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          return {
            returning: async () =>
              table === vendorPaymentAccounts
                ? [{ id: 'account-2', ...values }]
                : [{ id: 'audit-1', ...values }],
          };
        },
      };
    },
  };
  const db = {
    query: {
      vendors: {
        findFirst: async () => ({
          id: 'vendor-1',
          organizationId,
          entityId: null,
        }),
      },
    },
    transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  } as unknown as Db;
  const budgets = {
    reopenInvoice: async (_tx: DbTransaction, _orgId: string, invoiceId: string) => {
      reopenedInvoiceId = invoiceId;
    },
  } as unknown as BudgetsService;
  const workflowExecution = {
    cancelForEditInTransaction: async (
      requestId: string,
      _orgId: string,
      _userId: string,
      _tx: DbTransaction,
      options: { reason?: string },
    ) => {
      cancelledRequest = { id: requestId, reason: options.reason };
    },
    initiateIfConfigured: async (
      _orgId: string,
      _entityType: string,
      _entityId: string,
      _initiatedBy: string,
      _requiredApproval: unknown,
      _beforePersist: unknown,
      transactionForWorkflow: unknown,
    ) => {
      initiatedTransaction = transactionForWorkflow;
      if (options.workflowError) throw options.workflowError;
      if (options.workflowConfigured === false) return null;
      initiatedRequestId = 'replacement-request-1';
      return { requestId: initiatedRequestId, status: 'pending' as const };
    },
    publishCommittedRequest: async (requestId: string) => {
      publishedRequestId = requestId;
    },
  } as unknown as WorkflowExecutionService;
  const service = new PaymentRunsService(
    db,
    { log: async () => undefined } as unknown as AuditService,
    budgets,
    { emit: () => undefined } as unknown as WebhookEventService,
    workflowExecution,
  );

  return {
    service,
    invoiceUpdates,
    whereClauses,
    reopenedInvoiceId: () => reopenedInvoiceId,
    cancelledRequest: () => cancelledRequest,
    initiatedTransaction: () => initiatedTransaction,
    initiatedRequestId: () => initiatedRequestId,
    publishedRequestId: () => publishedRequestId,
  };
}

test('invalidates an approved invoice and starts replacement approval in the same transaction', async () => {
  const harness = createAccountChangeHarness();

  await harness.service.createVendorAccount(
    organizationId,
    {
      vendorId: 'vendor-1',
      accountName: 'Operating account',
      maskedAccount: '****1234',
    },
    'user-1',
  );

  assert.equal(harness.reopenedInvoiceId(), 'invoice-1');
  assert.deepEqual(harness.cancelledRequest(), {
    id: 'request-1',
    reason: 'payment_details_changed',
  });
  assert.equal(harness.initiatedRequestId(), 'replacement-request-1');
  assert.equal(harness.publishedRequestId(), 'replacement-request-1');
  assert.notEqual(harness.initiatedTransaction(), undefined);
  assert.ok(
    harness.invoiceUpdates.some(
      (values) =>
        values.status === 'pending_approval' &&
        values.approvedBy === null &&
        values.approvedAt === null &&
        values.releasedBy === null &&
        values.releasedAt === null,
    ),
  );

  const renderedWhere = harness.whereClauses.map((condition) =>
    new PgDialect().sqlToQuery(condition as never),
  );
  assert.ok(
    renderedWhere.some(
      ({ sql, params }) =>
        sql.includes(' in ') && params.includes('approved') && params.includes('ready_for_release'),
    ),
  );
});

test('falls back to manual reapproval when no replacement workflow is configured', async () => {
  const harness = createAccountChangeHarness({ workflowConfigured: false });

  await harness.service.createVendorAccount(
    organizationId,
    { vendorId: 'vendor-1', accountName: 'Operating account', maskedAccount: '****1234' },
    'user-1',
  );

  assert.equal(harness.initiatedRequestId(), null);
  assert.ok(harness.invoiceUpdates.some((values) => values.status === 'matched'));
});

test('propagates replacement workflow failures so account and invalidation share one transaction', async () => {
  const harness = createAccountChangeHarness({
    workflowError: new Error('workflow start failed'),
  });

  await assert.rejects(
    harness.service.createVendorAccount(
      organizationId,
      { vendorId: 'vendor-1', accountName: 'Operating account', maskedAccount: '****1234' },
      'user-1',
    ),
    /workflow start failed/,
  );
  assert.notEqual(harness.initiatedTransaction(), undefined);
});
