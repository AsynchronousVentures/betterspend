export interface ReceivingPurchaseOrderSummary {
  id: string;
  number: string;
  vendor: { id: string; name: string } | null;
}

export interface ReceivingLine {
  id: string;
  poLineId: string;
  quantityReceived: string;
  quantityRejected: string;
  rejectionReason: string | null;
  storageLocation: string | null;
  poLine?: { lineNumber: string; description: string; quantity: string } | null;
}

export interface ReceivingListItem {
  id: string;
  number: string;
  status: string;
  receivedDate: string;
  purchaseOrder: ReceivingPurchaseOrderSummary | null;
  lines: ReceivingLine[];
}

export interface ReceivingDetail extends ReceivingListItem {
  notes: string | null;
  lines: ReceivingLine[];
  createdAt: string;
}

export interface RelatedRecordLink {
  href: string | null;
  label: string;
}

/** Convert an optional related record into a safe link or an explicit unavailable state. */
export function relatedRecordLink(
  record: { id: string; label: string } | null | undefined,
  collection: string,
): RelatedRecordLink {
  if (!record?.id || !record.label) return { href: null, label: 'Unavailable' };
  return {
    href: `/${collection}/${encodeURIComponent(record.id)}`,
    label: record.label,
  };
}
