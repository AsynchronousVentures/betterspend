import { z } from 'zod';

export const intakeConciergeWorkflowSchema = z.enum([
  'requisition',
  'rfq',
  'vendor_onboarding',
  'software_license',
]);

const routingAnswerSchema = z.string().trim().min(1);

function isValidRoutingDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return false;

  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const routingDateSchema = routingAnswerSchema.refine(isValidRoutingDate, 'Expected a valid date');

/** Values a caller may provide when converting a concierge plan into its routed workflow. */
export const intakeConciergeAcceptedValuesSchema = z
  .object({
    neededBy: routingDateSchema.optional(),
    supplier: routingAnswerSchema.optional(),
    estimatedPrice: z.number().finite().positive().optional(),
    departmentId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    supplierShortlist: z.array(z.string().uuid()).min(1).optional(),
    licenseOwner: routingAnswerSchema.optional(),
    supplierContact: routingAnswerSchema.optional(),
  })
  .strict();

export const intakeConciergeConversionSchema = z
  .object({
    workflow: intakeConciergeWorkflowSchema.optional(),
    acceptedValues: intakeConciergeAcceptedValuesSchema.default({}),
  })
  .strict();

export type IntakeConciergeAcceptedValues = z.infer<typeof intakeConciergeAcceptedValuesSchema>;
export type IntakeConciergeConversionInput = z.infer<typeof intakeConciergeConversionSchema>;
