const DECIMAL_AMOUNT = /^(-?)(\d+)(?:\.(\d+))?$/;

type SignedInteger = {
  negative: boolean;
  digits: string;
};

type DecimalAmount = SignedInteger & {
  scale: number;
};

function currencyFractionDigits(currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

function trimLeadingZeroes(value: string) {
  return value.replace(/^0+(?=\d)/, '');
}

function normalizedInteger(negative: boolean, digits: string): SignedInteger {
  const normalizedDigits = trimLeadingZeroes(digits) || '0';
  return { negative: negative && normalizedDigits !== '0', digits: normalizedDigits };
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

function compareIntegerStrings(left: string, right: string) {
  if (left.length !== right.length) return left.length - right.length;
  return left.localeCompare(right);
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

function subtractIntegerStrings(left: string, right: string) {
  const digits: string[] = [];
  let borrow = 0;
  let leftIndex = left.length - 1;
  let rightIndex = right.length - 1;

  while (leftIndex >= 0) {
    let difference = Number(left[leftIndex]) - borrow - (rightIndex >= 0 ? Number(right[rightIndex]) : 0);
    if (difference < 0) {
      difference += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }
    digits.push(String(difference));
    leftIndex -= 1;
    rightIndex -= 1;
  }

  return trimLeadingZeroes(digits.reverse().join('')) || '0';
}

function addSignedIntegers(left: SignedInteger, right: SignedInteger): SignedInteger {
  if (left.negative === right.negative) {
    return normalizedInteger(left.negative, addIntegerStrings(left.digits, right.digits));
  }

  const comparison = compareIntegerStrings(left.digits, right.digits);
  if (comparison === 0) return { negative: false, digits: '0' };

  return comparison > 0
    ? normalizedInteger(left.negative, subtractIntegerStrings(left.digits, right.digits))
    : normalizedInteger(right.negative, subtractIntegerStrings(right.digits, left.digits));
}

function parseDecimal(value: string): DecimalAmount {
  const match = DECIMAL_AMOUNT.exec(value);
  if (!match) return { negative: false, digits: '0', scale: 0 };

  const [, sign, whole, fraction = ''] = match;
  const amount = normalizedInteger(sign === '-', `${whole}${fraction}`);
  return { ...amount, scale: fraction.length };
}

/** Rounds an exact aggregate half up to the display currency's minor units. */
function roundToMinorUnits(amount: SignedInteger, sourceScale: number, fractionDigits: number): SignedInteger {
  if (sourceScale <= fractionDigits) {
    return normalizedInteger(amount.negative, `${amount.digits}${'0'.repeat(fractionDigits - sourceScale)}`);
  }

  const paddedDigits = amount.digits.padStart(sourceScale + 1, '0');
  const keptDigits = paddedDigits.slice(0, -sourceScale + fractionDigits) || '0';
  const discardedDigits = paddedDigits.slice(-sourceScale + fractionDigits);
  const roundedDigits = discardedDigits[0] >= '5' ? increment(keptDigits) : keptDigits;

  return normalizedInteger(amount.negative, roundedDigits);
}

/** Sums API decimal strings before applying the display currency's rounding rule. */
export function sumCurrencyAmounts(values: readonly string[], currency: string) {
  const amounts = values.map(parseDecimal);
  const sourceScale = Math.max(0, ...amounts.map((amount) => amount.scale));
  const total = amounts.reduce<SignedInteger>(
    (sum, amount) =>
      addSignedIntegers(sum, normalizedInteger(amount.negative, `${amount.digits}${'0'.repeat(sourceScale - amount.scale)}`)),
    { negative: false, digits: '0' },
  );
  const rounded = roundToMinorUnits(total, sourceScale, currencyFractionDigits(currency));

  return `${rounded.negative ? '-' : ''}${rounded.digits}`;
}

/** Formats exact minor units without converting a potentially large total to Number. */
export function formatCurrencyMinorUnits(amount: string, currency: string) {
  const fractionDigits = currencyFractionDigits(currency);
  const negative = amount.startsWith('-');
  const absoluteAmount = (negative ? amount.slice(1) : amount).padStart(fractionDigits + 1, '0');
  const whole = fractionDigits === 0 ? absoluteAmount : absoluteAmount.slice(0, -fractionDigits);
  const fraction = fractionDigits === 0 ? '' : absoluteAmount.slice(-fractionDigits);
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  const integer = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const template = formatter.formatToParts(negative ? -1 : 0);

  return template
    .map((part) => {
      if (part.type === 'integer') return integer;
      if (part.type === 'fraction') return fraction;
      return part.value;
    })
    .join('');
}
