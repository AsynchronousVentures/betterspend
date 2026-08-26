import { z } from 'zod';

export const intakeConciergeWorkflowSchema = z.enum([
  'requisition',
  'rfq',
  'vendor_onboarding',
  'software_license',
]);

const routingAnswerSchema = z.string().trim().min(1);
const routingDateSchema = routingAnswerSchema.refine(
  (value) => !Number.isNaN(Date.parse(value)),
  'Expected a valid date',
);

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
