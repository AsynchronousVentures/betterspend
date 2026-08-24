import { z } from 'zod';
import { workflowConditionSchema, workflowNodeIdSchema, workflowNodeSchema } from './node-types';

export const WORKFLOW_GRAPH_LIMITS = {
  nodes: 500,
  edges: 2_000,
} as const;

export const workflowEdgeSchema = z.object({
  id: workflowNodeIdSchema,
  sourceNodeId: workflowNodeIdSchema,
  sourceHandle: z.string().trim().min(1).max(100),
  targetNodeId: workflowNodeIdSchema,
  targetHandle: z.string().trim().min(1).max(100),
  isDefault: z.boolean().default(false),
  condition: workflowConditionSchema.optional(),
  priority: z.number().int().nonnegative().optional(),
});

export const workflowGraphSchema = z.object({
  schemaVersion: z.literal(1),
  domain: z.enum(['requisition', 'invoice', 'po_change']),
  entryNodeId: workflowNodeIdSchema,
  nodes: z.array(workflowNodeSchema).min(1).max(WORKFLOW_GRAPH_LIMITS.nodes),
  edges: z.array(workflowEdgeSchema).max(WORKFLOW_GRAPH_LIMITS.edges),
});

export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;
