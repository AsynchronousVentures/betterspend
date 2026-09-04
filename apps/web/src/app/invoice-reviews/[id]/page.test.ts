import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import '../../../test-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  InvoiceReviewCommandResult,
  InvoiceReviewProjection,
} from '../../../lib/api-contracts';
import { api } from '../../../lib/api';
import InvoiceReviewPage from './page';

Object.defineProperty(globalThis, 'self', { configurable: true, value: window });
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value() {},
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
    documentId: null,
    vendor: null,
    entity: null,
    purchaseOrder: null,
    lines: [],
  },
  signals: [],
  documents: [],
  messages: [],
  match: { status: 'not_run', details: {}, exceptions: [] },
  approvals: [],
  payments: [],
  provenance: { available: true, fields: [] },
  history: { available: true, entries: [] },
};

function fulfilledParams(id: string): Promise<{ id: string }> {
  const params = Promise.resolve({ id }) as Promise<{ id: string }> & {
    status: 'fulfilled';
    value: { id: string };
  };
  params.status = 'fulfilled';
  params.value = { id };
  return params;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function projectionFor(
  invoiceId: string,
  invoiceNumber: string,
  version = 3,
): InvoiceReviewProjection {
  return {
    ...projection,
    case: {
      ...projection.case,
      id: `case-${invoiceId}`,
      invoiceId,
      version,
    },
    invoice: {
      ...projection.invoice,
      id: invoiceId,
      internalNumber: `INTERNAL-${invoiceId}`,
      invoiceNumber,
    },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(container: HTMLElement, label: string) {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  assert.ok(match, `Expected a ${label} button`);
  return match;
}

test('keeps a successful command result when its follow-up detail refresh fails', async () => {
  document.body.replaceChildren();
  let getCalls = 0;
  const get = mock.method(api.invoiceReviews, 'get', async () => {
    getCalls += 1;
    if (getCalls === 1) return projection;
    throw new Error('DETAIL_REFRESH_FAILED');
  });
  const commandResults: InvoiceReviewCommandResult[] = [
    {
      case: {
        id: 'case-1',
        invoiceId: 'invoice-1',
        state: 'open',
        ownerId: null,
        version: 4,
        resolvedAt: null,
      },
    },
    {
      case: {
        id: 'case-1',
        invoiceId: 'invoice-1',
        state: 'in_review',
        ownerId: 'owner-1',
        version: 5,
        resolvedAt: null,
      },
    },
  ];
  const command = mock.method(api.invoiceReviews, 'command', async () => {
    const result = commandResults.shift();
    assert.ok(result);
    return result;
  });
  const users = mock.method(api.users, 'list', async () => []);
  const messages = mock.method(api.messages, 'list', async () => []);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  try {
    act(() =>
      root.render(
        React.createElement(InvoiceReviewPage, { params: fulfilledParams('invoice-1') }),
      ),
    );
    await flush();

    await act(async () => {
      button(container, 'Release').click();
    });

    const text = container.textContent ?? '';
    assert.match(text, /Review case updated/);
    assert.doesNotMatch(text, /DETAIL_REFRESH_FAILED/);
    assert.match(text, /Version4/);
    assert.match(text, /OwnerUnassigned/);
    assert.doesNotMatch(text, /OwnerAda Reviewer/);

    await act(async () => {
      button(container, 'Claim').click();
    });

    assert.deepEqual(command.mock.calls[1]?.arguments, [
      'invoice-1',
      { action: 'claim', expectedVersion: 4 },
    ]);
  } finally {
    act(() => root.unmount());
    container.remove();
    get.mock.restore();
    command.mock.restore();
    users.mock.restore();
    messages.mock.restore();
  }
});

test('does not regress a command result when its successful refresh has an older version', async () => {
  document.body.replaceChildren();
  let getCalls = 0;
  const get = mock.method(api.invoiceReviews, 'get', async () => {
    getCalls += 1;
    return projectionFor('invoice-1', 'SUP-7788', 3);
  });
  const commandResults: InvoiceReviewCommandResult[] = [
    {
      case: {
        id: 'case-invoice-1',
        invoiceId: 'invoice-1',
        state: 'open',
        ownerId: null,
        version: 4,
        resolvedAt: null,
      },
    },
    {
      case: {
        id: 'case-invoice-1',
        invoiceId: 'invoice-1',
        state: 'in_review',
        ownerId: 'owner-1',
        version: 5,
        resolvedAt: null,
      },
    },
  ];
  const command = mock.method(api.invoiceReviews, 'command', async () => {
    const result = commandResults.shift();
    assert.ok(result);
    return result;
  });
  const users = mock.method(api.users, 'list', async () => []);
  const messages = mock.method(api.messages, 'list', async () => []);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  try {
    act(() =>
      root.render(
        React.createElement(InvoiceReviewPage, { params: fulfilledParams('invoice-1') }),
      ),
    );
    await flush();

    await act(async () => {
      button(container, 'Release').click();
    });

    assert.match(container.textContent ?? '', /Review case updated/);
    assert.match(container.textContent ?? '', /Version4/);
    assert.match(container.textContent ?? '', /OwnerUnassigned/);

    await act(async () => {
      button(container, 'Claim').click();
    });

    assert.deepEqual(command.mock.calls[1]?.arguments, [
      'invoice-1',
      { action: 'claim', expectedVersion: 4 },
    ]);
  } finally {
    act(() => root.unmount());
    container.remove();
    get.mock.restore();
    command.mock.restore();
    users.mock.restore();
    messages.mock.restore();
  }
});

test('clears the previous case before the next route finishes loading', async () => {
  document.body.replaceChildren();
  const invoiceBLoad = deferred<InvoiceReviewProjection>();
  const get = mock.method(api.invoiceReviews, 'get', (invoiceId: string) =>
    invoiceId === 'invoice-b'
      ? invoiceBLoad.promise
      : Promise.resolve(projectionFor('invoice-a', 'INVOICE-A')),
  );
  const command = mock.method(api.invoiceReviews, 'command', async () => {
    throw new Error('no command should be reachable while the next case is loading');
  });
  const users = mock.method(api.users, 'list', async () => []);
  const messages = mock.method(api.messages, 'list', async () => []);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  try {
    act(() =>
      root.render(
        React.createElement(InvoiceReviewPage, { params: fulfilledParams('invoice-a') }),
      ),
    );
    await flush();
    assert.match(container.textContent ?? '', /INVOICE-A/);

    act(() =>
      root.render(
        React.createElement(InvoiceReviewPage, { params: fulfilledParams('invoice-b') }),
      ),
    );

    // The previous case must not stay actionable once `id` points at another invoice.
    assert.doesNotMatch(container.textContent ?? '', /INVOICE-A/);
    assert.match(container.textContent ?? '', /Loading invoice review/);
    assert.equal(command.mock.calls.length, 0);
  } finally {
    invoiceBLoad.resolve(projectionFor('invoice-b', 'INVOICE-B'));
    await flush();
    act(() => root.unmount());
    container.remove();
    get.mock.restore();
    command.mock.restore();
    users.mock.restore();
    messages.mock.restore();
  }
});

test('does not apply a delayed command refresh after the mounted route changes', async () => {
  document.body.replaceChildren();
  const delayedInvoiceARefresh = deferred<InvoiceReviewProjection>();
  const invoiceBLoad = deferred<InvoiceReviewProjection>();
  let invoiceAGetCalls = 0;
  const get = mock.method(api.invoiceReviews, 'get', (invoiceId: string) => {
    if (invoiceId === 'invoice-b') {
      return invoiceBLoad.promise;
    }
    invoiceAGetCalls += 1;
    return invoiceAGetCalls === 1
      ? Promise.resolve(projectionFor('invoice-a', 'INVOICE-A'))
      : delayedInvoiceARefresh.promise;
  });
  const command = mock.method(api.invoiceReviews, 'command', async () => ({
    case: {
      id: 'case-invoice-a',
      invoiceId: 'invoice-a',
      state: 'open' as const,
      ownerId: null,
      version: 4,
      resolvedAt: null,
    },
  }));
  const users = mock.method(api.users, 'list', async () => []);
  const messages = mock.method(api.messages, 'list', async () => []);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  try {
    act(() =>
      root.render(
        React.createElement(InvoiceReviewPage, { params: fulfilledParams('invoice-a') }),
      ),
    );
    await flush();

    act(() => button(container, 'Release').click());
    await flush();

    act(() =>
      root.render(
        React.createElement(InvoiceReviewPage, { params: fulfilledParams('invoice-b') }),
      ),
    );
    await flush();
    assert.deepEqual(
      get.mock.calls.map((call) => call.arguments),
      [['invoice-a'], ['invoice-a'], ['invoice-b']],
    );
    invoiceBLoad.resolve(projectionFor('invoice-b', 'INVOICE-B'));
    await flush();
    assert.match(container.textContent ?? '', /INVOICE-B/);
    assert.doesNotMatch(container.textContent ?? '', /INVOICE-A/);

    delayedInvoiceARefresh.resolve(projectionFor('invoice-a', 'INVOICE-A', 4));
    await flush();

    assert.match(container.textContent ?? '', /INVOICE-B/);
    assert.doesNotMatch(container.textContent ?? '', /INVOICE-A/);
  } finally {
    invoiceBLoad.resolve(projectionFor('invoice-b', 'INVOICE-B'));
    delayedInvoiceARefresh.resolve(projectionFor('invoice-a', 'INVOICE-A', 4));
    await flush();
    act(() => root.unmount());
    container.remove();
    get.mock.restore();
    command.mock.restore();
    users.mock.restore();
    messages.mock.restore();
  }
});
