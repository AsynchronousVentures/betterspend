import { z } from 'zod';
import { executableDefinitionSchema } from './compile';
import { workflowDraftSchema } from './draft';
import { workflowGraphSchema } from './graph';

export const workflowDefinitionVersionRecordSchema = z.object({
  id: z.string().uuid(),
  definitionId: z.string().uuid(),
  organizationId: z.string().uuid(),
  version: z.number().int().positive(),
  graphJson: workflowGraphSchema,
  positionsJson: workflowDraftSchema.shape.positions,
  notesJson: workflowDraftSchema.shape.notes,
  executableJson: executableDefinitionSchema,
  publishedBy: z.string().uuid(),
  publishedAt: z.iso.datetime(),
});

export const workflowDefinitionRecordSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  entityId: z.string().uuid().nullable(),
  domain: workflowGraphSchema.shape.domain,
  name: z.string(),
  currentDraft: workflowDraftSchema,
  draftFence: z.number().int().nonnegative(),
  publishedVersionId: z.string().uuid().nullable(),
  publishedVersion: workflowDefinitionVersionRecordSchema.nullable(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const workflowDefinitionListResponseSchema = z.array(workflowDefinitionRecordSchema);
export const workflowDefinitionVersionListResponseSchema = z.array(
  workflowDefinitionVersionRecordSchema,
);
export const workflowDefinitionRestoreResponseSchema = z.object({
  definitionId: z.string().uuid(),
  restoredFromVersion: z.number().int().positive(),
  draft: workflowDraftSchema,
});

export type WorkflowDefinitionRecord = z.infer<typeof workflowDefinitionRecordSchema>;
export type WorkflowDefinitionVersionRecord = z.infer<typeof workflowDefinitionVersionRecordSchema>;
export type WorkflowDefinitionRestoreResponse = z.infer<
  typeof workflowDefinitionRestoreResponseSchema
>;
