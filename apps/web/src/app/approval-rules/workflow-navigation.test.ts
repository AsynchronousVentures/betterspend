import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { navigateAfterDraftFlush } from './workflow-navigation';

describe('workflow navigation', () => {
  it('flushes an immediate New action before leaving the canvas', async () => {
    const calls: string[] = [];
    const lock = { current: false };
    let releaseSave: (() => void) | undefined;

    const navigating = navigateAfterDraftFlush(
      lock,
      () =>
        new Promise<boolean>((resolve) => {
          calls.push('save');
          releaseSave = () => resolve(true);
        }),
      () => {
        calls.push('new');
      },
    );

    assert.equal(lock.current, true);
    assert.deepEqual(calls, ['save']);
    releaseSave?.();
    assert.equal(await navigating, true);
    assert.deepEqual(calls, ['save', 'new']);
  });

  it('blocks a fast second workflow switch and stays put after a failed save', async () => {
    const calls: string[] = [];
    const lock = { current: false };
    let rejectSave: (() => void) | undefined;
    const first = navigateAfterDraftFlush(
      lock,
      () =>
        new Promise<boolean>((resolve) => {
          rejectSave = () => resolve(false);
        }),
      () => {
        calls.push('workflow-b');
      },
    );
    const second = navigateAfterDraftFlush(
      lock,
      async () => true,
      () => {
        calls.push('workflow-c');
      },
    );

    assert.equal(await second, false);
    rejectSave?.();
    assert.equal(await first, false);
    assert.deepEqual(calls, []);
  });

  it('navigates clean drafts without an artificial delay', async () => {
    const calls: string[] = [];
    assert.equal(
      await navigateAfterDraftFlush(
        { current: false },
        async () => {
          calls.push('clean');
          return true;
        },
        () => {
          calls.push('workflow-b');
        },
      ),
      true,
    );
    assert.deepEqual(calls, ['clean', 'workflow-b']);
  });
});
