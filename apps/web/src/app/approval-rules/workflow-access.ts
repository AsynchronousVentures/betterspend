import type { WorkflowDraftLeaseStatus } from '@betterspend/shared';
import type { AiProvidersStatusResponse } from '../../lib/api';

export function ownsWorkflowDraftLease(
  status: WorkflowDraftLeaseStatus | null,
): status is Extract<WorkflowDraftLeaseStatus, { state: 'owned' }> {
  return status?.state === 'owned';
}

export function hasUsableWorkflowAssistant(status: AiProvidersStatusResponse): boolean {
  return status.providers.some((provider) => provider.connected && provider.enabled);
}
