import { z } from 'zod';

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a calendar date in YYYY-MM-DD format')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Expected a valid calendar date');

const decimalNumber = (scale: number) =>
  z
    .number()
    .finite()
    .refine((value) => {
      const scaled = value * 10 ** scale;
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
      return Math.abs(scaled - Math.round(scaled)) <= tolerance;
    }, `Expected at most ${scale} decimal places`);

const invoiceLineEditSchema = z
  .object({
    id: z.string().uuid(),
    lineNumber: z.number().int().positive().max(1_000_000).optional(),
    poLineId: z.string().uuid().nullable().optional(),
    description: z.string().trim().min(1).max(500).optional(),
    quantity: decimalNumber(2).positive().max(99_999_999.99).optional(),
    unitPrice: decimalNumber(2).nonnegative().max(9_999_999_999.99).optional(),
    glAccount: z.string().trim().min(1).max(50).nullable().optional(),
    taxCodeId: z.string().uuid().nullable().optional(),
    taxInclusive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'id'), {
    message: 'Each invoice line edit must change at least one field',
  });

export const updateInvoiceSchema = z
  .object({
    vendorId: z.string().uuid().optional(),
    invoiceDate: dateOnlySchema.optional(),
    dueDate: dateOnlySchema.nullable().optional(),
    paymentTerms: z.string().trim().min(1).max(20).nullable().optional(),
    earlyPaymentDiscountPercent: decimalNumber(2).min(0).max(100).nullable().optional(),
    earlyPaymentDiscountBy: dateOnlySchema.nullable().optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, 'Currency must be a 3-letter code')
      .transform((value) => value.toUpperCase())
      .optional(),
    exchangeRate: decimalNumber(8).positive().max(9_999_999_999).optional(),
    lines: z.array(invoiceLineEditSchema).max(1_000).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Invoice edit must change at least one field',
  });

export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
