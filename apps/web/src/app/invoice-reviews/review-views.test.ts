import assert from 'node:assert/strict';
import test from 'node:test';
import '../../test-dom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { InvoiceReviewListResult, InvoiceReviewProjection } from '../../lib/api-contracts';
import { InvoiceReviewDetail, InvoiceReviewQueue } from './review-views';

Object.defineProperty(globalThis, 'self', { configurable: true, value: window });
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

const queueResult: InvoiceReviewListResult = {
  items: [
    {
      case: {
        id: 'case-1',
        invoiceId: 'invoice-1',
        state: 'in_review',
        ownerId: 'owner-1',
        version: 3,
        openedAt: '2026-08-01T00:00:00.000Z',
        resolvedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
        ageDays: 30,
        unresolvedSignalCount: 3,
        blockingSignalCount: 2,
        oldestUnresolvedSignalAt: '2026-08-01T00:00:00.000Z',
      },
      invoice: {
        id: 'invoice-1',
        internalNumber: 'INV-2026-0012',
        invoiceNumber: 'SUP-7788',
        status: 'exception',
        dueDate: '2026-08-15',
        totalAmount: '1250.00',
        currency: 'USD',
        vendor: { id: 'vendor-1', name: 'Northwind Parts', code: 'NW', status: 'active' },
        entity: { id: 'entity-1', name: 'US Operations', code: 'US', currency: 'USD' },
      },
    },
  ],
  nextCursor: 'opaque-next-cursor',
};

test('queue shows review facts and carries active filters into stable pagination', () => {
  const html = renderToStaticMarkup(
    React.createElement(InvoiceReviewQueue, {
      result: queueResult,
      query: {
        state: 'in_review',
        severity: 'blocking',
        ownerId: 'owner-1',
        vendorId: 'vendor-1',
        entityId: 'entity-1',
        minAgeDays: 14,
        sort: 'due_date',
      },
      owners: [{ id: 'owner-1', name: 'Ada Reviewer' }],
      vendors: [{ id: 'vendor-1', name: 'Northwind Parts' }],
      entities: [{ id: 'entity-1', name: 'US Operations' }],
    }),
  );

  for (const value of [
    'SUP-7788',
    'Northwind Parts',
    '$1,250.00',
    '8/15/2026',
    '2 blocking',
    'Ada Reviewer',
    '30 days',
  ]) {
    assert.match(html, new RegExp(value.replace('$', '\\$')));
  }
  assert.match(
    html,
    /href="\/invoice-reviews\?state=in_review&amp;severity=blocking&amp;ownerId=owner-1&amp;vendorId=vendor-1&amp;entityId=entity-1&amp;minAgeDays=14&amp;sort=due_date&amp;cursor=opaque-next-cursor"/,
  );
  assert.match(html, /href="\/invoice-reviews\/invoice-1"/);
});

test('queue keeps owner filtering and ownership visible when user lookup is unavailable', () => {
  const html = renderToStaticMarkup(
    React.createElement(InvoiceReviewQueue, {
      result: queueResult,
      query: { ownerId: 'owner-1' },
      owners: [],
      vendors: [],
      entities: [],
    }),
  );

  assert.match(html, /name="ownerId"/);
  assert.match(html, /value="owner-1"/);
  assert.match(html, />owner-1</);
});

const projection: InvoiceReviewProjection = {
  case: {
    id: 'case-1',
    invoiceId: 'invoice-1',
    state: 'in_review',
    ownerId: 'owner-1',
    version: 3,
    openedAt: '2026-08-01T00:00:00.000Z',
    resolvedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    owner: { id: 'owner-1', name: 'Ada Reviewer', email: 'ada@example.com' },
  },
  invoice: {
    id: 'invoice-1',
    internalNumber: 'INV-2026-0012',
    invoiceNumber: 'SUP-7788',
    status: 'exception',
    invoiceDate: '2026-08-01',
    dueDate: '2026-08-15',
    subtotal: '1200.00',
    taxAmount: '50.00',
    totalAmount: '1250.00',
    currency: 'USD',
    baseCurrency: 'USD',
    baseTotalAmount: '1250.00',
    documentId: 'document-1',
    vendor: { id: 'vendor-1', name: 'Northwind Parts', code: 'NW', status: 'active' },
    entity: { id: 'entity-1', name: 'US Operations', code: 'US', currency: 'USD' },
    purchaseOrder: {
      id: 'po-1',
      number: 'PO-2026-0042',
      status: 'issued',
      entityId: 'entity-1',
      vendorId: 'vendor-1',
      requisition: {
        id: 'req-1',
        number: 'REQ-2026-0010',
        status: 'approved',
        requesterId: 'user-2',
        departmentId: null,
        projectId: null,
      },
    },
    lines: [
      {
        id: 'line-1',
        lineNumber: '1',
        description: 'Replacement parts',
        quantity: '10',
        unitPrice: '120.00',
        taxAmount: '50.00',
        totalPrice: '1250.00',
        matchResults: [
          {
            id: 'match-1',
            status: 'exception',
            priceMatch: false,
            quantityMatch: true,
            priceVariance: '50.00',
            quantityVariance: '0',
            variancePct: '4.17',
          },
        ],
      },
    ],
  },
  signals: [
    {
      id: 'signal-1',
      type: 'duplicate_risk',
      severity: 'blocking',
      status: 'open',
      summary: 'Possible duplicate invoice',
      details: { invoiceId: 'invoice-old' },
      source: { module: 'spend_guard', recordId: 'alert-missing', availability: 'missing' },
      firstSeenAt: '2026-08-01T00:00:00.000Z',
      lastSeenAt: '2026-08-02T00:00:00.000Z',
      resolution: { actorId: null, command: null, reason: null, resolvedAt: null },
    },
  ],
  documents: [
    {
      id: 'document-1',
      filename: 'northwind-invoice.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      entityType: 'invoice',
      entityId: 'invoice-1',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ],
  messages: [
    {
      id: 'message-1',
      senderType: 'vendor',
      authorName: 'Northwind AP',
      body: 'Attached is the corrected invoice.',
      attachments: [],
      createdAt: '2026-08-02T00:00:00.000Z',
    },
  ],
  match: {
    status: 'exception',
    details: { reason: 'price variance' },
    exceptions: [
      {
        id: 'match-1',
        status: 'exception',
        priceMatch: false,
        quantityMatch: true,
        priceVariance: '50.00',
        quantityVariance: '0',
        variancePct: '4.17',
      },
    ],
  },
  approvals: [
    {
      id: 'approval-1',
      status: 'pending',
      currentStep: 2,
      currentNodeId: 'finance',
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    },
  ],
  payments: [
    {
      id: 'payment-1',
      paymentRunId: 'run-1',
      amount: '1250.00',
      currency: 'USD',
      status: 'pending',
      paymentReference: null,
      paymentRun: { id: 'run-1', status: 'draft', entityId: 'entity-1', runDate: '2026-08-20' },
    },
  ],
  provenance: {
    available: true,
    fields: [
      {
        id: 'provenance-1',
        invoiceLineId: null,
        fieldPath: 'totalAmount',
        sourceType: 'OCR',
        sourceRecordId: 'ocr-missing',
        source: { type: 'OCR', recordId: 'ocr-missing', availability: 'missing' },
        sourceTimestamp: '2026-08-01T00:00:00.000Z',
        confidence: 0.42,
        actorId: null,
        isCurrent: true,
        supersededAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  },
  history: {
    available: true,
    entries: [
      {
        id: '00000000-0000-4000-8000-000000000020',
        action: 'invoice_review.claim',
        target: { type: 'case', id: 'case-1' },
        actor: { id: 'owner-1', name: 'Ada Reviewer' },
        timestamp: '2026-08-03T00:00:00.000Z',
      },
    ],
  },
};

test('detail composes the review projection and makes missing blocking sources explicit', () => {
  const html = renderToStaticMarkup(
    React.createElement(InvoiceReviewDetail, {
      projection,
      assignees: [{ id: 'owner-1', name: 'Ada Reviewer' }],
      onCommand: async () => undefined,
    }),
  );

  for (const value of [
    'SUP-7788',
    'Northwind Parts',
    'Ada Reviewer',
    'Possible duplicate invoice',
    'Blocking',
    'Source missing',
    'spend_guard',
    'alert-missing',
    'northwind-invoice.pdf',
    'Original document',
    'totalAmount',
    'OCR',
    '42%',
    'Attached is the corrected invoice.',
    'price variance',
    'Step 2',
    'run-1',
    'Claim',
    'Ada Reviewer',
    'case-1',
  ])
    assert.match(html, new RegExp(value));

  assert.match(html, /href="\/invoices\/invoice-1"/);
  assert.match(html, /Resolve signal/);
  assert.match(html, /Waive signal/);
});

test('detail shows an explicit empty state when case history has no events', () => {
  const html = renderToStaticMarkup(
    React.createElement(InvoiceReviewDetail, {
      projection: { ...projection, history: { available: true, entries: [] } },
      assignees: [],
      onCommand: async () => undefined,
    }),
  );

  assert.match(html, /No case history events/);
});

test('paid and cancelled review cases are visibly read-only', () => {
  for (const status of ['paid', 'cancelled']) {
    const html = renderToStaticMarkup(
      React.createElement(InvoiceReviewDetail, {
        projection: { ...projection, invoice: { ...projection.invoice, status } },
        assignees: [],
        onCommand: async () => undefined,
      }),
    );
    assert.match(html, /This invoice is read-only/);
    assert.doesNotMatch(html, /Resolve signal/);
    assert.doesNotMatch(html, /Waive signal/);
  }
});

test('stale command errors are shown without hiding or resolving the server-owned signal', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const commands: unknown[] = [];

  try {
    await act(async () => {
      root.render(
        React.createElement(InvoiceReviewDetail, {
          projection,
          assignees: [],
          onCommand: async (command) => {
            commands.push(command);
            throw new Error('REVIEW STALE VERSION');
          },
        }),
      );
    });
    const resolve = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Resolve signal',
    );
    assert.ok(resolve);
    await act(async () => resolve.click());

    assert.deepEqual(commands, [
      { action: 'resolve_signal', expectedVersion: 3, signalId: 'signal-1' },
    ]);
    assert.match(container.textContent ?? '', /REVIEW STALE VERSION/);
    assert.match(container.textContent ?? '', /Possible duplicate invoice/);
    assert.match(container.textContent ?? '', /Open/);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
