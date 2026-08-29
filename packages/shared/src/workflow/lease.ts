import { z } from 'zod';

export const workflowDraftLeaseSchema = z
  .object({
    definitionId: z.string().uuid(),
    holderUserId: z.string().uuid(),
    editorInstanceId: z.string().uuid(),
    holderName: z.string().trim().min(1).max(255),
    fence: z.number().int().positive(),
    acquiredAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const workflowDraftLeaseTokenSchema = z.string().trim().min(16).max(512);
export const workflowEditorInstanceIdSchema = z.string().uuid();
export const workflowDraftLeaseMetadataSchema = workflowDraftLeaseSchema.omit({
  editorInstanceId: true,
});

export const workflowDraftLeaseStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('available') }).strict(),
  z.object({ state: z.literal('held'), lease: workflowDraftLeaseMetadataSchema }).strict(),
  z
    .object({
      state: z.literal('owned'),
      lease: workflowDraftLeaseSchema,
      leaseToken: workflowDraftLeaseTokenSchema,
    })
    .strict(),
]);

export const workflowDraftLeaseMutationSchema = z
  .object({
    editorInstanceId: workflowEditorInstanceIdSchema,
    leaseToken: workflowDraftLeaseTokenSchema,
  })
  .strict();

export const workflowDraftLeaseAcquireSchema = z
  .object({ editorInstanceId: workflowEditorInstanceIdSchema })
  .strict();

export type WorkflowDraftLease = z.infer<typeof workflowDraftLeaseSchema>;
export type WorkflowDraftLeaseStatus = z.infer<typeof workflowDraftLeaseStatusSchema>;
export type WorkflowDraftLeaseMutation = z.infer<typeof workflowDraftLeaseMutationSchema>;
export type WorkflowDraftLeaseAcquire = z.infer<typeof workflowDraftLeaseAcquireSchema>;
