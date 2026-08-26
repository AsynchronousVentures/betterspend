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
