export interface MaterialInvoiceState {
  vendorId: string;
  invoiceDate: string;
  dueDate: string | null;
  paymentTerms: string | null;
  earlyPaymentDiscountPercent: string | null;
  earlyPaymentDiscountBy: string | null;
  currency: string;
  exchangeRate: string;
  lines: Array<{
    id: string;
    lineNumber: string;
    poLineId: string | null;
    quantity: string;
    unitPrice: string;
    glAccount: string | null;
    taxCodeId: string | null;
    taxInclusive: boolean;
  }>;
}

const HEADER_FIELDS = [
  'vendorId',
  'invoiceDate',
  'dueDate',
  'paymentTerms',
  'earlyPaymentDiscountPercent',
  'earlyPaymentDiscountBy',
  'currency',
  'exchangeRate',
] as const;

const LINE_FIELDS = [
  'lineNumber',
  'poLineId',
  'quantity',
  'unitPrice',
  'glAccount',
  'taxCodeId',
  'taxInclusive',
] as const;

/** Return the approval-relevant fields that changed. Descriptions are intentionally excluded. */
export function changedMaterialInvoiceFields(
  previous: MaterialInvoiceState,
  next: MaterialInvoiceState,
): string[] {
  const changed: string[] = HEADER_FIELDS.filter((field) => previous[field] !== next[field]);
  const previousLines = new Map(previous.lines.map((line) => [line.id, line]));
  const nextLines = new Map(next.lines.map((line) => [line.id, line]));
  if (previousLines.size !== nextLines.size) return [...changed, 'lines'];

  for (const [id, previousLine] of previousLines) {
    const nextLine = nextLines.get(id);
    if (!nextLine) return [...changed, 'lines'];
    for (const field of LINE_FIELDS) {
      if (previousLine[field] !== nextLine[field]) changed.push(`lines.${field}`);
    }
  }
  return [...new Set(changed)];
}
