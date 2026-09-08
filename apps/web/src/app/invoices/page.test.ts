import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import '../../test-dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { InvoiceListItem } from '../../lib/api-contracts';
import { api } from '../../lib/api';
import InvoicesPage from './page';

Object.defineProperty(globalThis, 'self', { configurable: true, value: window });
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

function invoice(index: number): InvoiceListItem {
  return {
    id: String(index),
    organizationId: 'org',
    entityId: null,
    purchaseOrderId: null,
    vendorId: 'vendor',
    invoiceNumber: `INV-${index}`,
    internalNumber: `INV-${index}`,
    status: 'matched',
    invoiceDate: '2026-09-01',
    dueDate: null,
    paymentTerms: null,
    earlyPaymentDiscountPercent: null,
    earlyPaymentDiscountBy: null,
    paidAt: null,
    paymentReference: null,
    subtotal: '100',
    taxAmount: '0',
    totalAmount: '100',
    currency: 'USD',
    baseCurrency: 'USD',
    exchangeRate: '1',
    baseSubtotal: '100',
    baseTaxAmount: '0',
    baseTotalAmount: '100',
    documentId: null,
    matchStatus: 'full_match',
    matchDetails: null,
    submissionSource: 'internal',
    createdBy: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    vendor: null,
    purchaseOrder: null,
    entity: null,
  };
}

for (const mobile of [false, true]) {
  test(`invoice pagination bounds ${mobile ? 'mobile' : 'desktop'} rendering, selection and filters`, async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }),
    });
    const history = Array.from({ length: 125 }, (_, index) => invoice(index));
    const requests: Parameters<typeof api.invoices.list>[0][] = [];
    const list = mock.method(
      api.invoices,
      'list',
      async (query: Parameters<typeof api.invoices.list>[0]) => {
        requests.push(query);
        const page = Number(query?.cursor ?? '1');
        return {
          items: history.slice((page - 1) * 50, page * 50),
          nextCursor: page < 3 ? String(page + 1) : null,
        };
      },
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(React.createElement(InvoicesPage));
      });
      assert.equal(container.querySelectorAll(mobile ? 'article' : 'tbody tr').length, 50);
      assert.equal(container.querySelectorAll(mobile ? 'tbody tr' : 'article').length, 0);
      assert.deepEqual(requests[0], { cursor: undefined, limit: 50, status: undefined });
      const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
      assert.ok(checkbox);
      await act(async () => {
        checkbox.click();
      });
      assert.match(container.textContent ?? '', /Approve \d+ Selected/);
      const next = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Next',
      )!;
      await act(async () => {
        next.click();
      });
      assert.equal(requests.at(-1)?.cursor, '2');
      assert.doesNotMatch(container.textContent ?? '', /Approve \d+ Selected/);
      assert.equal(container.querySelectorAll(mobile ? 'article' : 'tbody tr').length, 50);
      await act(async () => {
        next.click();
      });
      assert.equal(container.querySelectorAll(mobile ? 'article' : 'tbody tr').length, 25);
      assert.equal(next.disabled, true);
      const previous = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Previous',
      )!;
      await act(async () => {
        previous.click();
      });
      assert.equal(requests.at(-1)?.cursor, '2');
      assert.equal(container.querySelectorAll(mobile ? 'article' : 'tbody tr').length, 50);
      const filter = container.querySelector('select')!;
      await act(async () => {
        filter.value = 'approved';
        filter.dispatchEvent(new window.Event('change', { bubbles: true }));
      });
      assert.deepEqual(requests.at(-1), { cursor: undefined, limit: 50, status: 'approved' });
      assert.equal(previous.disabled, true);
      const beforeBytes = Buffer.byteLength(JSON.stringify(history));
      const afterBytes = Buffer.byteLength(
        JSON.stringify({ items: history.slice(0, 50), nextCursor: '2' }),
      );
      assert.ok(afterBytes < beforeBytes / 2);
      console.log(
        `125 synthetic invoices: ${beforeBytes} bytes full history, ${afterBytes} bytes per 50-row page; mounted records 250 before, 50 after (${mobile ? 'mobile' : 'desktop'}).`,
      );
    } finally {
      act(() => root.unmount());
      container.remove();
      list.mock.restore();
    }
  });
}

test('a late response cannot replace the active invoice filter', async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  type Result = Awaited<ReturnType<typeof api.invoices.list>>;
  const resolvers: Array<(result: Result) => void> = [];
  const list = mock.method(
    api.invoices,
    'list',
    () =>
      new Promise<Result>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(InvoicesPage));
    });
    const filter = container.querySelector('select')!;
    await act(async () => {
      filter.value = 'approved';
      filter.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await act(async () => {
      resolvers[1]({ items: [invoice(222)], nextCursor: null });
    });
    await act(async () => {
      resolvers[0]({ items: [invoice(111)], nextCursor: '2' });
    });
    assert.match(container.textContent ?? '', /INV-222/);
    assert.doesNotMatch(container.textContent ?? '', /INV-111/);
  } finally {
    act(() => root.unmount());
    container.remove();
    list.mock.restore();
  }
});

test('AP aging keeps complete-history KPIs while paging its unpaid table', async () => {
  const { default: ApAgingPage } = await import('../(dashboard)/ap-aging/page');
  const bucket = { count: 0, totalAmount: '0.00' };
  const aging = mock.method(api.invoices, 'aging', async () => ({
    openCount: 125,
    dueIn7Days: { count: 125, totalAmount: '12500.00' },
    current: { count: 125, totalAmount: '12500.00' },
    days_1_30: bucket,
    days_31_60: bucket,
    days_61_90: bucket,
    days_90_plus: bucket,
  }));
  const early = mock.method(api.invoices, 'earlyPaymentOpportunities', async () => []);
  const list = mock.method(
    api.invoices,
    'list',
    async (query: Parameters<typeof api.invoices.list>[0]) => {
      assert.equal(query?.unpaid, 'true');
      return {
        items: Array.from({ length: 50 }, (_, index) => invoice(index)),
        nextCursor: '2',
      };
    },
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(ApAgingPage));
    });
    assert.match(container.textContent ?? '', /Open Invoices\s*125/);
    assert.match(container.textContent ?? '', /125 invoices/);
    assert.equal(container.querySelectorAll('tbody tr').length, 50);
    const next = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Next',
    )!;
    await act(async () => {
      next.click();
    });
    assert.match(container.textContent ?? '', /Open Invoices\s*125/);
    assert.match(container.textContent ?? '', /125 invoices/);
    assert.equal(list.mock.calls.at(-1)?.arguments[0]?.cursor, '2');
  } finally {
    act(() => root.unmount());
    container.remove();
    list.mock.restore();
    aging.mock.restore();
    early.mock.restore();
  }
});
