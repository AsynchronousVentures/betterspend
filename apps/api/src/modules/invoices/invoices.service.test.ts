import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auditLog, invoiceLines, invoices, type Db, type DbTransaction } from '@betterspend/db';
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
import type { MatchingService } from './matching.service';
import { InvoicesService } from './invoices.service';

function createService(
  expenseInvoice: BudgetsService['expenseInvoice'] = async () => {},
  matchStatus = 'full_match',
  options: {
    createdBy?: string | null;
    makerCheckerEnabled?: boolean;
    submissionSource?: 'internal' | 'legacy' | 'vendor_portal';
    blockedAuditFails?: boolean;
  } = {},
) {
  const auditActions: string[] = [];
  const approved = {
    id: 'invoice-1',
    organizationId: 'organization-1',
    purchaseOrderId: 'po-1',
    status: 'approved',
    matchStatus,
    totalAmount: '125.00',
    baseTotalAmount: '250.00',
    exchangeRate: '2',
    internalNumber: 'INV-2026-0001',
    createdBy: options.createdBy === undefined ? 'maker-1' : options.createdBy,
    submissionSource: options.submissionSource ?? 'internal',
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
    insert(table: unknown) {
      return {
        values: async (values: { action?: string }) => {
          if (table !== auditLog) return;
          if (options.blockedAuditFails) throw new Error('audit write failed');
          if (values.action) auditActions.push(values.action);
        },
      };
    },
  };
  const db = {
    transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
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

describe('InvoicesService approval budget accounting', () => {
  it('propagates budget accounting failures from the invoice approval transaction', async () => {
    let receivedTransaction: DbTransaction | undefined;
    let receivedAmounts: { expense: string; release: string } | undefined;
    const { service, transaction } = createService(
      async (executor, organizationId, invoiceId, expense, release) => {
        assert.equal(organizationId, 'organization-1');
        assert.equal(invoiceId, 'invoice-1');
        receivedAmounts = { expense, release };
        receivedTransaction = executor;
        throw new Error('budget update failed');
      },
    );

    await assert.rejects(
      service.approve('invoice-1', 'organization-1', 'approver-1'),
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
      service.approve('invoice-1', 'organization-1', 'approver-1'),
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

    await service.approve('invoice-1', 'organization-1', 'approver-1');

    assert.deepEqual(expensed, {
      executor: transaction,
      organizationId: 'organization-1',
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
      },
      'full_match',
      { createdBy: 'maker-1', makerCheckerEnabled: false },
    );

    await service.approve('invoice-1', 'organization-1', 'maker-1');

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
      service.approve('invoice-1', 'organization-1', 'approver-1'),
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

    await service.approve('invoice-1', 'organization-1', 'approver-1');

    assert.equal(spendRecorded, true);
  });

  it('propagates blocked-approval audit failures', async () => {
    const { service } = createService(async () => {}, 'full_match', {
      createdBy: 'maker-1',
      blockedAuditFails: true,
    });

    await assert.rejects(
      service.approve('invoice-1', 'organization-1', 'maker-1'),
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
      organizationId: 'organization-1',
      invoiceNumber: 'VENDOR-100',
      totalAmount: '100.00',
      matchStatus: 'unmatched',
    };
    const transaction = {
      insert(table: unknown) {
        return {
          values(values: unknown) {
            inserted.push({ table, values });
            return table === invoices
              ? { returning: async () => [{ id: 'invoice-1' }] }
              : Promise.resolve();
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

    await service.create('organization-1', 'maker-1', {
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
    assert.deepEqual(auditInsert?.values, {
      organizationId: 'organization-1',
      userId: 'maker-1',
      entityType: 'invoice',
      entityId: 'invoice-1',
      action: 'created',
      changes: { invoiceNumber: 'VENDOR-100', totalAmount: '100.00' },
    });
  });
});

describe('InvoicesService material edits', () => {
  const createEditService = (
    status:
      | 'approved'
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
      organizationId: 'organization-1',
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
      approvedBy: status === 'approved' ? 'approver-1' : null,
      approvedAt: status === 'approved' ? new Date('2026-08-10T00:00:00Z') : null,
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
      select() {
        return {
          from() {
            return { where: () => ({ for: async () => [invoice] }) };
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
        return { values: async () => undefined };
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

    await fixture.service.update('invoice-1', 'organization-1', 'editor-1', {
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

    await fixture.service.update('invoice-1', 'organization-1', 'editor-1', {
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

    await fixture.service.update('invoice-1', 'organization-1', 'editor-1', {
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

    await fixture.service.update('invoice-1', 'organization-1', 'editor-1', {
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

    await fixture.service.update('invoice-1', 'organization-1', 'editor-1', {
      lines: [{ id: '00000000-0000-4000-8000-000000000101', quantity: 2 }],
    });

    assert.equal(fixture.state().initiated, true);
    assert.equal(fixture.state().published, false);
    assert.equal(fixture.invoiceUpdates.at(-1)?.status, 'matched');
  });

  it('starts reapproval when an edit restores a previously failed match', async () => {
    const fixture = createEditService('partial_match', 'full_match');

    await fixture.service.update('invoice-1', 'organization-1', 'editor-1', {
      lines: [{ id: '00000000-0000-4000-8000-000000000101', quantity: 2 }],
    });

    assert.equal(fixture.state().initiated, true);
    assert.equal(fixture.workflowStartedFromStatus(), 'pending_approval');
  });

  it('starts reapproval when a later rematch restores a full match', async () => {
    const fixture = createEditService('partial_match', 'full_match');

    await fixture.service.runMatch('invoice-1', 'organization-1', 'editor-1');

    assert.equal(fixture.state().initiated, true);
    assert.equal(fixture.workflowStartedFromStatus(), 'pending_approval');
    assert.equal(fixture.state().published, true);
  });

  it('does not revive a cancelled invoice through editing', async () => {
    const fixture = createEditService('cancelled');

    await assert.rejects(
      fixture.service.update('invoice-1', 'organization-1', 'editor-1', {
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
      fixture.service.update('invoice-1', 'organization-1', 'editor-1', {
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
      fixture.service.update('invoice-1', 'organization-1', 'editor-1', { vendorId }),
      /Duplicate invoice: VENDOR-100 already exists for this vendor/,
    );
  });

  it('rejects a PO line reference outside the linked purchase order', async () => {
    const fixture = createEditService();

    await assert.rejects(
      fixture.service.update('invoice-1', 'organization-1', 'editor-1', {
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
