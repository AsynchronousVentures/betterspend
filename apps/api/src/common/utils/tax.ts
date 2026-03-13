export type TaxCodeLike = {
  id: string;
  ratePercent: string | number;
  isRecoverable: boolean;
};

export type TaxedLineInput = {
  quantity: number;
  unitPrice: number;
  taxInclusive?: boolean;
};

export type TaxedLineResult = {
  subtotal: number;
  taxAmount: number;
  total: number;
  recoverableTaxAmount: number;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function computeTaxedLine(
  line: TaxedLineInput,
  taxCode?: TaxCodeLike | null,
): TaxedLineResult {
  const quantity = Number(line.quantity || 0);
  const unitPrice = Number(line.unitPrice || 0);
  const gross = quantity * unitPrice;
  const rate = taxCode ? Number(taxCode.ratePercent || 0) / 100 : 0;

  if (!taxCode || rate <= 0) {
    return {
      subtotal: roundMoney(gross),
      taxAmount: 0,
      total: roundMoney(gross),
      recoverableTaxAmount: 0,
    };
  }

  if (line.taxInclusive) {
    const subtotal = gross / (1 + rate);
    const taxAmount = gross - subtotal;
    return {
      subtotal: roundMoney(subtotal),
      taxAmount: roundMoney(taxAmount),
      total: roundMoney(gross),
      recoverableTaxAmount: taxCode.isRecoverable ? roundMoney(taxAmount) : 0,
    };
  }

  const subtotal = gross;
  const taxAmount = subtotal * rate;
  return {
    subtotal: roundMoney(subtotal),
    taxAmount: roundMoney(taxAmount),
    total: roundMoney(subtotal + taxAmount),
    recoverableTaxAmount: taxCode.isRecoverable ? roundMoney(taxAmount) : 0,
  };
}
