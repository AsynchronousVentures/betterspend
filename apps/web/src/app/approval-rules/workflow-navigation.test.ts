import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { navigateAfterDraftFlush } from './workflow-navigation';
import { beginWorkflowOperation, endWorkflowOperation } from './workflow-operation-lock';

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
      () => undefined,
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
      () => undefined,
    );
    const second = navigateAfterDraftFlush(
      lock,
      async () => true,
      () => {
        calls.push('workflow-c');
      },
      () => undefined,
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
        () => undefined,
      ),
      true,
    );
    assert.deepEqual(calls, ['clean', 'workflow-b']);
  });

  it('keeps an already-started layout from mutating during a workflow switch', async () => {
    const navigationLock = { current: false };
    const editorLock = { current: false };
    let finishNavigation: (() => void) | undefined;
    let layoutApplied = false;

    const navigating = navigateAfterDraftFlush(
      navigationLock,
      async () => beginWorkflowOperation(editorLock),
      () =>
        new Promise<void>((resolve) => {
          finishNavigation = resolve;
        }),
      () => endWorkflowOperation(editorLock),
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!editorLock.current) layoutApplied = true;
    assert.equal(layoutApplied, false);
    assert.equal(editorLock.current, true);

    finishNavigation?.();
    assert.equal(await navigating, true);
    assert.equal(editorLock.current, true);
    endWorkflowOperation(editorLock); // The replaced canvas releases its lock on unmount.
  });

  it('releases a prepared editor when target loading fails', async () => {
    const editorLock = { current: false };
    await assert.rejects(
      navigateAfterDraftFlush(
        { current: false },
        async () => beginWorkflowOperation(editorLock),
        async () => {
          throw new Error('load failed');
        },
        () => endWorkflowOperation(editorLock),
      ),
      /load failed/,
    );
    assert.equal(editorLock.current, false);
  });
});
