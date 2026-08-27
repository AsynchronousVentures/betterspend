import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleBlanketReleaseDialogOpenChange,
  resetBlanketReleaseDialog,
} from './blanket-release-dialog-state';

test('closing a blanket release dialog clears every abandoned field', () => {
  const updates: Array<[string, boolean | string]> = [];

  resetBlanketReleaseDialog({
    setOpen: (value) => updates.push(['open', value]),
    setAmount: (value) => updates.push(['amount', value]),
    setDescription: (value) => updates.push(['description', value]),
    setError: (value) => updates.push(['error', value]),
  });

  assert.deepEqual(updates, [
    ['open', false],
    ['amount', ''],
    ['description', ''],
    ['error', ''],
  ]);
});

test('the dialog open-change callback resets fields when Radix requests dismissal', () => {
  const updates: Array<[string, boolean | string]> = [];
  const setters = {
    setOpen: (value: boolean) => updates.push(['open', value]),
    setAmount: (value: string) => updates.push(['amount', value]),
    setDescription: (value: string) => updates.push(['description', value]),
    setError: (value: string) => updates.push(['error', value]),
  };

  handleBlanketReleaseDialogOpenChange(true, setters);
  assert.deepEqual(updates, [['open', true]]);

  updates.length = 0;
  handleBlanketReleaseDialogOpenChange(false, setters);
  assert.deepEqual(updates, [
    ['open', false],
    ['amount', ''],
    ['description', ''],
    ['error', ''],
  ]);
});
