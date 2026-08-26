import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFocusTrapIndex,
  getSearchActiveIndex,
  getSearchOptionId,
  getSearchSelectionIndex,
  restoreFocus,
} from './accessibility';

test('drawer focus wraps at either end of its focusable controls', () => {
  assert.equal(getFocusTrapIndex(3, 0, true), 2);
  assert.equal(getFocusTrapIndex(3, 2, false), 0);
  assert.equal(getFocusTrapIndex(3, -1, false), 0);
  assert.equal(getFocusTrapIndex(3, -1, true), 2);
  assert.equal(getFocusTrapIndex(0, 0, false), null);
});

test('global search keyboard navigation moves and wraps active options', () => {
  assert.equal(getSearchActiveIndex(-1, 3, 'ArrowDown'), 0);
  assert.equal(getSearchActiveIndex(2, 3, 'ArrowDown'), 0);
  assert.equal(getSearchActiveIndex(0, 3, 'ArrowUp'), 2);
  assert.equal(getSearchActiveIndex(1, 3, 'PageDown'), null);
  assert.equal(getSearchOptionId(1), 'global-search-option-1');
  assert.equal(getSearchSelectionIndex(1, 3, 'Enter'), 1);
  assert.equal(getSearchSelectionIndex(-1, 3, 'Enter'), null);
});

test('modal focus restoration calls the opener only while it remains connected', () => {
  let focusCalls = 0;
  const opener = { isConnected: true, focus: () => focusCalls++ };
  const disconnected = { isConnected: false, focus: () => focusCalls++ };

  assert.equal(restoreFocus(opener), true);
  assert.equal(restoreFocus(disconnected), false);
  assert.equal(restoreFocus(null), false);
  assert.equal(focusCalls, 1);
});
