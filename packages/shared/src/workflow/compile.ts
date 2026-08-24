import { z } from 'zod';
import {
  workflowEdgeSchema,
  workflowGraphSchema,
  type WorkflowEdge,
  type WorkflowGraph,
} from './graph';
import { workflowNodeIdSchema, workflowNodeSchema } from './node-types';
import { validateWorkflowGraph, type WorkflowValidationIssue } from './validate';

export const executableTransitionSchema = z.object({
  edgeId: workflowNodeIdSchema,
  targetStepId: workflowNodeIdSchema,
  sourceHandle: workflowEdgeSchema.shape.sourceHandle,
  condition: workflowEdgeSchema.shape.condition,
  priority: workflowEdgeSchema.shape.priority,
  isDefault: z.boolean(),
});

export const executableStepSchema = z.object({
  node: workflowNodeSchema.refine((node) => !node.disabled, {
    message: 'Executable steps cannot be disabled',
  }),
  transitions: z.array(executableTransitionSchema),
});

export const executableDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  domain: workflowGraphSchema.shape.domain,
  entryStepId: workflowNodeIdSchema,
  steps: z.array(executableStepSchema).min(1),
});

export type ExecutableTransition = z.infer<typeof executableTransitionSchema>;
export type ExecutableStep = z.infer<typeof executableStepSchema>;
export type ExecutableDefinition = z.infer<typeof executableDefinitionSchema>;

export type WorkflowCompilationResult =
  | {
      success: true;
      graph: WorkflowGraph;
      executable: ExecutableDefinition;
    }
  | {
      success: false;
      graph: WorkflowGraph | null;
      issues: WorkflowValidationIssue[];
    };

function resolveEnabledTargets(
  graph: WorkflowGraph,
  startNodeId: string,
  nodeById: Map<string, WorkflowGraph['nodes'][number]>,
  outgoingByNodeId: Map<string, WorkflowEdge[]>,
): string[] {
  const targets = new Set<string>();
  const visitedDisabled = new Set<string>();
  const pending = [startNodeId];

  while (pending.length > 0) {
    const nodeId = pending.shift()!;
    const node = nodeById.get(nodeId);
    if (!node) continue;
    if (!node.disabled) {
      targets.add(node.id);
      continue;
    }
    if (visitedDisabled.has(node.id)) continue;
    visitedDisabled.add(node.id);
    pending.push(...(outgoingByNodeId.get(node.id) ?? []).map((edge) => edge.targetNodeId));
  }

  return graph.nodes.filter((node) => targets.has(node.id)).map((node) => node.id);
}

function compareTransitions(left: ExecutableTransition, right: ExecutableTransition): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
  return (
    leftPriority - rightPriority ||
    Number(left.isDefault) - Number(right.isDefault) ||
    left.sourceHandle.localeCompare(right.sourceHandle) ||
    left.edgeId.localeCompare(right.edgeId) ||
    left.targetStepId.localeCompare(right.targetStepId)
  );
}

/** Compile a validated domain graph into the immutable artifact consumed by workflow instances. */
export function compileWorkflowGraph(input: unknown): WorkflowCompilationResult {
  const validation = validateWorkflowGraph(input);
  if (!validation.valid) {
    return { success: false, graph: validation.graph, issues: validation.issues };
  }

  const graph = validation.graph;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoingByNodeId = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    const outgoing = outgoingByNodeId.get(edge.sourceNodeId) ?? [];
    outgoing.push(edge);
    outgoingByNodeId.set(edge.sourceNodeId, outgoing);
  }

  const steps = validation.topologicalOrder.map((nodeId) => {
    const node = nodeById.get(nodeId)!;
    const transitions = (outgoingByNodeId.get(node.id) ?? []).flatMap((edge) =>
      resolveEnabledTargets(graph, edge.targetNodeId, nodeById, outgoingByNodeId).map(
        (targetStepId) => ({
          edgeId: edge.id,
          targetStepId,
          sourceHandle: edge.sourceHandle,
          ...(edge.condition ? { condition: edge.condition } : {}),
          ...(edge.priority !== undefined ? { priority: edge.priority } : {}),
          isDefault: edge.isDefault,
        }),
      ),
    );

    return { node, transitions: transitions.sort(compareTransitions) };
  });

  const executable = executableDefinitionSchema.parse({
    schemaVersion: 1,
    domain: graph.domain,
    entryStepId: graph.entryNodeId,
    steps,
  });
  return { success: true, graph, executable };
}
