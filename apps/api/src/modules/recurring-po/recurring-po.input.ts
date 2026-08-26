import { BadRequestException } from '@nestjs/common';
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

const recurringPoLinesSchema = z.array(recurringPoLineSchema).min(1).max(1_000);

const dateInputSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Start date must be a valid date');

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
  startDate: dateInputSchema.optional(),
};

export const createRecurringPoSchema = z.object(recurringPoFields).strict();
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
  .refine((value) => Object.keys(value).length > 0, 'Recurring PO update must change a field');

export type CreateRecurringPoInput = z.infer<typeof createRecurringPoSchema>;
export type UpdateRecurringPoInput = z.infer<typeof updateRecurringPoSchema>;
export type RecurringPoLine = z.infer<typeof recurringPoLineSchema>;

function parseInput<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues[0]?.message ?? 'Invalid recurring PO request',
    );
  }
  return parsed.data;
}

export function parseRecurringPoCreateInput(body: unknown): CreateRecurringPoInput {
  const input = parseInput(createRecurringPoSchema, body);
  if (input.totalAmount !== undefined) {
    assertDeclaredTotalMatchesLines(input.totalAmount, input.lines);
  }
  return input;
}

export function parseRecurringPoUpdateInput(body: unknown): UpdateRecurringPoInput {
  const input = parseInput(updateRecurringPoSchema, body);
  if (input.totalAmount !== undefined && input.lines === undefined) {
    throw new BadRequestException('Update line items to change the recurring PO total');
  }
  if (input.totalAmount !== undefined && input.lines !== undefined) {
    assertDeclaredTotalMatchesLines(input.totalAmount, input.lines);
  }
  return input;
}

export function parseStoredRecurringPoLines(body: unknown): RecurringPoLine[] {
  return parseInput(recurringPoLinesSchema, body);
}

/** Round each quantity-times-price line to currency precision before summing. */
export function calculateRecurringPoAmounts(lines: readonly RecurringPoLine[]) {
  let subtotalUnits = 0n;
  const lineTotals = lines.map((line) => {
    const quantityUnits = decimalUnits(line.quantity, QUANTITY_SCALE);
    const unitPriceUnits = decimalUnits(line.unitPrice, MONEY_SCALE);
    if (quantityUnits === null || unitPriceUnits === null) {
      throw new BadRequestException('Recurring PO lines contain invalid decimal values');
    }

    const lineTotalUnits = (quantityUnits * unitPriceUnits + 50n) / 100n;
    if (lineTotalUnits > MAX_TOTAL_UNITS) {
      throw new BadRequestException('Recurring PO line total exceeds the supported range');
    }
    subtotalUnits += lineTotalUnits;
    if (subtotalUnits > MAX_TOTAL_UNITS) {
      throw new BadRequestException('Recurring PO total exceeds the supported range');
    }
    return formatDecimal(lineTotalUnits, MONEY_SCALE);
  });

  return {
    lineTotals,
    subtotal: formatDecimal(subtotalUnits, MONEY_SCALE),
  };
}

function assertDeclaredTotalMatchesLines(totalAmount: string, lines: readonly RecurringPoLine[]) {
  const { subtotal } = calculateRecurringPoAmounts(lines);
  if (totalAmount !== subtotal) {
    throw new BadRequestException(`Total amount must equal the line total (${subtotal})`);
  }
}
