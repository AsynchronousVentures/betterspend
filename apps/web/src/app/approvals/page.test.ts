import assert from 'node:assert/strict';
import test from 'node:test';
import '../../test-dom';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApprovalEntityLink } from './approval-entity-link';

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

test('does not link unavailable approval records on mobile', () => {
  document.body.replaceChildren();
  const rendered = render(
    React.createElement(ApprovalEntityLink, {
      entity: null,
      href: '/invoices/invoice-1',
      label: 'Record unavailable',
    }),
  );

  try {
    assert.equal(rendered.container.textContent, 'Record unavailable');
    assert.equal(rendered.container.querySelector('a'), null);
  } finally {
    rendered.unmount();
  }
});
