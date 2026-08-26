import assert from 'node:assert/strict';
import test from 'node:test';
import '../test-dom';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GlobalSearch, MobileSidebar, ShortcutsModal } from './app-shell';

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });

  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function resetDom() {
  document.body.replaceChildren();
  window.localStorage.clear();
}

function dispatchKey(element: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new window.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  });
  element.dispatchEvent(event);
  return event;
}

function dispatchKeyInAct(element: Element, key: string, init: KeyboardEventInit = {}) {
  let event: KeyboardEvent | undefined;
  act(() => {
    event = dispatchKey(element, key, init);
  });
  return event as KeyboardEvent;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

test('mobile navigation enters, traps Tab, closes on Escape, and restores its opener', () => {
  resetDom();
  const opener = document.createElement('button');
  opener.textContent = 'Open navigation';
  document.body.append(opener);
  opener.focus();

  const triggerRef = { current: opener };
  function DrawerHarness() {
    const [open, setOpen] = React.useState(true);
    return React.createElement(
      MobileSidebar,
      {
        open,
        onOpenChange: setOpen,
        triggerRef,
        appName: 'BetterSpend',
      },
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'button',
          { type: 'button', 'data-mobile-sidebar-close': 'true' },
          'Close navigation',
        ),
        React.createElement('a', { href: '/purchase-orders' }, 'Purchase orders'),
      ),
    );
  }

  const rendered = render(React.createElement(DrawerHarness));
  try {
    const dialog = rendered.container.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog);
    assert.equal(dialog.getAttribute('aria-label'), 'BetterSpend navigation');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');

    const closeButton = dialog.querySelector<HTMLButtonElement>(
      '[data-mobile-sidebar-close="true"]',
    );
    const link = dialog.querySelector<HTMLAnchorElement>('a[href]');
    assert.ok(closeButton);
    assert.ok(link);
    assert.equal(document.activeElement, closeButton);

    link.focus();
    const wrappedTab = dispatchKeyInAct(link, 'Tab');
    assert.equal(wrappedTab.defaultPrevented, true);
    assert.equal(document.activeElement, closeButton);

    const reverseWrappedTab = dispatchKeyInAct(closeButton, 'Tab', { shiftKey: true });
    assert.equal(reverseWrappedTab.defaultPrevented, true);
    assert.equal(document.activeElement, link);

    const escape = dispatchKeyInAct(link, 'Escape');
    assert.equal(escape.defaultPrevented, true);
    assert.equal(rendered.container.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement, opener);
  } finally {
    rendered.unmount();
  }
});

test('global search renders combobox state, selects results with the keyboard, and ignores stale responses', async () => {
  resetDom();
  type SearchPayload = {
    requisitions: SearchResult[];
    purchaseOrders: SearchResult[];
    invoices: SearchResult[];
    vendors: SearchResult[];
    catalogItems: SearchResult[];
  };
  type SearchResult = {
    id: string;
    _type: string;
    _label: string;
    _href: string;
    status?: string;
  };

  const pending: Array<{
    query: string;
    resolve: (payload: SearchPayload) => void;
  }> = [];
  const search = (query: string) =>
    new Promise<SearchPayload>((resolve) => {
      pending.push({ query, resolve });
    });
  const navigated: string[] = [];
  const oldResult: SearchResult = {
    id: 'old',
    _type: 'purchase_order',
    _label: 'Old result',
    _href: '/purchase-orders/old',
  };
  const currentResults: SearchResult[] = [
    {
      id: 'current-1',
      _type: 'purchase_order',
      _label: 'Current one',
      _href: '/purchase-orders/current-1',
      status: 'draft',
    },
    {
      id: 'current-2',
      _type: 'invoice',
      _label: 'Current two',
      _href: '/invoices/current-2',
      status: 'matched',
    },
  ];
  const response = (results: SearchResult[]): SearchPayload => ({
    requisitions: [],
    purchaseOrders: results.filter((result) => result._type === 'purchase_order'),
    invoices: results.filter((result) => result._type === 'invoice'),
    vendors: [],
    catalogItems: [],
  });

  const rendered = render(
    React.createElement(GlobalSearch, {
      isMobile: false,
      onNavigate: (href: string) => navigated.push(href),
      search,
    }),
  );
  try {
    const input = rendered.container.querySelector<HTMLInputElement>('[data-global-search="true"]');
    assert.ok(input);
    assert.equal(input.getAttribute('role'), 'combobox');
    assert.equal(input.getAttribute('aria-haspopup'), 'listbox');
    assert.equal(input.getAttribute('aria-expanded'), 'false');

    act(() => setInputValue(input, 'old'));
    await act(async () => delay(350));
    assert.deepEqual(
      pending.map(({ query }) => query),
      ['old'],
    );

    act(() => setInputValue(input, 'new'));
    await act(async () => delay(350));
    assert.deepEqual(
      pending.map(({ query }) => query),
      ['old', 'new'],
    );

    await act(async () => {
      pending[0]?.resolve(response([oldResult]));
      await Promise.resolve();
    });
    assert.equal(rendered.container.textContent?.includes('Old result'), false);

    await act(async () => {
      pending[1]?.resolve(response(currentResults));
      await Promise.resolve();
    });

    const listbox = rendered.container.querySelector<HTMLElement>('[role="listbox"]');
    const options = rendered.container.querySelectorAll<HTMLElement>('[role="option"]');
    const announcement = rendered.container.querySelector<HTMLElement>('[role="status"]');
    assert.ok(listbox);
    assert.equal(input.getAttribute('aria-expanded'), 'true');
    assert.equal(input.getAttribute('aria-controls'), 'global-search-results');
    assert.equal(input.getAttribute('aria-activedescendant'), 'global-search-option-0');
    assert.equal(options.length, 2);
    assert.equal(options[0]?.getAttribute('tabindex'), '-1');
    assert.equal(options[1]?.getAttribute('tabindex'), '-1');
    assert.equal(options[0]?.getAttribute('aria-selected'), 'true');
    assert.equal(options[1]?.getAttribute('aria-selected'), 'false');
    assert.equal(announcement?.textContent, '2 results found for new');

    const next = dispatchKeyInAct(input, 'ArrowDown');
    assert.equal(next.defaultPrevented, true);
    assert.equal(input.getAttribute('aria-activedescendant'), 'global-search-option-1');

    const enter = dispatchKeyInAct(input, 'Enter');
    assert.equal(enter.defaultPrevented, true);
    assert.deepEqual(navigated, ['/invoices/current-2']);
    assert.equal(input.getAttribute('aria-expanded'), 'false');
  } finally {
    rendered.unmount();
  }
});

test('shortcuts use a labelled, constrained shared dialog and restore focus after Escape', async () => {
  resetDom();
  const opener = document.createElement('button');
  opener.textContent = 'Keyboard shortcuts';
  document.body.append(opener);
  opener.focus();
  const returnFocusRef = { current: opener };

  function ShortcutsHarness() {
    const [open, setOpen] = React.useState(true);
    return React.createElement(ShortcutsModal, {
      open,
      shortcutsDisabled: false,
      onClose: () => setOpen(false),
      onToggleDisabled: () => {},
      returnFocusRef,
    });
  }

  const rendered = render(React.createElement(ShortcutsHarness));
  try {
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog);
    const titleId = dialog.getAttribute('aria-labelledby');
    const descriptionId = dialog.getAttribute('aria-describedby');
    assert.ok(titleId);
    assert.ok(descriptionId);
    assert.equal(document.getElementById(titleId)?.textContent, 'Keyboard Shortcuts');
    assert.match(document.getElementById(descriptionId)?.textContent ?? '', /Global navigation/);
    assert.equal(dialog.classList.contains('max-h-[calc(100dvh-2rem)]'), true);
    assert.equal(dialog.classList.contains('overflow-y-auto'), true);

    const escape = dispatchKeyInAct(dialog, 'Escape');
    assert.equal(escape.defaultPrevented, true);
    assert.equal(document.body.querySelector('[role="dialog"]'), null);
    await act(async () => delay(0));
    assert.equal(document.activeElement, opener);
  } finally {
    rendered.unmount();
  }
});
