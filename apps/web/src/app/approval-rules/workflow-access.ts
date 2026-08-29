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

export interface WorkflowDraftAccessClient<TDefinition> {
  status: (definitionId: string) => Promise<WorkflowDraftLeaseStatus>;
  acquire: (definitionId: string) => Promise<WorkflowDraftLeaseStatus>;
  release: (definitionId: string, leaseToken: string) => Promise<WorkflowDraftLeaseStatus>;
  getDefinition: (definitionId: string) => Promise<TDefinition>;
  isActive?: () => boolean;
}

export type OpenWorkflowDraftAccessResult<TDefinition> =
  | { status: Exclude<WorkflowDraftLeaseStatus, { state: 'owned' }>; definition: null }
  | {
      status: Extract<WorkflowDraftLeaseStatus, { state: 'owned' }>;
      definition: TDefinition;
    };

/** Acquires edit access, then reloads the draft under that lease before exposing mutation. */
export async function openWorkflowDraftAccess<TDefinition>(
  definitionId: string,
  client: WorkflowDraftAccessClient<TDefinition>,
): Promise<OpenWorkflowDraftAccessResult<TDefinition>> {
  const current = await client.status(definitionId);
  const status = current.state === 'available' ? await client.acquire(definitionId) : current;
  if (status.state !== 'owned') return { status, definition: null };

  if (client.isActive && !client.isActive()) {
    await client.release(definitionId, status.leaseToken).catch(() => undefined);
    return { status: { state: 'available' }, definition: null };
  }

  try {
    const definition = await client.getDefinition(definitionId);
    if (client.isActive && !client.isActive()) {
      await client.release(definitionId, status.leaseToken).catch(() => undefined);
      return { status: { state: 'available' }, definition: null };
    }
    return { status, definition };
  } catch (error) {
    await client.release(definitionId, status.leaseToken).catch(() => undefined);
    throw error;
  }
}

export function canRestoreWorkflowDraft(input: {
  ownsLease: boolean;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  restoring: boolean;
}): boolean {
  return input.ownsLease && !input.dirty && !input.saving && !input.publishing && !input.restoring;
}
