export interface WorkflowOperationLock {
  current: boolean;
}

/** Claims the editor's mutation boundary synchronously before React state can render. */
export function beginWorkflowOperation(lock: WorkflowOperationLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function endWorkflowOperation(lock: WorkflowOperationLock): void {
  lock.current = false;
}
