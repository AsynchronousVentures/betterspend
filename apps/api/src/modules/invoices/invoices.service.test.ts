import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  auditLog,
  invoiceLines,
  invoices,
  vendorPaymentAccounts,
  type Db,
  type DbTransaction,
} from '@betterspend/db';
import { PgDialect } from 'drizzle-orm/pg-core';
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
import type { WorkflowExecutionService } from '../workflow-execution/workflow-execution.service';
import type { AccessPolicy } from '../auth/access-policy';
import type { MatchingService } from './matching.service';
import { InvoicesService } from './invoices.service';

const auditProjection = [
  {
    changesJson: '{}',
    metadataJson: '{}',
    createdAtText: '2026-08-29T00:00:00.000000Z',
  },
];

function createService(
  expenseInvoice: BudgetsService['expenseInvoice'] = async () => {},
  matchStatus = 'full_match',
  options: {
    createdBy?: string | null;
    makerCheckerEnabled?: boolean;
    submissionSource?: 'internal' | 'legacy' | 'vendor_portal';
    blockedAuditFails?: boolean;
    activeApprovalRequest?: boolean;
  } = {},
) {
  const auditActions: string[] = [];
  const approved = {
    id: 'invoice-1',
    organizationId: '00000000-0000-4000-8000-000000000001',
    purchaseOrderId: 'po-1',
    entityId: null,
    status: 'approved',
    matchStatus,
    totalAmount: '125.00',
    baseTotalAmount: '250.00',
    exchangeRate: '2',
    internalNumber: 'INV-2026-0001',
    createdBy: options.createdBy === undefined ? 'maker-1' : options.createdBy,
    submissionSource: options.submissionSource ?? 'internal',
    purchaseOrder: {
      id: 'po-1',
      entityId: 'entity-1',
      issuedBy: null,
      requisition: {
        requesterId: 'requester-1',
        departmentId: 'department-1',
        projectId: null,
      },
    },
    lines: [{ taxAmount: '25.00', taxCode: { isRecoverable: true } }],
  };
  const transaction = {
    query: {
      invoices: { findFirst: async () => approved },
      approvalRequests: {
        findFirst: async () =>
          options.activeApprovalRequest ? { id: 'approval-request-1', status: 'pending' } : null,
      },
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
    execute: async () => auditProjection,
    select() {
      return {
        from() {
          return {
            where() {
              return {
                orderBy() {
                  return { limit: async () => [] };
                },
                limit: async () => [],
                for: async () => [{ ...approved, status: 'matched' }],
              };
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
    insert(table: unknown) {
      return {
        values: (values: { action?: string }) => {
          if (table !== auditLog) return;
          if (options.blockedAuditFails) throw new Error('audit write failed');
          if (values.action) auditActions.push(values.action);
          return { returning: async () => [values] };
        },
      };
    },
  };
  const db = {
    query: transaction.query,
    transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    update() {
      return {
        set() {
          return { where: async () => undefined };
        },
      };
    },
  } as unknown as Db;
  const webhookEvents = { emit() {} } as unknown as WebhookEventService;
  const glExport = { enqueue: async () => undefined } as unknown as GlExportService;
  const budgets = { expenseInvoice } as unknown as BudgetsService;
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
      undefined as unknown as WorkflowExecutionService,
    ),
    transaction: transaction as unknown as DbTransaction,
    auditActions,
  };
}

function scopedInvoiceAccess(permission: 'invoices:manage' | 'invoices:approve'): AccessPolicy {
  return {
    can: (candidate) => candidate === permission,
    scopeFor: (resource, candidate) => ({
      organizationId: '00000000-0000-4000-8000-000000000001',
      userId: 'actor-1',
      unrestricted: false,
      ownOnly: false,
      departmentIds: resource === 'invoice' && candidate === permission ? ['department-1'] : [],
      projectIds: [],
      entityIds: [],
    }),
    isGlobalBuiltInAdmin: () => false,
    toDocument: () => ({ permissions: [permission], scopes: {} }),
  };
}

describe('InvoicesService approval budget accounting', () => {
  it('authorizes scoped approval without exposing the linked purchase order', async () => {
    const { service } = createService();
    const access = scopedInvoiceAccess('invoices:approve');
    const visibleInvoice = await service.findOne(
      'invoice-1',
      '00000000-0000-4000-8000-000000000001',
      access,
    );

    assert.equal(visibleInvoice.purchaseOrder, null);
    assert.equal('authorizationScope' in visibleInvoice, false);
    await service.approve('invoice-1', '00000000-0000-4000-8000-000000000001', 'actor-1', access);
  });

  it('authorizes scoped exception resolution without exposing the linked purchase order', async () => {
    const { service } = createService(async () => {}, 'exception');
    const access = scopedInvoiceAccess('invoices:manage');
    const visibleInvoice = await service.findOne(
      'invoice-1',
      '00000000-0000-4000-8000-000000000001',
      access,
    );

    assert.equal(visibleInvoice.purchaseOrder, null);
    await service.resolveException(
      'invoice-1',
      '00000000-0000-4000-8000-000000000001',
      'actor-1',
      {},
      access,
    );
  });

  it('does not bypass an active approval request through direct invoice approval', async () => {
    const { service } = createService(async () => {}, 'full_match', {
      makerCheckerEnabled: false,
      activeApprovalRequest: true,
    });

    await assert.rejects(
      service.approve('invoice-1', '00000000-0000-4000-8000-000000000001', 'approver-1'),
      /active approval request.*Approvals queue/,
    );
  });

  it('propagates budget accounting failures from the invoice approval transaction', async () => {
    let receivedTransaction: DbTransaction | undefined;
    let receivedAmounts: { expense: string; release: string } | undefined;
    const { service, transaction } = createService(
      async (executor, organizationId, invoiceId, expense, release) => {
        assert.equal(organizationId, '00000000-0000-4000-8000-000000000001');
        assert.equal(invoiceId, 'invoice-1');
        receivedAmounts = { expense, release };
        receivedTransaction = executor;
        throw new Error('budget update failed');
      },
    );

    await assert.rejects(
      service.approve('invoice-1', '00000000-0000-4000-8000-000000000001', 'approver-1'),
      /budget update failed/,
    );
    assert.deepEqual(receivedAmounts, { expense: '200.00', release: '250.00' });
    assert.equal(receivedTransaction, transaction);
  });

  it('rejects partial matches before posting budget spend', async () => {
    let spendRecorded = false;
    const { service } = createService(async () => {
      spendRecorded = true;
    }, 'partial_match');

    await assert.rejects(
      service.approve('invoice-1', '00000000-0000-4000-8000-000000000001', 'approver-1'),
      /full three-way match/,
    );
    assert.equal(spendRecorded, false);
  });

  it('moves persisted base spend out of the PO commitment in the same transaction', async () => {
    let expensed:
      | {
          organizationId: string;
          invoiceId: string;
          expenseAmount: string;
          commitmentReleaseAmount: string;
          executor: DbTransaction;
        }
      | undefined;
    const { service, transaction } = createService(
      async (executor, organizationId, invoiceId, expenseAmount, commitmentReleaseAmount) => {
        expensed = {
          executor,
          organizationId,
          invoiceId,
          expenseAmount,
          commitmentReleaseAmount,
        };
      },
    );

    await service.approve('invoice-1', '00000000-0000-4000-8000-000000000001', 'approver-1');

    assert.deepEqual(expensed, {
      executor: transaction,
      organizationId: '00000000-0000-4000-8000-000000000001',
      invoiceId: 'invoice-1',
      expenseAmount: '200.00',
      commitmentReleaseAmount: '250.00',
    });
  });

  it('blocks the invoice maker and records the independent fallback', async () => {
    let spendRecorded = false;
    const { service, auditActions } = createService(
      async () => {
        spendRecorded = true;
      },
      'full_match',
      { createdBy: 'maker-1' },
    );

    await assert.rejects(
      service.approve('invoice-1', '00000000-0000-4000-8000-000000000001', 'maker-1'),
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
      },
      'full_match',
      { createdBy: 'maker-1', makerCheckerEnabled: false },
    );

    await service.approve('invoice-1', '00000000-0000-4000-8000-000000000001', 'maker-1');

    assert.equal(spendRecorded, true);
  });

  it('fails closed when a legacy invoice has no authoritative creator', async () => {
    let spendRecorded = false;
    const { service, auditActions } = createService(
      async () => {
        spendRecorded = true;
      },
      'full_match',
      { createdBy: null, submissionSource: 'legacy' },
    );

    await assert.rejects(
      service.approve('invoice-1', '00000000-0000-4000-8000-000000000001', 'approver-1'),
      (error: unknown) => {
        assert.ok(error && typeof error === 'object' && 'getResponse' in error);
        const response = (error as { getResponse(): unknown }).getResponse();
        assert.deepEqual(response, {
          code: 'INVOICE_CREATOR_UNKNOWN',
          message:
            'This invoice has no authoritative creator record. Approval is blocked while maker-checker policy is enabled.',
          fallbackApprover: null,
        });
        return true;
      },
    );
    assert.equal(spendRecorded, false);
    assert.deepEqual(auditActions, ['approval_blocked_unknown_creator']);
  });

  it('allows independent approval of vendor-portal invoices', async () => {
    let spendRecorded = false;
    const { service } = createService(
      async () => {
        spendRecorded = true;
      },
      'full_match',
      { createdBy: null, submissionSource: 'vendor_portal' },
    );

    await service.approve('invoice-1', '00000000-0000-4000-8000-000000000001', 'approver-1');

    assert.equal(spendRecorded, true);
  });

  it('propagates blocked-approval audit failures', async () => {
    const { service } = createService(async () => {}, 'full_match', {
      createdBy: 'maker-1',
      blockedAuditFails: true,
    });

    await assert.rejects(
      service.approve('invoice-1', '00000000-0000-4000-8000-000000000001', 'maker-1'),
      /audit write failed/,
    );
  });
});

describe('InvoicesService creation audit', () => {
  it('writes the creator audit record in the invoice transaction', async () => {
    const inserted: Array<{ table: unknown; values: unknown }> = [];
    let invoiceLookup = 0;
    const createdInvoice = {
      id: 'invoice-1',
      organizationId: '00000000-0000-4000-8000-000000000001',
      invoiceNumber: 'VENDOR-100',
      totalAmount: '100.00',
      matchStatus: 'unmatched',
    };
    const transaction = {
      execute: async () => auditProjection,
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  orderBy() {
                    return { limit: async () => [] };
                  },
                  limit: async () => [],
                };
              },
            };
          },
        };
      },
      insert(table: unknown) {
        return {
          values(values: unknown) {
            inserted.push({ table, values });
            return table === invoices
              ? { returning: async () => [{ id: 'invoice-1' }] }
              : { returning: async () => [values] };
          },
        };
      },
    };
    const db = {
      query: {
        invoices: {
          findFirst: async () => {
            invoiceLookup += 1;
            return invoiceLookup === 1 ? null : createdInvoice;
          },
        },
      },
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as Db;
    const service = new InvoicesService(
      db,
      { next: async () => 'INV-2026-0001' } as unknown as SequenceService,
      undefined as unknown as MatchingService,
      { emit() {} } as unknown as WebhookEventService,
      { enqueue: async () => undefined } as unknown as GlExportService,
      undefined as unknown as BudgetsService,
      undefined as unknown as AuditService,
      undefined as unknown as NotificationsService,
      { assertBelongsToOrg: async () => {} } as unknown as EntitiesService,
      {
        convertToBase: async () => ({ baseCurrency: 'USD', exchangeRate: 1, baseAmount: 100 }),
        roundMoney: (value: number) => value,
      } as unknown as ExchangeRatesService,
      { analyzeInvoice: async () => {} } as unknown as SpendGuardService,
      undefined as unknown as SettingsService,
      undefined as unknown as WorkflowExecutionService,
    );

    await service.create('00000000-0000-4000-8000-000000000001', 'maker-1', {
      vendorId: 'vendor-1',
      invoiceNumber: 'VENDOR-100',
      invoiceDate: '2026-08-24',
      lines: [
        {
          lineNumber: 1,
          description: 'Services',
          quantity: 1,
          unitPrice: 100,
        },
      ],
    });

    const auditInsert = inserted.find((entry) => entry.table === auditLog);
    const auditValues = auditInsert?.values as Record<string, unknown>;
    assert.deepEqual(
      {
        organizationId: auditValues.organizationId,
        userId: auditValues.userId,
        entityType: auditValues.entityType,
        entityId: auditValues.entityId,
        action: auditValues.action,
        changes: auditValues.changes,
      },
      {
        organizationId: '00000000-0000-4000-8000-000000000001',
        userId: 'maker-1',
        entityType: 'invoice',
        entityId: 'invoice-1',
        action: 'created',
        changes: { invoiceNumber: 'VENDOR-100', totalAmount: '100.00' },
      },
    );
    assert.equal(typeof auditValues.entryHash, 'string');
  });
});

describe('InvoicesService material edits', () => {
  const createEditService = (
    status:
      | 'approved'
      | 'ready_for_release'
      | 'matched'
      | 'rejected'
      | 'cancelled'
      | 'partial_match'
      | 'exception' = 'approved',
    rerunMatchStatus: 'full_match' | 'partial_match' | 'exception' = 'full_match',
    duplicateInvoice = false,
    poVendorId = 'vendor-1',
    workflowConfigured = true,
  ) => {
    const invoice = {
      id: 'invoice-1',
      organizationId: '00000000-0000-4000-8000-000000000001',
      entityId: 'entity-1',
      purchaseOrderId: 'po-1',
      vendorId: 'vendor-1',
      invoiceNumber: 'VENDOR-100',
      internalNumber: 'INV-2026-0001',
      status,
      invoiceDate: new Date('2026-08-01T00:00:00Z'),
      dueDate: new Date('2026-08-31T00:00:00Z'),
      paymentTerms: 'NET30',
      earlyPaymentDiscountPercent: null,
      earlyPaymentDiscountBy: null,
      paidAt: null,
      paymentReference: null,
      subtotal: '100.00',
      taxAmount: '0.00',
      totalAmount: '100.00',
      currency: 'USD',
      baseCurrency: 'USD',
      exchangeRate: '1.00000000',
      baseSubtotal: '100.00',
      baseTaxAmount: '0.00',
      baseTotalAmount: '100.00',
      documentId: null,
      matchStatus: status === 'partial_match' || status === 'exception' ? status : 'full_match',
      matchDetails: {},
      submissionSource: 'internal',
      createdBy: 'maker-1',
      approvedBy: ['approved', 'ready_for_release'].includes(status) ? 'approver-1' : null,
      approvedAt: ['approved', 'ready_for_release'].includes(status)
        ? new Date('2026-08-10T00:00:00Z')
        : null,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-10T00:00:00Z'),
    };
    const line = {
      id: '00000000-0000-4000-8000-000000000101',
      invoiceId: 'invoice-1',
      poLineId: 'po-line-1',
      lineNumber: '1',
      taxCodeId: null,
      description: 'Consulting services',
      quantity: '1.00',
      unitPrice: '100.00',
      taxAmount: '0.00',
      taxInclusive: false,
      totalPrice: '100.00',
      exchangeRate: '1.00000000',
      baseUnitPrice: '100.00',
      baseTotalPrice: '100.00',
      glAccount: '6000',
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T00:00:00Z'),
    };
    const invoiceUpdates: Array<Record<string, unknown>> = [];
    const lineUpdates: Array<Record<string, unknown>> = [];
    const auditActions: string[] = [];
    let reopened = false;
    let restarted = false;
    let cancelled = false;
    let initiated = false;
    let published = false;
    let workflowStartedFromStatus: unknown;
    const transaction = {
      query: {
        invoiceLines: { findMany: async () => [line] },
        taxCodes: { findMany: async () => [] },
        vendors: { findFirst: async () => ({ id: 'vendor-2' }) },
        purchaseOrders: { findFirst: async () => ({ id: 'po-1', vendorId: poVendorId }) },
        poLines: {
          findMany: async () => [],
        },
        approvalRequests: {
          findFirst: async () =>
            ['rejected', 'cancelled', 'partial_match', 'exception'].includes(status)
              ? null
              : {
                  id: 'request-1',
                  status,
                  definitionVersionId: 'version-1',
                },
        },
        invoices: {
          findFirst: async () =>
            duplicateInvoice
              ? { id: 'invoice-2' }
              : { ...invoice, lines: [line], vendor: {}, entity: {} },
        },
      },
      execute: async () => auditProjection,
      select() {
        return {
          from() {
            return {
              where: () => ({
                orderBy: () => ({ limit: async () => [] }),
                limit: async () => [],
                for: async () => [invoice],
              }),
            };
          },
        };
      },
      update(table: unknown) {
        return {
          set(values: Record<string, unknown>) {
            (table === invoices ? invoiceUpdates : lineUpdates).push(values);
            return { where: async () => undefined };
          },
        };
      },
      insert() {
        return {
          values: (values: Record<string, unknown>) => ({
            returning: async () => [values],
          }),
        };
      },
    };
    const db = {
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as Db;
    const workflow = {
      restartOnLatestInTransaction: async () => {
        workflowStartedFromStatus = invoiceUpdates.at(-1)?.status;
        restarted = true;
        return {
          cancelledRequestId: 'request-1',
          replacementRequestId: 'request-2',
          definitionVersionId: 'version-2',
          version: 2,
          attempt: 2,
          status: 'pending' as const,
        };
      },
      cancelForEditInTransaction: async () => {
        cancelled = true;
      },
      initiateIfConfigured: async () => {
        workflowStartedFromStatus = invoiceUpdates.at(-1)?.status;
        initiated = true;
        return workflowConfigured ? { requestId: 'request-2', status: 'pending' as const } : null;
      },
      publishCommittedRequest: async () => {
        published = true;
      },
    } as unknown as WorkflowExecutionService;
    const service = new InvoicesService(
      db,
      undefined as unknown as SequenceService,
      {
        runMatch: async () => ({ matchStatus: rerunMatchStatus, lineResults: [] }),
      } as unknown as MatchingService,
      { emit() {} } as unknown as WebhookEventService,
      { enqueue: async () => undefined } as unknown as GlExportService,
      {
        reopenInvoice: async () => {
          reopened = true;
        },
      } as unknown as BudgetsService,
      {
        log: async (
          _organizationId: string,
          _actorId: string,
          _entityType: string,
          _entityId: string,
          action: string,
        ) => {
          auditActions.push(action);
        },
      } as unknown as AuditService,
      undefined as unknown as NotificationsService,
      undefined as unknown as EntitiesService,
      {
        getOrganizationBaseCurrency: async () => 'USD',
        getRateDecimal: async () => '1.00000000',
        roundMoney: (value: number) => value,
      } as unknown as ExchangeRatesService,
      undefined as unknown as SpendGuardService,
      undefined as unknown as SettingsService,
      workflow,
    );
    return {
      service,
      invoiceUpdates,
      lineUpdates,
      auditActions,
      state: () => ({ reopened, restarted, cancelled, initiated, published }),
      workflowStartedFromStatus: () => workflowStartedFromStatus,
    };
  };

  it('atomically reopens budget posting and restarts approval for an amount edit', async () => {
    const fixture = createEditService();

    await fixture.service.update('invoice-1', '00000000-0000-4000-8000-000000000001', 'editor-1', {
      lines: [{ id: '00000000-0000-4000-8000-000000000101', quantity: 2 }],
    });

    assert.deepEqual(fixture.state(), {
      reopened: true,
      restarted: true,
      cancelled: false,
      initiated: false,
      published: true,
    });
    assert.ok(fixture.invoiceUpdates.some((update) => update.approvedBy === null));
    assert.ok(fixture.invoiceUpdates.some((update) => update.status === 'pending_approval'));
    assert.equal(fixture.workflowStartedFromStatus(), 'pending_approval');
    assert.ok(fixture.lineUpdates.some((update) => update.quantity === '2.00'));
    assert.deepEqual(fixture.auditActions, ['material_edit_reapproval']);
  });

  it('keeps approval intact for a description-only correction', async () => {
    const fixture = createEditService();

    await fixture.service.update('invoice-1', '00000000-0000-4000-8000-000000000001', 'editor-1', {
      lines: [
        {
          id: '00000000-0000-4000-8000-000000000101',
          description: 'Consulting service',
        },
      ],
    });

    assert.deepEqual(fixture.state(), {
      reopened: false,
      restarted: false,
      cancelled: false,
      initiated: false,
      published: false,
    });
    assert.ok(!fixture.invoiceUpdates.some((update) => update.approvedBy === null));
    assert.ok(fixture.lineUpdates.some((update) => update.description === 'Consulting service'));
    assert.deepEqual(fixture.auditActions, ['updated']);
  });

  it('cancels approval without restarting when the edited invoice no longer fully matches', async () => {
    const fixture = createEditService('approved', 'partial_match');

    await fixture.service.update('invoice-1', '00000000-0000-4000-8000-000000000001', 'editor-1', {
      lines: [{ id: '00000000-0000-4000-8000-000000000101', quantity: 2 }],
    });

    assert.deepEqual(fixture.state(), {
      reopened: true,
      restarted: false,
      cancelled: true,
      initiated: false,
      published: false,
    });
    assert.ok(fixture.invoiceUpdates.some((update) => update.status === 'partial_match'));
    assert.ok(!fixture.invoiceUpdates.some((update) => update.status === 'pending_approval'));
  });

  it('starts a fresh workflow for a materially edited rejected invoice', async () => {
    const fixture = createEditService('rejected');

    await fixture.service.update('invoice-1', '00000000-0000-4000-8000-000000000001', 'editor-1', {
      lines: [{ id: '00000000-0000-4000-8000-000000000101', quantity: 2 }],
    });

    assert.deepEqual(fixture.state(), {
      reopened: false,
      restarted: false,
      cancelled: false,
      initiated: true,
      published: true,
    });
    assert.ok(fixture.invoiceUpdates.some((update) => update.status === 'pending_approval'));
    assert.equal(fixture.workflowStartedFromStatus(), 'pending_approval');
  });

  it('falls back to manual reapproval when no workflow is configured', async () => {
    const fixture = createEditService('rejected', 'full_match', false, 'vendor-1', false);

    await fixture.service.update('invoice-1', '00000000-0000-4000-8000-000000000001', 'editor-1', {
      lines: [{ id: '00000000-0000-4000-8000-000000000101', quantity: 2 }],
    });

    assert.equal(fixture.state().initiated, true);
    assert.equal(fixture.state().published, false);
    assert.equal(fixture.invoiceUpdates.at(-1)?.status, 'matched');
  });

  it('starts reapproval when an edit restores a previously failed match', async () => {
    const fixture = createEditService('partial_match', 'full_match');

    await fixture.service.update('invoice-1', '00000000-0000-4000-8000-000000000001', 'editor-1', {
      lines: [{ id: '00000000-0000-4000-8000-000000000101', quantity: 2 }],
    });

    assert.equal(fixture.state().initiated, true);
    assert.equal(fixture.workflowStartedFromStatus(), 'pending_approval');
  });

  it('starts reapproval when a later rematch restores a full match', async () => {
    const fixture = createEditService('partial_match', 'full_match');

    await fixture.service.runMatch('invoice-1', '00000000-0000-4000-8000-000000000001', 'editor-1');

    assert.equal(fixture.state().initiated, true);
    assert.equal(fixture.workflowStartedFromStatus(), 'pending_approval');
    assert.equal(fixture.state().published, true);
  });

  it('reopens approval after a successful rematch of an approved or released invoice', async () => {
    for (const status of ['approved', 'ready_for_release'] as const) {
      const fixture = createEditService(status, 'full_match');

      await fixture.service.runMatch(
        'invoice-1',
        '00000000-0000-4000-8000-000000000001',
        'editor-1',
      );

      assert.deepEqual(fixture.state(), {
        reopened: true,
        restarted: false,
        cancelled: true,
        initiated: true,
        published: true,
      });
      assert.ok(fixture.invoiceUpdates.some((update) => update.status === 'pending_approval'));
      assert.ok(fixture.invoiceUpdates.some((update) => update.approvedBy === null));
      assert.ok(fixture.invoiceUpdates.some((update) => update.releasedBy === null));
      assert.equal(fixture.workflowStartedFromStatus(), 'pending_approval');
    }
  });

  it('does not revive a cancelled invoice through editing', async () => {
    const fixture = createEditService('cancelled');

    await assert.rejects(
      fixture.service.update('invoice-1', '00000000-0000-4000-8000-000000000001', 'editor-1', {
        lines: [{ id: '00000000-0000-4000-8000-000000000101', quantity: 2 }],
      }),
      /Cancelled invoices cannot be edited/,
    );
    assert.deepEqual(fixture.state(), {
      reopened: false,
      restarted: false,
      cancelled: false,
      initiated: false,
      published: false,
    });
  });

  it('rejects a vendor that does not match the linked purchase order', async () => {
    const fixture = createEditService();

    await assert.rejects(
      fixture.service.update('invoice-1', '00000000-0000-4000-8000-000000000001', 'editor-1', {
        vendorId: '00000000-0000-4000-8000-000000000202',
      }),
      /must match its purchase order vendor/,
    );
    assert.deepEqual(fixture.state(), {
      reopened: false,
      restarted: false,
      cancelled: false,
      initiated: false,
      published: false,
    });
  });

  it('rejects a vendor edit that would duplicate its invoice number', async () => {
    const vendorId = '00000000-0000-4000-8000-000000000202';
    const fixture = createEditService('approved', 'full_match', true, vendorId);

    await assert.rejects(
      fixture.service.update('invoice-1', '00000000-0000-4000-8000-000000000001', 'editor-1', {
        vendorId,
      }),
      /Duplicate invoice: VENDOR-100 already exists for this vendor/,
    );
  });

  it('rejects a PO line reference outside the linked purchase order', async () => {
    const fixture = createEditService();

    await assert.rejects(
      fixture.service.update('invoice-1', '00000000-0000-4000-8000-000000000001', 'editor-1', {
        lines: [
          {
            id: '00000000-0000-4000-8000-000000000101',
            poLineId: '00000000-0000-4000-8000-000000000302',
          },
        ],
      }),
      /must belong to the linked purchase order/,
    );
  });
});

describe('InvoicesService external payments', () => {
  function createPaymentService(
    status: 'approved' | 'ready_for_release' = 'ready_for_release',
    gate: {
      vendorStatus?: string;
      onboardingStatus?: string;
      sanctionsStatus?: string;
      accountUpdatedAt?: Date;
    } = {},
  ) {
    const updates: Array<Record<string, unknown>> = [];
    const auditEntries: Array<Record<string, unknown>> = [];
    const emittedEvents: Array<{ event: string; payload: unknown }> = [];
    const lockQueries: unknown[] = [];
    const approvedAt = new Date('2026-08-01T00:00:00.000Z');
    const invoice = {
      id: 'invoice-1',
      status,
      totalAmount: '125.00',
      vendorId: 'vendor-1',
      approvedAt,
    };
    const transaction = {
      execute: async (query: unknown) => {
        lockQueries.push(query);
        return [];
      },
      select() {
        let table: unknown;
        const query = {
          from(nextTable: unknown) {
            table = nextTable;
            return query;
          },
          innerJoin() {
            return query;
          },
          where() {
            return query;
          },
          for: async () => {
            if (table === invoices) {
              return [
                {
                  ...invoice,
                  vendorName: 'Acme Supplies',
                  vendorStatus: gate.vendorStatus ?? 'active',
                  onboardingStatus: gate.onboardingStatus ?? 'approved',
                  sanctionsStatus: gate.sanctionsStatus ?? 'clear',
                  paidAt: null,
                },
              ];
            }
            if (table === vendorPaymentAccounts) {
              return [
                {
                  verificationStatus: 'verified',
                  createdAt: new Date('2026-07-01T00:00:00.000Z'),
                  updatedAt: gate.accountUpdatedAt ?? new Date('2026-07-15T00:00:00.000Z'),
                },
              ];
            }
            return [];
          },
        };
        return query;
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return {
            where: () => ({
              returning: async () => [{ id: 'invoice-1' }],
            }),
          };
        },
      }),
    };
    const db = {
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as Db;
    const audit = {
      log: async (
        _organizationId: string,
        _userId: string | null,
        _entityType: string,
        _entityId: string,
        _action: string,
        details: Record<string, unknown>,
      ) => {
        auditEntries.push(details);
      },
    } as unknown as AuditService;
    const webhookEvents = {
      emit: (_organizationId: string, event: string, payload: unknown) => {
        emittedEvents.push({ event, payload });
      },
    } as unknown as WebhookEventService;
    const service = new InvoicesService(
      db,
      {} as SequenceService,
      {} as MatchingService,
      webhookEvents,
      {} as GlExportService,
      {} as BudgetsService,
      audit,
      {} as NotificationsService,
      {} as EntitiesService,
      {} as ExchangeRatesService,
      {} as SpendGuardService,
      {} as SettingsService,
      {} as WorkflowExecutionService,
    );
    (service as unknown as { findOne: () => Promise<typeof invoice> }).findOne = async () =>
      invoice;
    return { service, updates, auditEntries, emittedEvents, lockQueries };
  }

  it('requires an auditable external payment date, method, and reference', async () => {
    const { service } = createPaymentService();

    await assert.rejects(
      service.markPaid('invoice-1', '00000000-0000-4000-8000-000000000001', 'user-1', {
        paymentDate: '',
        paymentMethod: 'ach',
        paymentReference: '',
      }),
      /Payment date, method, and external reference are required/,
    );

    await assert.rejects(
      service.markPaid('invoice-1', '00000000-0000-4000-8000-000000000001', 'user-1', {
        paymentDate: '2026-02-30',
        paymentMethod: 'ach',
        paymentReference: 'ACH-123',
      }),
      /Payment date is invalid/,
    );

    await assert.rejects(
      service.markPaid('invoice-1', '00000000-0000-4000-8000-000000000001', 'user-1', {
        paymentDate: '2026-08-24',
        paymentMethod: 'ach',
        paymentReference: 123,
      } as unknown as { paymentDate: string; paymentMethod: string; paymentReference: string }),
      /Payment date, method, and external reference are required/,
    );
  });

  it('records external payment details in the invoice and audit trail', async () => {
    const { service, updates, auditEntries, emittedEvents, lockQueries } = createPaymentService();

    await service.markPaid('invoice-1', '00000000-0000-4000-8000-000000000001', 'user-1', {
      paymentDate: '2026-08-24',
      paymentMethod: 'wire',
      paymentReference: 'WIRE-123',
    });

    assert.equal(updates[0].status, 'paid');
    assert.equal((updates[0].paidAt as Date).toISOString(), '2026-08-24T12:00:00.000Z');
    assert.equal(updates[0].paymentReference, 'WIRE-123');
    assert.deepEqual(auditEntries[0], {
      totalAmount: '125.00',
      paymentDate: '2026-08-24',
      paymentMethod: 'wire',
      paymentReference: 'WIRE-123',
    });
    assert.equal(emittedEvents[0].event, 'invoice.paid');
    assert.equal(lockQueries.length, 1);
    assert.match(new PgDialect().sqlToQuery(lockQueries[0] as never).sql, /pg_advisory_xact_lock/);
  });

  it('does not let manual payment bypass the release transition', async () => {
    const { service } = createPaymentService('approved');

    await assert.rejects(
      service.markPaid('invoice-1', '00000000-0000-4000-8000-000000000001', 'user-1', {
        paymentDate: '2026-08-24',
        paymentMethod: 'wire',
        paymentReference: 'WIRE-123',
      }),
      /Only released invoices can be marked as paid/,
    );
  });

  it('rechecks vendor compliance and account timestamps before manual payment', async () => {
    const flagged = createPaymentService('ready_for_release', { sanctionsStatus: 'flagged' });
    await assert.rejects(
      flagged.service.markPaid('invoice-1', '00000000-0000-4000-8000-000000000001', 'user-1', {
        paymentDate: '2026-08-24',
        paymentMethod: 'wire',
        paymentReference: 'WIRE-123',
      }),
      /flagged by sanctions/,
    );

    const changed = createPaymentService('ready_for_release', {
      accountUpdatedAt: new Date('2026-08-02T00:00:00.000Z'),
    });
    await assert.rejects(
      changed.service.markPaid('invoice-1', '00000000-0000-4000-8000-000000000001', 'user-1', {
        paymentDate: '2026-08-24',
        paymentMethod: 'wire',
        paymentReference: 'WIRE-123',
      }),
      /changed after invoice approval/,
    );
  });
});
