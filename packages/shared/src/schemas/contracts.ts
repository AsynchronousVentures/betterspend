import { z } from 'zod';

export const CONTRACT_TYPES = [
  'msa',
  'sow',
  'nda',
  'sla',
  'purchase_agreement',
  'framework',
  'other',
] as const;
export const CONTRACT_STATUSES = [
  'draft',
  'pending_approval',
  'active',
  'expiring_soon',
  'expired',
  'terminated',
  'cancelled',
] as const;

export const contractSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  type: z.enum(CONTRACT_TYPES).default('purchase_agreement'),
  vendorId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  totalValue: z.string().optional(),
  currency: z.string().length(3).default('USD'),
  paymentTerms: z.string().max(100).optional(),
  autoRenew: z.boolean().default(false),
  renewalNoticeDays: z.number().int().min(1).default(30),
  renewalTermMonths: z.number().int().min(1).optional(),
  terms: z.string().optional(),
  internalNotes: z.string().optional(),
});

export type ContractInput = z.infer<typeof contractSchema>;

export const contractLineSchema = z.object({
  lineNumber: z.number().int().min(1),
  description: z.string().min(1).max(500),
  quantity: z.string().optional(),
  unitOfMeasure: z.string().max(50).optional(),
  unitPrice: z.string().optional(),
  totalPrice: z.string().optional(),
});

export const contractAmendmentSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  effectiveDate: z.string().datetime({ offset: true }).optional(),
  valueChange: z.string().optional(),
  newEndDate: z.string().datetime({ offset: true }).optional(),
});

export const contractObligationNotificationLeadDaysSchema = z.number().int().min(0);

const CONTRACT_OBLIGATION_STATUSES = ['open', 'completed'] as const;

function isValidContractObligationDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth =
    month === 2 ? (isLeapYear ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day <= daysInMonth;
}

const contractObligationDueDateSchema = z
  .string()
  .datetime({ offset: true })
  .refine(isValidContractObligationDateTime, 'Expected a valid calendar date');

const contractObligationDateSchema = z
  .date()
  .refine((value) => Number.isFinite(value.getTime()), 'Expected a valid calendar date');

export const createContractObligationSchema = z.object({
  obligationType: z.string(),
  title: z.string(),
  description: z.string(),
  dueDate: contractObligationDateSchema.optional(),
  recurrence: z.string().optional(),
  notificationLeadDays: contractObligationNotificationLeadDaysSchema.default(30),
  sourceReference: z.string(),
  sourceClauseType: z.string().optional(),
});

export const updateContractObligationSchema = z.object({
  status: z.enum(CONTRACT_OBLIGATION_STATUSES).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  dueDate: contractObligationDueDateSchema.nullable().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  notificationLeadDays: contractObligationNotificationLeadDaysSchema.optional(),
});

export type CreateContractObligationInput = z.infer<typeof createContractObligationSchema>;
export type UpdateContractObligationInput = z.infer<typeof updateContractObligationSchema>;
