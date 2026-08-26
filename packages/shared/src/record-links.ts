/** Record kinds that have a canonical detail route in the web application. */
export const RECORD_ROUTES = {
  requisition: 'requisitions',
  rfq: 'rfq',
  purchase_order: 'purchase-orders',
  invoice: 'invoices',
  vendor: 'vendors',
  catalog_item: 'catalog',
} as const;

export type RecordKind = keyof typeof RECORD_ROUTES;

/** Record kinds that can have an approval request. Keep this list exhaustive. */
export const APPROVABLE_RECORD_KINDS = ['requisition', 'purchase_order', 'invoice'] as const;

export type ApprovableRecordKind = (typeof APPROVABLE_RECORD_KINDS)[number];

export const WORKFLOW_RECORD_KINDS = ['requisition', 'rfq'] as const;

export type WorkflowRecordKind = (typeof WORKFLOW_RECORD_KINDS)[number];

export interface WorkflowRecordReference {
  action: string;
  kind: WorkflowRecordKind;
  id: string;
  number: string;
  at: string;
}

export function isRecordKind(value: string): value is RecordKind {
  return Object.hasOwn(RECORD_ROUTES, value);
}

export function isApprovableRecordKind(value: string): value is ApprovableRecordKind {
  return (APPROVABLE_RECORD_KINDS as readonly string[]).includes(value);
}

/** Return the canonical web route for a supported record. */
export function recordHref(record: { kind: RecordKind; id: string }): string {
  return `/${RECORD_ROUTES[record.kind]}/${encodeURIComponent(record.id)}`;
}
