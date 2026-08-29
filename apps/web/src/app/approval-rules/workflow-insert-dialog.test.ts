import assert from 'node:assert/strict';
import test from 'node:test';
import '../../test-dom';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorkflowInsertDialog } from './workflow-insert-dialog';
import { WORKFLOW_NODE_REGISTRY } from './workflow-node-registry';

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return () => {
    act(() => root.unmount());
    container.remove();
  };
}

test('insert-step dialog labels itself, closes on Escape, and restores focus', async () => {
  document.body.replaceChildren();
  const opener = document.createElement('button');
  opener.textContent = 'Insert step on route';
  document.body.append(opener);
  opener.focus();

  function Harness() {
    const [open, setOpen] = React.useState(true);
    return React.createElement(WorkflowInsertDialog, {
      open,
      items: [WORKFLOW_NODE_REGISTRY.auto_approve],
      returnFocusRef: { current: opener },
      onOpenChange: setOpen,
      onInsert: () => undefined,
    });
  }

  const unmount = render(React.createElement(Harness));
  try {
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    const close = dialog?.querySelector<HTMLButtonElement>(
      '[aria-label="Close insert step dialog"]',
    );
    assert.ok(dialog);
    assert.ok(close);
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.match(dialog.textContent ?? '', /Insert step/);
    assert.match(dialog.textContent ?? '', /Choose a compatible step/);

    await act(async () => {
      dialog.dispatchEvent(
        new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }),
      );
      await Promise.resolve();
    });

    assert.equal(document.body.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement, opener);
  } finally {
    unmount();
  }
});
