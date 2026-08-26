import { z } from 'zod';

const MONEY_SCALE = 2;
const QUANTITY_SCALE = 2;
const MAX_TOTAL_UNITS = 99_999_999_999_999n;
const MAX_UNIT_PRICE_UNITS = 999_999_999_999n;
const MAX_QUANTITY_UNITS = 9_999_999_999n;
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

export const recurringPoFrequencySchema = z.enum(['weekly', 'monthly', 'quarterly', 'annually']);
export type RecurringPoFrequency = z.infer<typeof recurringPoFrequencySchema>;

function decimalUnits(value: string, scale: number): bigint | null {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) return null;

  const [, whole, fraction = ''] = match;
  if (fraction.length > scale) return null;
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0'));
}

function formatDecimal(units: bigint, scale: number): string {
  const factor = 10n ** BigInt(scale);
  return `${units / factor}.${(units % factor).toString().padStart(scale, '0')}`;
}

function decimalSchema(scale: number, maxUnits: bigint, label: string, requirePositive = false) {
  return z
    .union([z.string(), z.number().finite()])
    .transform((value) => (typeof value === 'number' ? value.toString() : value.trim()))
    .refine((value) => decimalUnits(value, scale) !== null, {
      message: `${label} must be a decimal with at most ${scale} decimal places`,
    })
    .refine(
      (value) => {
        const units = decimalUnits(value, scale);
        return units !== null && units <= maxUnits;
      },
      { message: `${label} exceeds the supported range` },
    )
    .refine(
      (value) => {
        const units = decimalUnits(value, scale);
        return !requirePositive || (units !== null && units > 0n);
      },
      { message: `${label} must be greater than zero` },
    )
    .transform((value) => formatDecimal(decimalUnits(value, scale) ?? 0n, scale));
}

const recurringPoLineSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity: decimalSchema(QUANTITY_SCALE, MAX_QUANTITY_UNITS, 'Quantity', true),
    unitPrice: decimalSchema(MONEY_SCALE, MAX_UNIT_PRICE_UNITS, 'Unit price'),
    unitOfMeasure: z.string().trim().min(1).max(50).optional(),
  })
  .strict();

export const recurringPoLinesSchema = z.array(recurringPoLineSchema).min(1).max(1_000);

const calendarDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be a valid ISO calendar date')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;

    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth =
      month === 2 ? (isLeapYear ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
    return day <= daysInMonth;
  }, 'Start date must be a valid calendar date');

const recurringPoFields = {
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(10_000).optional(),
  vendorId: z.string().uuid().optional(),
  frequency: recurringPoFrequencySchema,
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  totalAmount: decimalSchema(MONEY_SCALE, MAX_TOTAL_UNITS, 'Total amount').optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Currency must be a 3-letter code')
    .transform((value) => value.toUpperCase())
    .optional(),
  lines: recurringPoLinesSchema,
  glAccount: z.string().trim().min(1).max(50).optional(),
  notes: z.string().trim().min(1).max(10_000).optional(),
  maxRuns: z.number().int().positive().max(1_000_000).optional(),
  startDate: calendarDateSchema.optional(),
};

function totalMatchesLines(
  value: { totalAmount?: string; lines?: readonly RecurringPoLine[] },
  context: z.RefinementCtx,
) {
  if (value.totalAmount === undefined || value.lines === undefined) return;

  let subtotal: string;
  try {
    subtotal = calculateRecurringPoAmounts(value.lines).subtotal;
  } catch {
    return;
  }
  if (value.totalAmount !== subtotal) {
    context.addIssue({
      code: 'custom',
      path: ['totalAmount'],
      message: `Total amount must equal the line total (${subtotal})`,
    });
  }
}

export const createRecurringPoSchema = z
  .object(recurringPoFields)
  .strict()
  .superRefine(totalMatchesLines);
export const updateRecurringPoSchema = z
  .object({
    title: recurringPoFields.title.optional(),
    description: recurringPoFields.description,
    vendorId: recurringPoFields.vendorId,
    active: z.boolean().optional(),
    frequency: recurringPoFields.frequency.optional(),
    dayOfMonth: recurringPoFields.dayOfMonth,
    totalAmount: recurringPoFields.totalAmount.optional(),
    currency: recurringPoFields.currency,
    lines: recurringPoFields.lines.optional(),
    glAccount: recurringPoFields.glAccount,
    notes: recurringPoFields.notes,
    maxRuns: recurringPoFields.maxRuns,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Recurring PO update must change a field')
  .superRefine((value, context) => {
    if (value.totalAmount !== undefined && value.lines === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['totalAmount'],
        message: 'Update line items to change the recurring PO total',
      });
    }
    totalMatchesLines(value, context);
  });

export type CreateRecurringPoInput = z.infer<typeof createRecurringPoSchema>;
export type UpdateRecurringPoInput = z.infer<typeof updateRecurringPoSchema>;
export type RecurringPoLine = z.infer<typeof recurringPoLineSchema>;

/** Round each quantity-times-price line to currency precision before summing. */
export function calculateRecurringPoAmounts(lines: readonly RecurringPoLine[]) {
  let subtotalUnits = 0n;
  const lineTotals = lines.map((line) => {
    const quantityUnits = decimalUnits(line.quantity, QUANTITY_SCALE);
    const unitPriceUnits = decimalUnits(line.unitPrice, MONEY_SCALE);
    if (quantityUnits === null || unitPriceUnits === null) {
      throw new Error('Recurring PO lines contain invalid decimal values');
    }

    const lineTotalUnits = (quantityUnits * unitPriceUnits + 50n) / 100n;
    if (lineTotalUnits > MAX_TOTAL_UNITS) {
      throw new Error('Recurring PO line total exceeds the supported range');
    }
    subtotalUnits += lineTotalUnits;
    if (subtotalUnits > MAX_TOTAL_UNITS) {
      throw new Error('Recurring PO total exceeds the supported range');
    }
    return formatDecimal(lineTotalUnits, MONEY_SCALE);
  });

  return {
    lineTotals,
    subtotal: formatDecimal(subtotalUnits, MONEY_SCALE),
  };
}
