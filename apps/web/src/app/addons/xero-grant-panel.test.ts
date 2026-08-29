import assert from 'node:assert/strict';
import test from 'node:test';
import '../../test-dom';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { XeroGrantPanel } from './xero-grant-panel';

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

const noOp = () => {};

test('Xero tenant picker submits an explicit organization selection', () => {
  document.body.replaceChildren();
  let submitted = false;
  const rendered = render(
    React.createElement(XeroGrantPanel, {
      state: {
        status: 'choosing',
        grantId: 'grant-1',
        tenants: [
          { tenantId: 'tenant-1', tenantName: 'Northwind' },
          { tenantId: 'tenant-2', tenantName: null },
        ],
        selectedTenantId: 'tenant-2',
      },
      oauthLoading: false,
      onTenantChange: noOp,
      onSubmit: () => {
        submitted = true;
      },
      onRetry: noOp,
      onStartOver: noOp,
    }),
  );

  try {
    const options = [...rendered.container.querySelectorAll('option')].map(
      (option) => option.textContent,
    );
    assert.deepEqual(options, [
      'Select an organization',
      'Northwind (tenant-1)',
      'Organization 2 (tenant-2)',
    ]);
    assert.equal(rendered.container.querySelector('button')?.disabled, false);

    act(() => {
      rendered.container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(submitted, true);
  } finally {
    rendered.unmount();
  }
});

test('an expired Xero grant offers a clean restart without a pointless retry', () => {
  document.body.replaceChildren();
  let startedOver = false;
  const rendered = render(
    React.createElement(XeroGrantPanel, {
      state: {
        status: 'error',
        grantId: 'grant-1',
        message: 'Invalid or expired Xero grant',
        canRetry: false,
      },
      oauthLoading: false,
      onTenantChange: noOp,
      onSubmit: noOp,
      onRetry: noOp,
      onStartOver: () => {
        startedOver = true;
      },
    }),
  );

  try {
    assert.ok(rendered.container.querySelector('[role="alert"]'));
    assert.equal(rendered.container.textContent?.includes('Retry'), false);
    const startOver = [...rendered.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Start over',
    );
    assert.ok(startOver);
    act(() => startOver.click());
    assert.equal(startedOver, true);
  } finally {
    rendered.unmount();
  }
});
