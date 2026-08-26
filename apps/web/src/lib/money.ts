const DECIMAL_AMOUNT = /^(\d+)(?:\.(\d+))?$/;

function currencyFractionDigits(currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

function trimLeadingZeroes(value: string) {
  return value.replace(/^0+(?=\d)/, '');
}

function increment(value: string) {
  const digits = value.split('');

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = digits[index];
    if (digit !== '9') {
      digits[index] = String(Number(digit) + 1);
      return digits.join('');
    }
    digits[index] = '0';
  }

  return `1${digits.join('')}`;
}

function addIntegerStrings(left: string, right: string) {
  const digits: string[] = [];
  let carry = 0;
  let leftIndex = left.length - 1;
  let rightIndex = right.length - 1;

  while (leftIndex >= 0 || rightIndex >= 0 || carry > 0) {
    const leftDigit = leftIndex >= 0 ? Number(left[leftIndex]) : 0;
    const rightDigit = rightIndex >= 0 ? Number(right[rightIndex]) : 0;
    const sum = leftDigit + rightDigit + carry;
    digits.push(String(sum % 10));
    carry = Math.floor(sum / 10);
    leftIndex -= 1;
    rightIndex -= 1;
  }

  return digits.reverse().join('');
}

/** Rounds extra decimal places half up before showing a currency total. */
function decimalToMinorUnits(value: string, fractionDigits: number) {
  const match = DECIMAL_AMOUNT.exec(value);
  if (!match) return '0';

  const [, whole, fraction = ''] = match;
  const keptFraction = fraction.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  const minorUnits = trimLeadingZeroes(`${whole}${keptFraction}`) || '0';

  return fraction[fractionDigits] >= '5' ? increment(minorUnits) : minorUnits;
}

/** Sums API decimal strings without converting them through binary floating point. */
export function sumCurrencyAmounts(values: readonly string[], currency: string) {
  const fractionDigits = currencyFractionDigits(currency);
  return values.reduce((total, value) => addIntegerStrings(total, decimalToMinorUnits(value, fractionDigits)), '0');
}

/** Formats exact minor units without converting a potentially large total to Number. */
export function formatCurrencyMinorUnits(amount: string, currency: string) {
  const fractionDigits = currencyFractionDigits(currency);
  const paddedAmount = amount.padStart(fractionDigits + 1, '0');
  const whole = fractionDigits === 0 ? paddedAmount : paddedAmount.slice(0, -fractionDigits);
  const fraction = fractionDigits === 0 ? '' : paddedAmount.slice(-fractionDigits);
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  const integer = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const template = formatter.formatToParts(0);

  return template
    .map((part) => {
      if (part.type === 'integer') return integer;
      if (part.type === 'fraction') return fraction;
      return part.value;
    })
    .join('');
}
