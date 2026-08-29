import { z } from 'zod';
import { workflowDomainSchema, workflowGraphSchema } from './graph';
import { workflowDraftLeaseTokenSchema } from './lease';

export const workflowNodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const workflowCanvasNoteSchema = z.object({
  id: z.string().trim().min(1).max(100),
  text: z.string().trim().min(1).max(2_000),
  position: workflowNodePositionSchema,
});

export const workflowDraftSchema = z.object({
  graph: workflowGraphSchema,
  positions: z.record(z.string(), workflowNodePositionSchema).default({}),
  notes: z.array(workflowCanvasNoteSchema).default([]),
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

export const leasedWorkflowDraftUpdateSchema = z.object({
  draft: workflowDraftSchema,
  leaseToken: workflowDraftLeaseTokenSchema,
});

export type WorkflowNodePosition = z.infer<typeof workflowNodePositionSchema>;
export type WorkflowCanvasNote = z.infer<typeof workflowCanvasNoteSchema>;
export type WorkflowDraft = z.infer<typeof workflowDraftSchema>;
export type CreateWorkflowDefinitionInput = z.infer<typeof createWorkflowDefinitionSchema>;
