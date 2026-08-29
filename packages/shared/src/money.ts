/** Decimal values accepted at application boundaries before persistence. */
export type DecimalInput = string | number;

const MONEY_SCALE = 2;
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/** Normalize a non-negative decimal to the currency's two-decimal scale. */
export function normalizeMoney(value: DecimalInput): string {
  return formatMoneyUnits(toMoneyUnits(value));
}

/** Multiply a quantity and unit price, rounding the resulting line to cents. */
export function multiplyMoney(quantity: DecimalInput, unitPrice: DecimalInput): string {
  const quantityUnits = toScaledUnits(quantity, MONEY_SCALE);
  const unitPriceUnits = toMoneyUnits(unitPrice);
  const lineUnits = (quantityUnits * unitPriceUnits + 50n) / 100n;
  return formatMoneyUnits(lineUnits);
}

/** Sum already-rounded monetary values without crossing through a float. */
export function sumMoney(values: readonly DecimalInput[]): string {
  const totalUnits = values.reduce((sum, value) => sum + toMoneyUnits(value), 0n);
  return formatMoneyUnits(totalUnits);
}

function toMoneyUnits(value: DecimalInput): bigint {
  return toScaledUnits(value, MONEY_SCALE);
}

function toScaledUnits(value: DecimalInput, scale: number): bigint {
  const text = typeof value === 'number' ? String(value) : value.trim();
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) throw new Error(`Invalid non-negative decimal "${text}"`);

  const [, whole, fraction = ''] = match;
  const factor = 10n ** BigInt(scale);
  const keptFraction = fraction.slice(0, scale).padEnd(scale, '0');
  let units = BigInt(whole) * factor + BigInt(keptFraction || '0');
  if (fraction[scale] && fraction[scale] >= '5') units += 1n;
  return units;
}

function formatMoneyUnits(units: bigint): string {
  const factor = 10n ** BigInt(MONEY_SCALE);
  return `${units / factor}.${(units % factor).toString().padStart(MONEY_SCALE, '0')}`;
}
