import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import '../../test-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { InvoiceReviewListQuery, InvoiceReviewListResult } from '../../lib/api-contracts';
import { api } from '../../lib/api';
import InvoiceReviewsPage from './page';

Object.defineProperty(globalThis, 'self', { configurable: true, value: window });
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function queueResult(invoiceNumber: string, nextCursor: string | null): InvoiceReviewListResult {
  return {
    items: [
      {
        case: {
          id: `case-${invoiceNumber}`,
          invoiceId: `invoice-${invoiceNumber}`,
          state: 'open',
          ownerId: null,
          version: 1,
          openedAt: '2026-08-01T00:00:00.000Z',
          resolvedAt: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
          ageDays: 31,
          unresolvedSignalCount: 1,
          blockingSignalCount: 1,
          oldestUnresolvedSignalAt: '2026-08-01T00:00:00.000Z',
        },
        invoice: {
          id: `invoice-${invoiceNumber}`,
          internalNumber: `internal-${invoiceNumber}`,
          invoiceNumber,
          status: 'exception',
          dueDate: '2026-09-15',
          totalAmount: '25.00',
          currency: 'USD',
          vendor: null,
          entity: null,
        },
      },
    ],
    nextCursor,
  };
}

function renderPage(searchParams: URLSearchParams) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  function render(nextSearchParams: URLSearchParams) {
    act(() => {
      root.render(
        React.createElement(
          SearchParamsContext.Provider,
          { value: nextSearchParams },
          React.createElement(InvoiceReviewsPage),
        ),
      );
    });
  }

  render(searchParams);
  return {
    container,
    render,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

test('hides stale queue results while a changed URL query is loading', async () => {
  document.body.replaceChildren();
  const pendingSecondList = deferred<InvoiceReviewListResult>();
  const listCalls: unknown[] = [];
  const list = mock.method(api.invoiceReviews, 'list', (query: InvoiceReviewListQuery) => {
    listCalls.push(query);
    return listCalls.length === 1
      ? Promise.resolve(queueResult('OLD-100', 'old-next-cursor'))
      : pendingSecondList.promise;
  });
  const users = mock.method(api.users, 'list', async () => []);
  const vendors = mock.method(api.vendors, 'list', async () => []);
  const entities = mock.method(api.entities, 'list', async () => []);
  const rendered = renderPage(new URLSearchParams('state=open'));

  try {
    await flush();
    assert.match(rendered.container.textContent ?? '', /OLD-100/);
    assert.ok(rendered.container.querySelector('a[href*="old-next-cursor"]'));

    rendered.render(new URLSearchParams('state=resolved'));

    assert.deepEqual(listCalls, [
      { state: 'open', sort: 'oldest_signal', limit: 50 },
      { state: 'resolved', sort: 'oldest_signal', limit: 50 },
    ]);
    assert.match(rendered.container.textContent ?? '', /Loading AP exception queue/);
    assert.doesNotMatch(rendered.container.textContent ?? '', /OLD-100/);
    assert.equal(rendered.container.querySelector('a[href*="old-next-cursor"]'), null);
  } finally {
    pendingSecondList.resolve(queueResult('NEW-200', null));
    await flush();
    rendered.unmount();
    list.mock.restore();
    users.mock.restore();
    vendors.mock.restore();
    entities.mock.restore();
  }
});
