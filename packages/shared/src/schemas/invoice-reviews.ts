import { z } from 'zod';

export const INVOICE_REVIEW_CASE_STATES = [
  'open',
  'in_review',
  'waiting_on_supplier',
  'resolved',
] as const;

export const INVOICE_REVIEW_SIGNAL_SEVERITIES = [
  'informational',
  'review_required',
  'blocking',
] as const;

export const INVOICE_REVIEW_SIGNAL_STATUSES = ['open', 'resolved', 'waived'] as const;

export const INVOICE_REVIEW_SIGNAL_TYPES = [
  'low_extraction_confidence',
  'duplicate_risk',
  'sender_risk',
  'match_exception',
  'bank_detail_change_risk',
  'manual_review',
] as const;

export const INVOICE_REVIEW_PROVENANCE_SOURCE_TYPES = [
  'OCR',
  'email_intake',
  'supplier',
  'import',
  'PO',
  'catalog',
  'manual',
] as const;

export const INVOICE_REVIEW_PROVENANCE_HEADER_FIELDS = [
  'vendor',
  'invoiceNumber',
  'invoiceDate',
  'dueDate',
  'currency',
  'exchangeRate',
  'subtotal',
  'taxAmount',
  'totalAmount',
] as const;

export const INVOICE_REVIEW_PROVENANCE_LINE_FIELDS = [
  'description',
  'quantity',
  'unitPrice',
  'poLineId',
  'taxCodeId',
  'glAccount',
  'taxInclusive',
] as const;

export const invoiceReviewCaseStateSchema = z.enum(INVOICE_REVIEW_CASE_STATES);
export const invoiceReviewSignalSeveritySchema = z.enum(INVOICE_REVIEW_SIGNAL_SEVERITIES);
export const invoiceReviewSignalStatusSchema = z.enum(INVOICE_REVIEW_SIGNAL_STATUSES);
export const invoiceReviewSignalTypeSchema = z.enum(INVOICE_REVIEW_SIGNAL_TYPES);
export const invoiceReviewProvenanceSourceTypeSchema = z.enum(
  INVOICE_REVIEW_PROVENANCE_SOURCE_TYPES,
);

const invoiceReviewProvenanceLineFieldPathPattern = new RegExp(
  `^lines\\.([^.]+)\\.(${INVOICE_REVIEW_PROVENANCE_LINE_FIELDS.join('|')})$`,
);

const invoiceReviewProvenanceFieldPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .refine((fieldPath) => {
    if ((INVOICE_REVIEW_PROVENANCE_HEADER_FIELDS as readonly string[]).includes(fieldPath)) {
      return true;
    }
    const lineMatch = invoiceReviewProvenanceLineFieldPathPattern.exec(fieldPath);
    return lineMatch?.[1] !== undefined && z.string().uuid().safeParse(lineMatch[1]).success;
  }, 'Unsupported invoice provenance field path');

export const recordInvoiceReviewSignalSchema = z
  .object({
    organizationId: z.string().uuid(),
    invoiceId: z.string().uuid(),
    signalType: invoiceReviewSignalTypeSchema,
    sourceModule: z.string().trim().min(1).max(50),
    sourceRecordId: z.string().trim().min(1).max(255),
    severity: invoiceReviewSignalSeveritySchema,
    status: z.enum(['open', 'resolved']).default('open'),
    summary: z.string().trim().min(1).max(2_000),
    details: z.record(z.string(), z.unknown()).default({}),
    observedAt: z.coerce.date().optional(),
  })
  .strict();

export const recordInvoiceReviewProvenanceSchema = z
  .object({
    organizationId: z.string().uuid(),
    invoiceId: z.string().uuid(),
    invoiceLineId: z.string().uuid().nullable().default(null),
    fieldPath: invoiceReviewProvenanceFieldPathSchema,
    sourceType: invoiceReviewProvenanceSourceTypeSchema,
    sourceRecordId: z.string().trim().min(1).max(255),
    sourceTimestamp: z.coerce.date().nullable().default(null),
    confidence: z.number().finite().min(0).max(1).nullable().default(null),
    actorId: z.string().uuid().nullable().default(null),
    observedAt: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const lineMatch = invoiceReviewProvenanceLineFieldPathPattern.exec(input.fieldPath);
    if (lineMatch) {
      if (lineMatch[1]?.toLowerCase() !== input.invoiceLineId?.toLowerCase()) {
        context.addIssue({
          code: 'custom',
          path: ['invoiceLineId'],
          message: 'Invoice provenance line path must match invoiceLineId',
        });
      }
      return;
    }
    if (input.invoiceLineId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['invoiceLineId'],
        message: 'Header provenance cannot include invoiceLineId',
      });
    }
  });

export const invoiceReviewListQuerySchema = z.object({
  state: invoiceReviewCaseStateSchema.optional(),
  signalType: invoiceReviewSignalTypeSchema.optional(),
  severity: invoiceReviewSignalSeveritySchema.optional(),
  ownerId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  entityId: z.string().uuid().optional(),
  minAgeDays: z.coerce.number().int().min(0).max(3_650).optional(),
  sort: z.enum(['oldest_signal', 'due_date']).default('oldest_signal'),
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type InvoiceReviewCaseState = z.infer<typeof invoiceReviewCaseStateSchema>;
export type InvoiceReviewSignalSeverity = z.infer<typeof invoiceReviewSignalSeveritySchema>;
export type InvoiceReviewSignalStatus = z.infer<typeof invoiceReviewSignalStatusSchema>;
export type InvoiceReviewSignalType = z.infer<typeof invoiceReviewSignalTypeSchema>;
export type InvoiceReviewListQuery = z.infer<typeof invoiceReviewListQuerySchema>;
export type RecordInvoiceReviewSignalInput = z.input<typeof recordInvoiceReviewSignalSchema>;
export type InvoiceReviewProvenanceSourceType = z.infer<
  typeof invoiceReviewProvenanceSourceTypeSchema
>;
export type RecordInvoiceReviewProvenanceInput = z.input<
  typeof recordInvoiceReviewProvenanceSchema
>;
