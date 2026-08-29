type NavigationLock = { current: boolean };

/** Serializes editor navigation and changes the active view only after its draft is safe. */
export async function navigateAfterDraftFlush(
  lock: NavigationLock,
  flushDraft: () => Promise<boolean>,
  navigate: () => void | Promise<void>,
  cancelPreparedNavigation: (error: unknown) => void,
): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  let prepared = false;
  try {
    if (!(await flushDraft())) return false;
    prepared = true;
    await navigate();
    return true;
  } catch (error) {
    if (prepared) cancelPreparedNavigation(error);
    throw error;
  } finally {
    lock.current = false;
  }
}
