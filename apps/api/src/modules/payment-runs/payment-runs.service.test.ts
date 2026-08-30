import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  auditLog,
  invoices,
  paymentRunEvents,
  paymentRunInvoices,
  paymentRuns,
  vendorPaymentAccounts,
  vendors,
  type Db,
  type DbTransaction,
} from '@betterspend/db';
import type { AuditService } from '../audit/audit.service';
import type { BudgetsService } from '../budgets/budgets.service';
import type { WebhookEventService } from '../webhooks/webhook-event.service';
import type { WorkflowExecutionService } from '../workflow-execution/workflow-execution.service';
import { PaymentRunsService, sumPaymentRunInvoiceAmounts } from './payment-runs.service';

const organizationId = '00000000-0000-4000-8000-000000000001';

test('sums payment-run invoice amounts with decimal-safe arithmetic', () => {
  assert.equal(sumPaymentRunInvoiceAmounts(['0.1', '0.2', '0.3']), '0.60');
});

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

function createPaymentSubmitHarness(
  options: { invoiceCount?: number; durableWebhookError?: Error } = {},
) {
  const invoiceCount = options.invoiceCount ?? 2;
  const invoiceIds = Array.from({ length: invoiceCount }, (_, index) => `invoice-${index + 1}`);
  const state = {
    runStatus: 'approved',
    invoiceStatuses: new Map(invoiceIds.map((invoiceId) => [invoiceId, 'ready_for_release'])),
    committed: false,
    updates: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
    events: [] as Array<Record<string, unknown>>,
  };
  const invoiceLinks = invoiceIds.map((invoiceId, index) => ({
    invoiceId,
    paymentMethod: 'manual',
    amount: index === 0 ? '0.10' : '0.20',
    currency: 'USD',
    vendorId: 'vendor-1',
    status: 'ready_for_release',
    paidAt: null,
    approvedAt: new Date('2026-08-01T00:00:00.000Z'),
    vendorName: 'Acme Supplies',
    vendorStatus: 'active',
    onboardingStatus: 'approved',
    sanctionsStatus: 'clear',
  }));
  const paidInvoices = invoiceLinks.map((link) => ({
    id: link.invoiceId,
    organizationId,
    vendorId: link.vendorId,
    status: 'paid',
    totalAmount: link.amount,
    paidAt: new Date('2026-08-24T00:00:00.000Z'),
    paymentReference: 'RUN-REF',
  }));
  const durableEvents: Array<{ event: string; payload: unknown }> = [];
  const queuedDeliveryIds: string[][] = [];
  const vendorRows = [{ vendorId: 'vendor-1' }];
  const accountRows = [
    {
      vendorId: 'vendor-1',
      verificationStatus: 'verified',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    },
  ];

  let selectCall = 0;
  type SelectQuery = {
    from(table: unknown): SelectQuery;
    innerJoin(...args: unknown[]): SelectQuery;
    where(...args: unknown[]): SelectQuery | Promise<unknown>;
    for(...args: unknown[]): Promise<unknown>;
  };
  const transaction = {
    execute: async () => [],
    query: {
      invoices: {
        findMany: async () => paidInvoices,
      },
    },
    select: () => {
      const call = selectCall++;
      let table: unknown;
      const query = {} as SelectQuery;
      query.from = (nextTable) => {
        table = nextTable;
        return query;
      };
      query.innerJoin = () => query;
      query.where = () => (call === 1 ? Promise.resolve(vendorRows) : query);
      query.for = async () => {
        if (call === 0) return [{ status: state.runStatus }];
        if (call === 2) return invoiceLinks;
        if (call === 3 && table === vendorPaymentAccounts) return accountRows;
        return [];
      };
      return query;
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push({ table, values });
        if (table === paymentRuns && typeof values.status === 'string') {
          state.runStatus = values.status;
        }
        if (table === invoices && values.status === 'paid') {
          for (const invoiceId of invoiceIds) state.invoiceStatuses.set(invoiceId, 'paid');
        }
        return { where: async () => undefined };
      },
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (table === paymentRunEvents) state.events.push(values);
      },
    }),
  } as unknown as DbTransaction;
  const db = {
    transaction: async (callback: (tx: DbTransaction) => Promise<unknown>) => {
      const previousRunStatus = state.runStatus;
      const previousInvoiceStatuses = new Map(state.invoiceStatuses);
      const previousUpdateCount = state.updates.length;
      const previousEventCount = state.events.length;
      try {
        const result = await callback(transaction);
        state.committed = true;
        return result;
      } catch (error: unknown) {
        state.runStatus = previousRunStatus;
        state.invoiceStatuses = previousInvoiceStatuses;
        state.updates.length = previousUpdateCount;
        state.events.length = previousEventCount;
        throw error;
      }
    },
  } as unknown as Db;
  const webhookEvents = {
    recordInvoicePaidInTransaction: async (
      _tx: DbTransaction,
      _organizationId: string,
      invoice: unknown,
    ) => {
      if (options.durableWebhookError) throw options.durableWebhookError;
      durableEvents.push({ event: 'invoice.paid', payload: { invoice } });
      return durableEvents.map((_event, index) => `delivery-${index + 1}`).slice(-1);
    },
    enqueueDurableDeliveries: async (deliveryIds: readonly string[]) => {
      queuedDeliveryIds.push([...deliveryIds]);
    },
  } as unknown as WebhookEventService;
  const service = new PaymentRunsService(
    db,
    { log: async () => undefined } as unknown as AuditService,
    {} as BudgetsService,
    webhookEvents,
    {} as WorkflowExecutionService,
  );
  (service as unknown as { findOne: () => Promise<unknown> }).findOne = async () => ({
    id: 'run-1',
    status: state.runStatus,
    paymentRunInvoices: paidInvoices.map((invoice) => ({ invoice })),
  });

  return { service, state, durableEvents, queuedDeliveryIds };
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

test('submits a payment run once and queues one durable event per invoice after commit', async () => {
  const harness = createPaymentSubmitHarness();

  await harness.service.submit('run-1', organizationId, 'user-1', {
    paymentReference: 'RUN-REF',
  });

  assert.equal(harness.state.committed, true);
  assert.equal(harness.state.runStatus, 'paid');
  assert.deepEqual([...harness.state.invoiceStatuses.values()], ['paid', 'paid']);
  assert.deepEqual(
    harness.durableEvents.map(({ event }) => event),
    ['invoice.paid', 'invoice.paid'],
  );
  assert.deepEqual(harness.queuedDeliveryIds, [['delivery-1', 'delivery-2']]);
});

test('rolls back a payment run when durable webhook recording fails', async () => {
  const harness = createPaymentSubmitHarness({ durableWebhookError: new Error('webhook failed') });

  await assert.rejects(
    harness.service.submit('run-1', organizationId, 'user-1', { paymentReference: 'RUN-REF' }),
    /webhook failed/,
  );

  assert.equal(harness.state.committed, false);
  assert.equal(harness.state.runStatus, 'approved');
  assert.deepEqual(
    [...harness.state.invoiceStatuses.values()],
    ['ready_for_release', 'ready_for_release'],
  );
  assert.deepEqual(harness.queuedDeliveryIds, []);
});

test('does not create duplicate durable payment events after a submitted run is retried', async () => {
  const harness = createPaymentSubmitHarness({ invoiceCount: 1 });

  await harness.service.submit('run-1', organizationId, 'user-1', { paymentReference: 'RUN-REF' });
  await assert.rejects(
    harness.service.submit('run-1', organizationId, 'user-1', { paymentReference: 'RUN-REF' }),
    /Only approved payment runs can be submitted/,
  );

  assert.equal(harness.durableEvents.length, 1);
  assert.deepEqual(harness.queuedDeliveryIds, [['delivery-1']]);
});
