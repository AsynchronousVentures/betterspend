import { z } from 'zod';
import { workflowDomainSchema, workflowGraphSchema } from './graph';

export const workflowNodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const workflowDraftSchema = z.object({
  graph: workflowGraphSchema,
  positions: z.record(z.string(), workflowNodePositionSchema).default({}),
});

export const createWorkflowDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(255),
  domain: workflowDomainSchema,
  entityId: z.string().uuid().nullable().optional(),
  draft: workflowDraftSchema.optional(),
});

export const updateWorkflowDraftSchema = z.object({
  draft: workflowDraftSchema,
});

export type WorkflowNodePosition = z.infer<typeof workflowNodePositionSchema>;
export type WorkflowDraft = z.infer<typeof workflowDraftSchema>;
export type CreateWorkflowDefinitionInput = z.infer<typeof createWorkflowDefinitionSchema>;
