type NavigationLock = { current: boolean };

/** Serializes editor navigation and changes the active view only after its draft is safe. */
export async function navigateAfterDraftFlush(
  lock: NavigationLock,
  flushDraft: () => Promise<boolean>,
  navigate: () => void | Promise<void>,
): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  try {
    if (!(await flushDraft())) return false;
    await navigate();
    return true;
  } finally {
    lock.current = false;
  }
}
