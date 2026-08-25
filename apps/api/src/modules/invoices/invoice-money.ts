interface InvoiceLineAmounts {
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
}

function parseUnits(value: string, scale: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > scale) {
    throw new Error(`Invalid scale-${scale} decimal "${value}"`);
  }
  const fraction = (match[2] ?? '').padEnd(scale, '0');
  return BigInt(match[1]) * 10n ** BigInt(scale) + BigInt(fraction || '0');
}

function formatUnits(units: bigint, scale: number): string {
  const divisor = 10n ** BigInt(scale);
  return `${units / divisor}.${(units % divisor).toString().padStart(scale, '0')}`;
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

/** Calculate persisted scale-2 line amounts without crossing through IEEE-754 arithmetic. */
export function calculateInvoiceLineAmounts(
  quantity: string,
  unitPrice: string,
  ratePercent: string,
  taxInclusive: boolean,
): InvoiceLineAmounts {
  const quantityUnits = parseUnits(quantity, 2);
  const unitPriceUnits = parseUnits(unitPrice, 2);
  const rateUnits = parseUnits(ratePercent, 2);
  const rawAmount = divideHalfUp(quantityUnits * unitPriceUnits, 100n);
  if (taxInclusive) {
    const subtotal = divideHalfUp(rawAmount * 10_000n, 10_000n + rateUnits);
    return {
      subtotal: formatUnits(subtotal, 2),
      taxAmount: formatUnits(rawAmount - subtotal, 2),
      totalAmount: formatUnits(rawAmount, 2),
    };
  }

  const taxAmount = divideHalfUp(rawAmount * rateUnits, 10_000n);
  return {
    subtotal: formatUnits(rawAmount, 2),
    taxAmount: formatUnits(taxAmount, 2),
    totalAmount: formatUnits(rawAmount + taxAmount, 2),
  };
}
