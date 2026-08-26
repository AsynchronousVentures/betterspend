export const WORKFLOW_RECORD_KINDS = ['requisition', 'rfq'] as const;

export type WorkflowRecordKind = (typeof WORKFLOW_RECORD_KINDS)[number];

export interface WorkflowRecordReference {
  action: string;
  kind: WorkflowRecordKind;
  id: string;
  number: string;
  at: string;
}

/** Return the canonical web route for a record created by a workflow. */
export function recordHref(record: Pick<WorkflowRecordReference, 'kind' | 'id'>): string {
  const route = record.kind === 'rfq' ? 'rfq' : 'requisitions';
  return `/${route}/${encodeURIComponent(record.id)}`;
}
