import { z } from 'zod';

export const SANCTIONS_STATUSES = ['untested', 'clear', 'flagged', 'manually_reviewed'] as const;

export const sanctionsStatusSchema = z.enum(SANCTIONS_STATUSES);

export const manualSanctionsReviewSchema = z.object({
  note: z.string().trim().min(1).max(5_000),
});

export const sanctionsIngestRequestSchema = z.object({
  source: z.enum(['ofac_sdn']).optional(),
});

export const sanctionsImportRowSchema = z.object({
  externalId: z.string().max(120).nullable(),
  entityName: z.string().min(2).max(500),
  entryType: z.string().max(40).nullable(),
  raw: z.object({ cells: z.array(z.string().max(1_000)).min(12).max(20) }),
});

export const sanctionMatchSchema = z.object({
  entryId: z.string().uuid(),
  source: z.string(),
  entityName: z.string(),
  country: z.string().nullable(),
  matchedOn: z.string(),
  score: z.number().min(0).max(1),
});

export const vendorScreeningStatusSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  onboardingStatus: z.string(),
  sanctionsStatus: sanctionsStatusSchema,
  sanctionsCheckedAt: z.string().datetime().nullable(),
  sanctionsNote: z.string().nullable(),
  contactInfo: z.unknown(),
});

export const vendorScreeningResultSchema = z.object({
  vendorId: z.string().uuid(),
  status: sanctionsStatusSchema,
  matches: z.array(sanctionMatchSchema),
});

export const screenAllVendorsResultSchema = z.object({
  screened: z.number().int().nonnegative(),
  flagged: z.number().int().nonnegative(),
});

export const sanctionsIngestResultSchema = z.object({
  count: z.number().int().nonnegative(),
  source: z.string(),
});

export type VendorScreeningStatus = z.infer<typeof vendorScreeningStatusSchema>;
