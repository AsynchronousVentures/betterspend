import { z } from 'zod';
import { workflowDraftSchema, workflowNodePositionSchema } from './draft';
import { workflowEdgeSchema, workflowGraphSchema } from './graph';
import { workflowNodeSchema } from './node-types';
import { WORKFLOW_VALIDATION_CODES } from './validate';

export const workflowGraphPatchOperationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('add_node'),
      node: workflowNodeSchema,
      position: workflowNodePositionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('update_node'),
      nodeId: z.string().trim().min(1),
      node: workflowNodeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('remove_node'),
      nodeId: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('add_edge'),
      edge: workflowEdgeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('update_edge'),
      edgeId: z.string().trim().min(1),
      edge: workflowEdgeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('remove_edge'),
      edgeId: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('set_entry'),
      nodeId: z.string().trim().min(1),
    })
    .strict(),
]);

export type WorkflowGraphPatchOperation = z.infer<typeof workflowGraphPatchOperationSchema>;

export const workflowAssistantSnapshotSchema = z
  .object({
    graph: workflowGraphSchema,
    positions: workflowDraftSchema.shape.positions,
  })
  .strict();

export type WorkflowAssistantSnapshot = z.infer<typeof workflowAssistantSnapshotSchema>;

export const workflowAssistantProposalRequestSchema = workflowAssistantSnapshotSchema
  .extend({
    prompt: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type WorkflowAssistantProposalRequest = z.infer<
  typeof workflowAssistantProposalRequestSchema
>;

const workflowAssistantValidationIssueSchema = z
  .object({
    code: z.enum(WORKFLOW_VALIDATION_CODES),
    message: z.string(),
    path: z.array(z.union([z.string(), z.number()])),
    nodeIds: z.array(z.string()).optional(),
    edgeIds: z.array(z.string()).optional(),
  })
  .strict();

export const workflowAssistantProposalResponseSchema = z
  .object({
    summary: z.string().trim().min(1).max(1_000),
    operations: z.array(workflowGraphPatchOperationSchema).min(1).max(100),
    validation: z
      .object({
        valid: z.boolean(),
        issues: z.array(workflowAssistantValidationIssueSchema),
      })
      .strict(),
  })
  .strict();

export type WorkflowAssistantProposalResponse = z.infer<
  typeof workflowAssistantProposalResponseSchema
>;

function requireIndex(values: Array<{ id: string }>, id: string, kind: 'node' | 'edge'): number {
  const index = values.findIndex((value) => value.id === id);
  if (index < 0) throw new Error(`Cannot update missing workflow ${kind} ${id}`);
  return index;
}

/** Applies an already parsed proposal without mutating the submitted snapshot. */
export function applyWorkflowGraphPatch(
  input: WorkflowAssistantSnapshot,
  operations: readonly WorkflowGraphPatchOperation[],
): WorkflowAssistantSnapshot {
  let graph = {
    ...input.graph,
    nodes: [...input.graph.nodes],
    edges: [...input.graph.edges],
  };
  const positions = { ...input.positions };

  for (const operation of operations) {
    switch (operation.type) {
      case 'add_node': {
        if (graph.nodes.some((node) => node.id === operation.node.id)) {
          throw new Error(`Workflow node ${operation.node.id} already exists`);
        }
        graph = { ...graph, nodes: [...graph.nodes, operation.node] };
        positions[operation.node.id] = operation.position;
        break;
      }
      case 'update_node': {
        if (operation.node.id !== operation.nodeId) {
          throw new Error(`Updated workflow node ID must remain ${operation.nodeId}`);
        }
        const index = requireIndex(graph.nodes, operation.nodeId, 'node');
        const nodes = [...graph.nodes];
        nodes[index] = operation.node;
        graph = { ...graph, nodes };
        break;
      }
      case 'remove_node': {
        requireIndex(graph.nodes, operation.nodeId, 'node');
        graph = {
          ...graph,
          nodes: graph.nodes.filter((node) => node.id !== operation.nodeId),
          edges: graph.edges.filter(
            (edge) =>
              edge.sourceNodeId !== operation.nodeId && edge.targetNodeId !== operation.nodeId,
          ),
        };
        delete positions[operation.nodeId];
        break;
      }
      case 'add_edge': {
        if (graph.edges.some((edge) => edge.id === operation.edge.id)) {
          throw new Error(`Workflow edge ${operation.edge.id} already exists`);
        }
        graph = { ...graph, edges: [...graph.edges, operation.edge] };
        break;
      }
      case 'update_edge': {
        if (operation.edge.id !== operation.edgeId) {
          throw new Error(`Updated workflow edge ID must remain ${operation.edgeId}`);
        }
        const index = requireIndex(graph.edges, operation.edgeId, 'edge');
        const edges = [...graph.edges];
        edges[index] = operation.edge;
        graph = { ...graph, edges };
        break;
      }
      case 'remove_edge': {
        requireIndex(graph.edges, operation.edgeId, 'edge');
        graph = {
          ...graph,
          edges: graph.edges.filter((edge) => edge.id !== operation.edgeId),
        };
        break;
      }
      case 'set_entry': {
        if (!graph.nodes.some((node) => node.id === operation.nodeId)) {
          throw new Error(`Cannot set missing workflow node ${operation.nodeId} as entry`);
        }
        graph = { ...graph, entryNodeId: operation.nodeId };
        break;
      }
    }
  }

  return workflowAssistantSnapshotSchema.parse({ graph, positions });
}
