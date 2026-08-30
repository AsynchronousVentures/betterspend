import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceReviewCases, invoiceReviewSignals, invoices, type Db } from '@betterspend/db';
import { InvoiceReviewsService } from './invoice-reviews.service';

const organizationId = '00000000-0000-4000-8000-000000000001';
const invoiceId = '00000000-0000-4000-8000-000000000002';

function createService() {
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
            createdAt: new Date('2026-07-31T00:00:00Z'),
            updatedAt: new Date('2026-08-02T00:00:00Z'),
            vendor: {
              id: '00000000-0000-4000-8000-000000000005',
              organizationId,
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
            purchaseOrder: null,
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
      approvalRequests: { findMany: async () => [] },
    },
  } as unknown as Db;

  return new InvoiceReviewsService(db);
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
  assert.equal(projection.provenance.available, false);
  assert.deepEqual(projection.provenance.fields, []);
});

test('queue returns bounded invoice summaries and a stable cursor', async () => {
  const openedAt = new Date('2026-08-01T00:00:00Z');
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
    query: {
      invoiceReviewSignals: {
        findMany: async () => [
          {
            caseId: rows[0].reviewCase.id,
            severity: 'blocking',
            status: 'open',
            firstSeenAt: openedAt,
          },
        ],
      },
    },
  } as unknown as Db;

  const result = await new InvoiceReviewsService(db).listCases(organizationId, { limit: 1 });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.invoice.internalNumber, 'INV-2026-0001');
  assert.equal(result.items[0]?.case.blockingSignalCount, 1);
  assert.equal(result.items[0]?.case.unresolvedSignalCount, 1);
  assert.ok(result.nextCursor);
});

test('recordSignal preserves one signal identity across repeated observations', async () => {
  const cases: Array<Record<string, unknown>> = [];
  const signals: Array<Record<string, unknown>> = [];
  let nextId = 20;
  const tx = {
    select: () => {
      let table: unknown;
      const builder = {
        from: (selectedTable: unknown) => {
          table = selectedTable;
          return builder;
        },
        where: () => builder,
        limit: async () => (table === invoices ? [{ id: invoiceId }] : []),
        for: async () => {
          if (table === invoiceReviewCases) return cases;
          if (table === invoiceReviewSignals) {
            return signals.map((signal) => ({
              severity: signal.severity,
              status: signal.status,
            }));
          }
          return [];
        },
        then: (resolve: (value: unknown) => unknown) =>
          resolve(
            table === invoiceReviewSignals
              ? signals.map((signal) => ({
                  severity: signal.severity,
                  status: signal.status,
                }))
              : [],
          ),
      };
      return builder;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
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
              Object.assign(existing, config.set, { id: existing.id });
              return [existing];
            }
            const signal = { ...values, id: `signal-${nextId++}` };
            signals.push(signal);
            return [signal];
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (table !== invoiceReviewCases) return [];
            const reviewCase = cases[0];
            if (!reviewCase) return [];
            Object.assign(reviewCase, values, {
              version: Number(reviewCase.version) + 1,
            });
            return [reviewCase];
          },
        }),
      }),
    }),
  };
  const db = {
    transaction: async <T>(callback: (executor: typeof tx) => Promise<T>) => callback(tx),
  } as unknown as Db;
  const service = new InvoiceReviewsService(db);
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

  assert.equal(cases.length, 1);
  assert.equal(signals.length, 1);
  assert.equal(first.signal.id, second.signal.id);
  assert.equal(signals[0]?.summary, 'Match remains outside tolerance');
  assert.deepEqual(signals[0]?.firstSeenAt, new Date('2026-08-01T00:00:00Z'));
  assert.deepEqual(signals[0]?.lastSeenAt, new Date('2026-08-02T00:00:00Z'));
  assert.equal(cases[0]?.state, 'open');
});
