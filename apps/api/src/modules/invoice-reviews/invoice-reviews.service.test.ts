import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditIdempotencyKeys,
  auditLog,
  invoiceReviewCases,
  invoiceReviewSignals,
  invoices,
  type Db,
} from '@betterspend/db';
import type { AccessPolicy } from '../auth/access-policy';
import type { PermissionKey } from '@betterspend/shared';
import { InvoiceReviewProvenanceService } from './invoice-review-provenance.service';
import { InvoiceReviewsService } from './invoice-reviews.service';

const organizationId = '00000000-0000-4000-8000-000000000001';
const invoiceId = '00000000-0000-4000-8000-000000000002';
const entityId = '00000000-0000-4000-8000-000000000004';
const vendorId = '00000000-0000-4000-8000-000000000005';
const purchaseOrderId = '00000000-0000-4000-8000-000000000017';
const requisitionId = '00000000-0000-4000-8000-000000000018';
const requesterId = '00000000-0000-4000-8000-000000000019';

function accessFor(granted: readonly PermissionKey[]): AccessPolicy {
  const permissions = new Set(granted);
  return {
    can: (permission) => permissions.has(permission),
    scopeFor: (_resource, permission) => ({
      organizationId,
      userId: requesterId,
      unrestricted: permissions.has(permission),
      ownOnly: false,
      departmentIds: [],
      projectIds: [],
      entityIds: [],
    }),
    isGlobalBuiltInAdmin: () => false,
    toDocument: () => ({ permissions: [...permissions], scopes: {} }),
  };
}

function createReviewService(db: Db) {
  return new InvoiceReviewsService(db, new InvoiceReviewProvenanceService(db));
}

function createService(omitProvenanceRelation = false) {
  const db = {
    query: {
      invoiceReviewCases: {
        findFirst: async () => ({
          id: '00000000-0000-4000-8000-000000000003',
          organizationId,
          invoiceId,
          state: 'open',
          ownerId: null,
          version: 1,
          openedAt: new Date('2026-08-01T00:00:00Z'),
          resolvedAt: null,
          createdAt: new Date('2026-08-01T00:00:00Z'),
          updatedAt: new Date('2026-08-02T00:00:00Z'),
          owner: null,
          invoice: {
            id: invoiceId,
            internalNumber: 'INV-2026-0001',
            invoiceNumber: 'SUP-42',
            status: 'approved',
            invoiceDate: new Date('2026-07-31T00:00:00Z'),
            dueDate: new Date('2026-08-30T00:00:00Z'),
            subtotal: '100.00',
            taxAmount: '8.00',
            totalAmount: '108.00',
            currency: 'USD',
            baseCurrency: 'USD',
            baseTotalAmount: '108.00',
            entityId: '00000000-0000-4000-8000-000000000004',
            purchaseOrderId: null,
            vendorId: '00000000-0000-4000-8000-000000000005',
            matchStatus: 'exception',
            matchDetails: { reason: 'quantity variance' },
            documentId: '00000000-0000-4000-8000-000000000006',
            createdBy: requesterId,
            createdAt: new Date('2026-07-31T00:00:00Z'),
            updatedAt: new Date('2026-08-02T00:00:00Z'),
            vendor: {
              id: '00000000-0000-4000-8000-000000000005',
              organizationId,
              entityId,
              name: 'Acme Supplies',
              code: 'ACME',
              status: 'active',
            },
            entity: {
              id: '00000000-0000-4000-8000-000000000004',
              organizationId,
              name: 'Acme Holdings',
              code: 'ACME-HQ',
              currency: 'USD',
            },
            purchaseOrder: {
              id: purchaseOrderId,
              organizationId,
              issuedBy: requesterId,
              number: 'PO-2026-0001',
              status: 'issued',
              entityId,
              vendorId,
              requisition: {
                id: requisitionId,
                organizationId,
                number: 'REQ-2026-0001',
                status: 'approved',
                requesterId,
                departmentId: '00000000-0000-4000-8000-000000000020',
                projectId: null,
              },
            },
            lines: [
              {
                id: '00000000-0000-4000-8000-000000000007',
                lineNumber: '1',
                description: 'Widgets',
                quantity: '2.00',
                unitPrice: '50.00',
                taxAmount: '8.00',
                totalPrice: '108.00',
                matchResults: [
                  {
                    id: '00000000-0000-4000-8000-000000000008',
                    status: 'exception',
                    priceMatch: true,
                    quantityMatch: false,
                    priceVariance: '0',
                    quantityVariance: '1',
                    variancePct: '50',
                  },
                ],
              },
            ],
            ...(omitProvenanceRelation ? {} : { fieldProvenance: [] }),
            paymentRunInvoices: [
              {
                id: '00000000-0000-4000-8000-000000000009',
                paymentRunId: '00000000-0000-4000-8000-000000000010',
                amount: '108.00',
                currency: 'USD',
                status: 'scheduled',
                paymentReference: null,
                paymentRun: {
                  id: '00000000-0000-4000-8000-000000000010',
                  orgId: organizationId,
                  status: 'draft',
                  entityId: '00000000-0000-4000-8000-000000000004',
                  runDate: '2026-08-30',
                },
              },
            ],
          },
          signals: [
            {
              id: '00000000-0000-4000-8000-000000000011',
              signalType: 'match_exception',
              sourceModule: 'matching',
              sourceRecordId: invoiceId,
              severity: 'blocking',
              status: 'open',
              summary: 'Invoice has an active match exception.',
              details: { reason: 'quantity variance' },
              firstSeenAt: new Date('2026-08-01T00:00:00Z'),
              lastSeenAt: new Date('2026-08-02T00:00:00Z'),
              resolutionActorId: null,
              resolutionCommand: null,
              resolutionReason: null,
              resolvedAt: null,
            },
            {
              id: '00000000-0000-4000-8000-000000000012',
              signalType: 'duplicate_risk',
              sourceModule: 'spend_guard',
              sourceRecordId: '00000000-0000-4000-8000-000000000013',
              severity: 'review_required',
              status: 'open',
              summary: 'Invoice has an active spend-risk alert.',
              details: {},
              firstSeenAt: new Date('2026-08-01T00:00:00Z'),
              lastSeenAt: new Date('2026-08-01T00:00:00Z'),
              resolutionActorId: null,
              resolutionCommand: null,
              resolutionReason: null,
              resolvedAt: null,
            },
          ],
        }),
      },
      spendGuardAlerts: { findMany: async () => [] },
      ocrJobs: { findMany: async () => [] },
      emailIntakeMessages: { findMany: async () => [] },
      emailIntakeItems: { findMany: async () => [] },
      documents: {
        findMany: async () => [
          {
            id: '00000000-0000-4000-8000-000000000006',
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1024,
            entityType: 'invoice',
            entityId: invoiceId,
            createdAt: new Date('2026-07-31T00:00:00Z'),
          },
        ],
      },
      messages: { findMany: async () => [] },
      approvalRequests: {
        findMany: async () => [
          {
            id: '00000000-0000-4000-8000-000000000021',
            status: 'pending',
            currentStep: 1,
            currentNodeId: null,
            createdAt: new Date('2026-08-01T00:00:00Z'),
            updatedAt: new Date('2026-08-02T00:00:00Z'),
          },
        ],
      },
    },
  } as unknown as Db;

  return createReviewService(db);
}

test('projection returns stable invoice summaries and explicit missing source markers', async () => {
  const projection = await createService().getProjection(invoiceId, organizationId);

  assert.equal(projection.case.state, 'open');
  assert.deepEqual(projection.invoice.vendor, {
    id: '00000000-0000-4000-8000-000000000005',
    name: 'Acme Supplies',
    code: 'ACME',
    status: 'active',
  });
  assert.deepEqual(projection.match, {
    status: 'exception',
    details: { reason: 'quantity variance' },
    exceptions: [
      {
        id: '00000000-0000-4000-8000-000000000008',
        status: 'exception',
        priceMatch: true,
        quantityMatch: false,
        priceVariance: '0',
        quantityVariance: '1',
        variancePct: '50',
      },
    ],
  });
  assert.equal(projection.signals[0]?.source.availability, 'present');
  assert.equal(projection.signals[1]?.source.availability, 'missing');
  assert.equal(projection.documents[0]?.filename, 'invoice.pdf');
  assert.equal('storageKey' in (projection.documents[0] ?? {}), false);
  assert.equal(projection.provenance.available, true);
  assert.deepEqual(projection.provenance.fields, []);
});

test('projection fails explicitly when the provenance relation is unavailable', async () => {
  await assert.rejects(
    createService(true).getProjection(invoiceId, organizationId),
    /Invoice provenance relation is unavailable/,
  );
});

test('projection redacts related records without their own permissions', async () => {
  const projection = await createService().getProjection(
    invoiceId,
    organizationId,
    accessFor(['invoices:view_all']),
  );

  assert.equal(projection.invoice.vendor, null);
  assert.equal(projection.invoice.purchaseOrder, null);
  assert.deepEqual(projection.approvals, []);
  assert.deepEqual(projection.payments, []);
});

test('projection keeps the purchase order while independently redacting its requisition', async () => {
  const projection = await createService().getProjection(
    invoiceId,
    organizationId,
    accessFor(['invoices:view_all', 'purchase_orders:view_all']),
  );

  assert.equal(projection.invoice.purchaseOrder?.id, purchaseOrderId);
  assert.equal(projection.invoice.purchaseOrder?.requisition, null);
});

test('queue returns bounded invoice summaries and a stable cursor', async () => {
  const openedAt = new Date('2026-08-01T00:00:00Z');
  const oldestSignalSortKey = '2026-08-01T00:00:00.123456Z';
  const rows = [
    {
      reviewCase: {
        id: '00000000-0000-4000-8000-000000000003',
        organizationId,
        invoiceId,
        state: 'open',
        ownerId: null,
        version: 1,
        openedAt,
        resolvedAt: null,
        createdAt: openedAt,
        updatedAt: openedAt,
      },
      invoice: {
        id: invoiceId,
        organizationId,
        vendorId: '00000000-0000-4000-8000-000000000005',
        entityId: null,
        internalNumber: 'INV-2026-0001',
        invoiceNumber: 'SUP-42',
        status: 'approved',
        dueDate: new Date('2026-08-30T00:00:00Z'),
        totalAmount: '108.00',
        currency: 'USD',
      },
      vendor: {
        id: '00000000-0000-4000-8000-000000000005',
        organizationId,
        name: 'Acme Supplies',
        code: 'ACME',
        status: 'active',
      },
      entity: null,
      oldestUnresolvedSignalAt: oldestSignalSortKey,
      unresolvedSignalCount: 2,
      blockingSignalCount: 1,
    },
    {
      reviewCase: {
        id: '00000000-0000-4000-8000-000000000014',
        organizationId,
        invoiceId: '00000000-0000-4000-8000-000000000015',
        state: 'open',
        ownerId: null,
        version: 1,
        openedAt: new Date('2026-08-02T00:00:00Z'),
        resolvedAt: null,
        createdAt: new Date('2026-08-02T00:00:00Z'),
        updatedAt: new Date('2026-08-02T00:00:00Z'),
      },
      invoice: {
        id: '00000000-0000-4000-8000-000000000015',
        organizationId,
        vendorId: '00000000-0000-4000-8000-000000000005',
        entityId: null,
        internalNumber: 'INV-2026-0002',
        invoiceNumber: 'SUP-43',
        status: 'approved',
        dueDate: new Date('2026-09-01T00:00:00Z'),
        totalAmount: '12.00',
        currency: 'USD',
      },
      vendor: {
        id: '00000000-0000-4000-8000-000000000005',
        organizationId,
        name: 'Acme Supplies',
        code: 'ACME',
        status: 'active',
      },
      entity: null,
      oldestUnresolvedSignalAt: '2026-08-02T00:00:00.654321Z',
      unresolvedSignalCount: 1,
      blockingSignalCount: 1,
    },
  ];
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: async () => rows,
  };
  const db = {
    select: () => builder,
  } as unknown as Db;

  const result = await createReviewService(db).listCases(
    organizationId,
    { limit: 1 },
    accessFor(['invoices:view_all']),
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.invoice.internalNumber, 'INV-2026-0001');
  assert.equal(result.items[0]?.case.blockingSignalCount, 1);
  assert.equal(result.items[0]?.case.unresolvedSignalCount, 2);
  assert.equal(result.items[0]?.invoice.vendor, null);
  assert.deepEqual(
    result.items[0]?.case.oldestUnresolvedSignalAt,
    new Date('2026-08-01T00:00:00.123Z'),
  );
  assert.ok(result.nextCursor);
  const cursor = JSON.parse(Buffer.from(result.nextCursor, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  assert.equal(cursor.value, oldestSignalSortKey);
});

test('queue rejects a cursor whose case id is not a UUID before querying', async () => {
  const cursor = Buffer.from(
    JSON.stringify({ sort: 'oldest_signal', value: null, id: 'not-a-uuid' }),
    'utf8',
  ).toString('base64url');
  const db = {
    select: () => {
      throw new Error('invalid cursors must not reach the database');
    },
  } as unknown as Db;

  await assert.rejects(
    createReviewService(db).listCases(organizationId, { cursor }),
    /cursor is invalid/,
  );
});

test('recordSignal preserves one signal identity across repeated observations', async () => {
  const cases: Array<Record<string, unknown>> = [];
  const signals: Array<Record<string, unknown>> = [];
  const auditClaims: Array<Record<string, unknown>> = [];
  const auditRows: Array<Record<string, unknown>> = [];
  let auditClaimLookups = 0;
  let failAudit = false;
  let nextId = 20;
  const tx = {
    execute: async () => {
      if (failAudit) throw new Error('audit write failed');
      return [
        {
          changesJson: '{}',
          metadataJson: '{}',
          createdAtText: '2026-08-01T00:00:00.000000Z',
        },
      ];
    },
    select: () => {
      let table: unknown;
      const builder = {
        from: (selectedTable: unknown) => {
          table = selectedTable;
          return builder;
        },
        where: () => builder,
        limit: () => builder,
        for: async () => {
          if (table === invoices) return [{ id: invoiceId, status: 'pending', paidAt: null }];
          if (table === invoiceReviewCases) return cases;
          if (table === invoiceReviewSignals) {
            return signals;
          }
          return [];
        },
        orderBy: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          resolve(
            table === invoices
              ? [{ id: invoiceId, status: 'pending', paidAt: null }]
              : table === invoiceReviewSignals
              ? signals.map((signal) => ({
                  severity: signal.severity,
                  status: signal.status,
                }))
              : table === auditIdempotencyKeys
                ? (() => {
                    auditClaimLookups += 1;
                    return auditClaimLookups === 3 ? [auditClaims[1]] : [];
                  })()
              : table === auditLog
                ? auditRows
                : [],
          ),
      };
      return builder;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === auditIdempotencyKeys) {
          auditClaims.push(values);
          return {};
        }
        if (table === auditLog) {
          return {
            returning: async () => {
              const row = {
                ...values,
                entryHash: `hash-${String(values.id)}`,
              };
              auditRows.push(row);
              return [row];
            },
          };
        }
        if (table === invoiceReviewSignals) {
          return {
            returning: async () => {
              const signal = { ...values, id: `signal-${nextId++}` };
              signals.push(signal);
              return [signal];
            },
          };
        }
        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              if (table !== invoiceReviewCases || cases.length > 0) return [];
              const reviewCase = {
                id: '00000000-0000-4000-8000-000000000016',
                organizationId: values.organizationId,
                invoiceId: values.invoiceId,
                state: values.state,
                ownerId: null,
                version: 1,
                openedAt: values.openedAt,
                resolvedAt: null,
                createdAt: values.createdAt,
                updatedAt: values.updatedAt,
              };
              cases.push(reviewCase);
              return [reviewCase];
            },
          }),
          onConflictDoUpdate: (config: { set: Record<string, unknown> }) => ({
            returning: async () => {
              const existing = signals.find(
                (signal) =>
                  signal.caseId === values.caseId &&
                  signal.signalType === values.signalType &&
                  signal.sourceModule === values.sourceModule &&
                  signal.sourceRecordId === values.sourceRecordId,
              );
              if (existing) {
                if (
                  existing.lastSeenAt instanceof Date &&
                  config.set.lastSeenAt instanceof Date &&
                  existing.lastSeenAt > config.set.lastSeenAt
                ) {
                  return [];
                }
                Object.assign(existing, config.set, { id: existing.id });
                return [existing];
              }
              const signal = { ...values, id: `signal-${nextId++}` };
              signals.push(signal);
              return [signal];
            },
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === auditIdempotencyKeys) {
            Object.assign(auditClaims.at(-1) ?? {}, values);
            return undefined;
          }
          if (table === invoiceReviewSignals) {
            return {
              returning: async () => {
                const signal = signals[0];
                if (!signal) return [];
                Object.assign(signal, values);
                return [signal];
              },
            };
          }
          return {
            returning: async () => {
              if (table !== invoiceReviewCases) return [];
              const reviewCase = cases[0];
              if (!reviewCase) return [];
              Object.assign(reviewCase, values, {
                version: Number(reviewCase.version) + 1,
              });
              return [reviewCase];
            },
          };
        },
      }),
    }),
  };
  const db = {
    transaction: async <T>(callback: (executor: typeof tx) => Promise<T>) => {
      const casesSnapshot = cases.map((reviewCase) => ({ ...reviewCase }));
      const signalsSnapshot = signals.map((signal) => ({ ...signal }));
      const auditClaimsSnapshot = auditClaims.map((claim) => ({ ...claim }));
      const auditRowsSnapshot = auditRows.map((row) => ({ ...row }));
      try {
        return await callback(tx);
      } catch (error) {
        cases.splice(0, cases.length, ...casesSnapshot);
        signals.splice(0, signals.length, ...signalsSnapshot);
        auditClaims.splice(0, auditClaims.length, ...auditClaimsSnapshot);
        auditRows.splice(0, auditRows.length, ...auditRowsSnapshot);
        throw error;
      }
    },
  } as unknown as Db;
  const service = createReviewService(db);
  const input = {
    organizationId,
    invoiceId,
    signalType: 'match_exception' as const,
    sourceModule: 'matching',
    sourceRecordId: invoiceId,
    severity: 'blocking' as const,
    summary: 'Match is outside tolerance',
    observedAt: new Date('2026-08-01T00:00:00Z'),
  };

  const first = await service.recordSignal(input);
  const second = await service.recordSignal({
    ...input,
    summary: 'Match remains outside tolerance',
    observedAt: new Date('2026-08-02T00:00:00Z'),
  });
  const retry = await service.recordSignal({
    ...input,
    summary: 'Match remains outside tolerance',
    observedAt: new Date('2026-08-02T00:00:00Z'),
  });
  const staleResolved = await service.recordSignal({
    ...input,
    status: 'resolved',
    observedAt: new Date('2026-08-01T12:00:00Z'),
  });

  assert.equal(cases.length, 1);
  assert.equal(signals.length, 1);
  assert.equal(first.signal.id, second.signal.id);
  assert.equal(second.signal.id, retry.signal.id);
  assert.equal(retry.signal.id, staleResolved.signal.id);
  assert.equal(signals[0]?.summary, 'Match remains outside tolerance');
  assert.deepEqual(signals[0]?.firstSeenAt, new Date('2026-08-01T00:00:00Z'));
  assert.deepEqual(signals[0]?.lastSeenAt, new Date('2026-08-02T00:00:00Z'));
  assert.equal(cases[0]?.state, 'open');
  assert.equal(auditRows.length, 2);
  assert.equal(auditClaims.length, 2);
  assert.equal(auditRows[0]?.action, 'review_signal_recorded');
  assert.equal(auditRows[0]?.entityType, 'invoice_review_case');

  await service.recordSignal({
    ...input,
    status: 'resolved',
    observedAt: new Date('2026-08-03T00:00:00Z'),
  });
  const resolvedAt = cases[0]?.resolvedAt;
  await service.recordSignal({
    ...input,
    status: 'resolved',
    observedAt: new Date('2026-08-03T12:00:00Z'),
  });
  await service.recordSignal({
    ...input,
    status: 'open',
    observedAt: new Date('2026-08-02T12:00:00Z'),
  });

  assert.equal(signals[0]?.status, 'resolved');
  assert.deepEqual(signals[0]?.lastSeenAt, new Date('2026-08-03T12:00:00Z'));
  assert.equal(cases[0]?.state, 'resolved');
  assert.deepEqual(cases[0]?.resolvedAt, resolvedAt);
  assert.equal(auditRows.length, 4);
  assert.equal(auditClaims.length, 4);

  failAudit = true;
  await assert.rejects(
    service.recordSignal({
      ...input,
      sourceRecordId: '00000000-0000-4000-8000-000000000022',
      observedAt: new Date('2026-08-04T00:00:00Z'),
    }),
    /audit write failed/,
  );
  assert.equal(signals.length, 1);
  assert.equal(cases.length, 1);
  assert.equal(auditRows.length, 4);
  assert.equal(auditClaims.length, 4);
});
