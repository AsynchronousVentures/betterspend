export type MoneyAmount = string | number | null | undefined;

export const DEFAULT_MONEY_CURRENCY = 'USD';
export const DEFAULT_MONEY_LOCALE = 'en-US';

const INVALID_AMOUNT_LABEL = 'Not available';
const CURRENCY_CODE = /^[A-Z]{3}$/;

/** Format a persisted monetary amount for human-facing output. */
export function formatMoney(
  amount: MoneyAmount,
  currency: string | null | undefined = DEFAULT_MONEY_CURRENCY,
  locale: string | null | undefined = DEFAULT_MONEY_LOCALE,
): string {
  const numericAmount = toFiniteNumber(amount);
  if (numericAmount === null) return INVALID_AMOUNT_LABEL;

  const normalizedCurrency = normalizeCurrency(currency);
  const normalizedLocale = locale?.trim() || DEFAULT_MONEY_LOCALE;

  try {
    return new Intl.NumberFormat(normalizedLocale, {
      style: 'currency',
      currency: normalizedCurrency,
    }).format(numericAmount);
  } catch {
    // Locale data is external input in email jobs. Preserve delivery when a
    // caller supplies an invalid locale, while keeping the currency visible.
    return `${numericAmount.toFixed(2)} ${normalizedCurrency}`;
  }
}

function toFiniteNumber(amount: MoneyAmount): number | null {
  if (amount === null || amount === undefined) return null;
  if (typeof amount === 'string' && amount.trim() === '') return null;

  const numericAmount = typeof amount === 'number' ? amount : Number(amount);
  return Number.isFinite(numericAmount) ? numericAmount : null;
}

function normalizeCurrency(currency: string | null | undefined): string {
  const normalizedCurrency = currency?.trim().toUpperCase();
  return normalizedCurrency && CURRENCY_CODE.test(normalizedCurrency)
    ? normalizedCurrency
    : DEFAULT_MONEY_CURRENCY;
}
