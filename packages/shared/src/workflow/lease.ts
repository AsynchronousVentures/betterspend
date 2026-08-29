import { z } from 'zod';

export const workflowDraftLeaseSchema = z
  .object({
    definitionId: z.string().uuid(),
    holderUserId: z.string().uuid(),
    holderName: z.string().trim().min(1).max(255),
    acquiredAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const workflowDraftLeaseTokenSchema = z.string().trim().min(16).max(512);

export const workflowDraftLeaseStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('available') }).strict(),
  z.object({ state: z.literal('held'), lease: workflowDraftLeaseSchema }).strict(),
  z
    .object({
      state: z.literal('owned'),
      lease: workflowDraftLeaseSchema,
      leaseToken: workflowDraftLeaseTokenSchema,
    })
    .strict(),
]);

export const workflowDraftLeaseMutationSchema = z
  .object({ leaseToken: workflowDraftLeaseTokenSchema })
  .strict();

export type WorkflowDraftLease = z.infer<typeof workflowDraftLeaseSchema>;
export type WorkflowDraftLeaseStatus = z.infer<typeof workflowDraftLeaseStatusSchema>;
export type WorkflowDraftLeaseMutation = z.infer<typeof workflowDraftLeaseMutationSchema>;
