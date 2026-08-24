import type { z } from 'zod';
import type {
  ApprovalNode,
  ApproverResolver,
  SeparationOfDuties,
  WorkflowNode,
} from './node-types';
import { isApprovalNode, TERMINAL_NODE_TYPES, WORKFLOW_NODE_PORTS } from './node-types';
import type { WorkflowEdge, WorkflowGraph } from './graph';
import { workflowGraphSchema } from './graph';

export const WORKFLOW_VALIDATION_CODES = [
  'invalid_graph',
  'duplicate_node_id',
  'duplicate_edge_id',
  'missing_entry',
  'multiple_entries',
  'invalid_entry',
  'unreachable_node',
  'missing_node_reference',
  'missing_handle',
  'missing_default_edge',
  'multiple_default_edges',
  'default_edge_mismatch',
  'missing_branch_condition',
  'invalid_branch_priority',
  'unwired_branch',
  'ambiguous_disabled_bypass',
  'zero_resolvers',
  'duplicate_resolver',
  'invalid_quorum',
  'invalid_separation_of_duties',
  'domain_trigger_mismatch',
  'missing_parent_node',
  'invalid_parent_node',
  'dead_end',
  'terminal_has_outgoing_edge',
  'cycle',
] as const;

export type WorkflowValidationCode = (typeof WORKFLOW_VALIDATION_CODES)[number];

export interface WorkflowValidationIssue {
  code: WorkflowValidationCode;
  message: string;
  path: Array<string | number>;
  nodeIds?: string[];
  edgeIds?: string[];
}

export type WorkflowValidationResult =
  | {
      valid: true;
      graph: WorkflowGraph;
      issues: [];
      topologicalOrder: string[];
    }
  | {
      valid: false;
      graph: WorkflowGraph | null;
      issues: WorkflowValidationIssue[];
      topologicalOrder: string[] | null;
    };

function zodIssueToValidationIssue(issue: z.core.$ZodIssue): WorkflowValidationIssue {
  return {
    code: 'invalid_graph',
    message: issue.message,
    path: issue.path.map((segment) =>
      typeof segment === 'symbol' ? (segment.description ?? String(segment)) : segment,
    ),
  };
}

function findDuplicateIds(values: Array<{ id: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) duplicates.add(value.id);
    seen.add(value.id);
  }
  return [...duplicates].sort();
}

function resolverIdentity(resolver: ApproverResolver): string {
  if (resolver.type === 'user') return `user:${resolver.userId}`;
  if (resolver.type === 'role') return `role:${resolver.scope}:${resolver.role}`;
  return `manager_chain:${resolver.maxLevels}`;
}

function validateSeparationOfDuties(
  node: ApprovalNode,
  resolvers: ApproverResolver[],
  config: SeparationOfDuties,
): WorkflowValidationIssue[] {
  if (!config.enabled) return [];

  const issues: WorkflowValidationIssue[] = [];
  if (config.exclude.length === 0) {
    issues.push({
      code: 'invalid_separation_of_duties',
      message: `Approval node ${node.id} enables separation of duties without excluding an actor`,
      path: ['nodes', node.id, 'config', 'separationOfDuties', 'exclude'],
      nodeIds: [node.id],
    });
  }
  if (config.fallbackResolvers.length === 0) {
    issues.push({
      code: 'invalid_separation_of_duties',
      message: `Approval node ${node.id} enables separation of duties without a fallback resolver`,
      path: ['nodes', node.id, 'config', 'separationOfDuties', 'fallbackResolvers'],
      nodeIds: [node.id],
    });
  }

  const primaryIdentities = new Set(resolvers.map(resolverIdentity));
  const duplicateFallback = config.fallbackResolvers.find((resolver) => {
    const identity = resolverIdentity(resolver);
    return primaryIdentities.has(identity);
  });
  if (duplicateFallback) {
    issues.push({
      code: 'invalid_separation_of_duties',
      message: `Approval node ${node.id} reuses a primary resolver as its separation-of-duties fallback`,
      path: ['nodes', node.id, 'config', 'separationOfDuties', 'fallbackResolvers'],
      nodeIds: [node.id],
    });
  }
  return issues;
}

function findCyclePaths(nodeIds: string[], outgoing: Map<string, string[]>): string[][] {
  const allowed = new Set(nodeIds);
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const recorded = new Set<string>();

  const visit = (nodeId: string) => {
    visited.add(nodeId);
    active.add(nodeId);
    stack.push(nodeId);

    for (const targetId of outgoing.get(nodeId) ?? []) {
      if (!allowed.has(targetId)) continue;
      if (!visited.has(targetId)) {
        visit(targetId);
        continue;
      }
      if (!active.has(targetId)) continue;

      const cycleStart = stack.lastIndexOf(targetId);
      const path = [...stack.slice(cycleStart), targetId];
      const members = [...new Set(path.slice(0, -1))].sort().join('|');
      if (!recorded.has(members)) {
        recorded.add(members);
        cycles.push(path);
      }
    }

    stack.pop();
    active.delete(nodeId);
  };

  for (const nodeId of [...nodeIds].sort()) {
    if (!visited.has(nodeId)) visit(nodeId);
  }
  return cycles;
}

function topologicalSort(
  nodeIds: string[],
  edges: Pick<WorkflowEdge, 'sourceNodeId' | 'targetNodeId'>[],
): { order: string[] | null; cyclePaths: string[][] } {
  const indegree = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  const outgoing = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  for (const edge of edges) {
    if (!indegree.has(edge.sourceNodeId) || !indegree.has(edge.targetNodeId)) continue;
    outgoing.get(edge.sourceNodeId)!.push(edge.targetNodeId);
    indegree.set(edge.targetNodeId, indegree.get(edge.targetNodeId)! + 1);
  }

  const ready = nodeIds.filter((nodeId) => indegree.get(nodeId) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const nodeId = ready.shift()!;
    order.push(nodeId);
    for (const targetId of outgoing.get(nodeId) ?? []) {
      const nextIndegree = indegree.get(targetId)! - 1;
      indegree.set(targetId, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(targetId);
        ready.sort();
      }
    }
  }

  if (order.length === nodeIds.length) return { order, cyclePaths: [] };
  const cyclicNodeIds = nodeIds.filter((nodeId) => !order.includes(nodeId));
  return { order: null, cyclePaths: findCyclePaths(cyclicNodeIds, outgoing) };
}

function reachableEnabledTargets(
  sourceNodeId: string,
  nodeById: Map<string, WorkflowNode>,
  outgoingEdges: Map<string, WorkflowEdge[]>,
): string[] {
  const reachable = new Set<string>();
  const visitedDisabled = new Set<string>();
  const pending = (outgoingEdges.get(sourceNodeId) ?? []).map((edge) => edge.targetNodeId);

  while (pending.length > 0) {
    const targetId = pending.shift()!;
    const target = nodeById.get(targetId);
    if (!target) continue;
    if (!target.disabled) {
      reachable.add(targetId);
      continue;
    }
    if (visitedDisabled.has(targetId)) continue;
    visitedDisabled.add(targetId);
    pending.push(...(outgoingEdges.get(targetId) ?? []).map((edge) => edge.targetNodeId));
  }

  return [...reachable];
}

export function validateWorkflowGraph(input: unknown): WorkflowValidationResult {
  const parsed = workflowGraphSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      graph: null,
      issues: parsed.error.issues.map(zodIssueToValidationIssue),
      topologicalOrder: null,
    };
  }

  const graph = parsed.data;
  const issues: WorkflowValidationIssue[] = [];
  const duplicateNodeIds = findDuplicateIds(graph.nodes);
  const duplicateEdgeIds = findDuplicateIds(graph.edges);
  if (duplicateNodeIds.length > 0) {
    issues.push({
      code: 'duplicate_node_id',
      message: `Duplicate node ids: ${duplicateNodeIds.join(', ')}`,
      path: ['nodes'],
      nodeIds: duplicateNodeIds,
    });
  }
  if (duplicateEdgeIds.length > 0) {
    issues.push({
      code: 'duplicate_edge_id',
      message: `Duplicate edge ids: ${duplicateEdgeIds.join(', ')}`,
      path: ['edges'],
      edgeIds: duplicateEdgeIds,
    });
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const triggerNodes = graph.nodes.filter((node) => node.type === 'trigger' && !node.disabled);
  if (triggerNodes.length === 0) {
    issues.push({
      code: 'missing_entry',
      message: 'Workflow must have one enabled trigger node',
      path: ['nodes'],
    });
  } else if (triggerNodes.length > 1) {
    issues.push({
      code: 'multiple_entries',
      message: 'Workflow has multiple enabled trigger nodes',
      path: ['nodes'],
      nodeIds: triggerNodes.map((node) => node.id),
    });
  }
  const entryNode = nodeById.get(graph.entryNodeId);
  if (!entryNode || entryNode.type !== 'trigger' || entryNode.disabled) {
    issues.push({
      code: 'invalid_entry',
      message: 'entryNodeId must reference the enabled trigger node',
      path: ['entryNodeId'],
      nodeIds: [graph.entryNodeId],
    });
  } else {
    const expectedEvent = {
      requisition: 'requisition_submitted',
      invoice: 'invoice_submitted',
      po_change: 'po_change_submitted',
    } as const;
    if (entryNode.config.event !== expectedEvent[graph.domain]) {
      issues.push({
        code: 'domain_trigger_mismatch',
        message: `Workflow domain ${graph.domain} cannot use trigger ${entryNode.config.event}`,
        path: ['nodes', entryNode.id, 'config', 'event'],
        nodeIds: [entryNode.id],
      });
    }
  }

  const outgoingEdges = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    if (!source || !target) {
      issues.push({
        code: 'missing_node_reference',
        message: `Edge ${edge.id} references a node that does not exist`,
        path: ['edges', edge.id],
        edgeIds: [edge.id],
        nodeIds: [edge.sourceNodeId, edge.targetNodeId],
      });
      continue;
    }

    const sourcePorts = WORKFLOW_NODE_PORTS[source.type].outputs as readonly string[];
    const targetPorts = WORKFLOW_NODE_PORTS[target.type].inputs as readonly string[];
    if (!sourcePorts.includes(edge.sourceHandle)) {
      issues.push({
        code: 'missing_handle',
        message: `Edge ${edge.id} references missing output ${edge.sourceHandle} on node ${source.id}`,
        path: ['edges', edge.id, 'sourceHandle'],
        edgeIds: [edge.id],
        nodeIds: [source.id],
      });
    }
    if (!targetPorts.includes(edge.targetHandle)) {
      issues.push({
        code: 'missing_handle',
        message: `Edge ${edge.id} references missing input ${edge.targetHandle} on node ${target.id}`,
        path: ['edges', edge.id, 'targetHandle'],
        edgeIds: [edge.id],
        nodeIds: [target.id],
      });
    }
    const outgoing = outgoingEdges.get(source.id) ?? [];
    outgoing.push(edge);
    outgoingEdges.set(source.id, outgoing);
  }

  if (entryNode) {
    const reachable = new Set<string>();
    const pending = [entryNode.id];
    while (pending.length > 0) {
      const nodeId = pending.shift()!;
      if (reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      pending.push(...(outgoingEdges.get(nodeId) ?? []).map((edge) => edge.targetNodeId));
    }
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        issues.push({
          code: 'unreachable_node',
          message: `Node ${node.id} is not reachable from the workflow entry`,
          path: ['nodes', node.id],
          nodeIds: [node.id],
        });
      }
    }
  }

  for (const node of graph.nodes) {
    const outgoing = outgoingEdges.get(node.id) ?? [];
    const declaredOutputs = WORKFLOW_NODE_PORTS[node.type].outputs as readonly string[];
    if (node.disabled) {
      const enabledTargets = reachableEnabledTargets(node.id, nodeById, outgoingEdges);
      if (declaredOutputs.length > 1 && enabledTargets.length !== 1) {
        issues.push({
          code: 'ambiguous_disabled_bypass',
          message: `Disabled branch node ${node.id} must resolve to exactly one enabled target`,
          path: ['nodes', node.id],
          nodeIds: [node.id, ...enabledTargets],
        });
      }
      continue;
    }

    if (declaredOutputs.length > 1) {
      for (const output of declaredOutputs) {
        if (!outgoing.some((edge) => edge.sourceHandle === output)) {
          issues.push({
            code: 'unwired_branch',
            message: `Node ${node.id} has no edge for output ${output}`,
            path: ['nodes', node.id],
            nodeIds: [node.id],
          });
        }
      }
    }

    if (node.type === 'condition') {
      const defaultEdges = outgoing.filter((edge) => edge.sourceHandle === 'default');
      const mismatchedDefaultEdges = outgoing.filter(
        (edge) => edge.isDefault !== (edge.sourceHandle === 'default'),
      );
      if (mismatchedDefaultEdges.length > 0) {
        issues.push({
          code: 'default_edge_mismatch',
          message: `Condition node ${node.id} has inconsistent default-edge markers`,
          path: ['nodes', node.id],
          nodeIds: [node.id],
          edgeIds: mismatchedDefaultEdges.map((edge) => edge.id),
        });
      }
      if (defaultEdges.length === 0) {
        issues.push({
          code: 'missing_default_edge',
          message: `Condition node ${node.id} has no default edge`,
          path: ['nodes', node.id],
          nodeIds: [node.id],
        });
      } else if (defaultEdges.length > 1) {
        issues.push({
          code: 'multiple_default_edges',
          message: `Condition node ${node.id} has multiple default edges`,
          path: ['nodes', node.id],
          nodeIds: [node.id],
          edgeIds: defaultEdges.map((edge) => edge.id),
        });
      }
      const branchEdges = outgoing.filter((edge) => edge.sourceHandle !== 'default');
      for (const edge of branchEdges) {
        if (!edge.condition) {
          issues.push({
            code: 'missing_branch_condition',
            message: `Branch edge ${edge.id} has no condition`,
            path: ['edges', edge.id, 'condition'],
            nodeIds: [node.id],
            edgeIds: [edge.id],
          });
        }
      }
      if (node.config.mode === 'first_true') {
        const edgesWithoutPriority = branchEdges.filter((edge) => edge.priority == null);
        const priorityCounts = new Map<number, number>();
        for (const edge of branchEdges) {
          if (edge.priority != null) {
            priorityCounts.set(edge.priority, (priorityCounts.get(edge.priority) ?? 0) + 1);
          }
        }
        const duplicatePriorities = new Set(
          [...priorityCounts].filter(([, count]) => count > 1).map(([priority]) => priority),
        );
        const duplicatePriorityEdges = branchEdges.filter(
          (edge) => edge.priority != null && duplicatePriorities.has(edge.priority),
        );
        const invalidPriorityEdges = [...edgesWithoutPriority, ...duplicatePriorityEdges];
        if (invalidPriorityEdges.length > 0) {
          issues.push({
            code: 'invalid_branch_priority',
            message: `First-true condition node ${node.id} requires a unique priority on each branch`,
            path: ['nodes', node.id],
            nodeIds: [node.id],
            edgeIds: invalidPriorityEdges.map((edge) => edge.id),
          });
        }
      }
    }

    if (isApprovalNode(node)) {
      const resolverIdentities = node.config.resolvers.map(resolverIdentity);
      const duplicateResolverIdentities = resolverIdentities.filter(
        (identity, index) => resolverIdentities.indexOf(identity) !== index,
      );
      if (duplicateResolverIdentities.length > 0) {
        issues.push({
          code: 'duplicate_resolver',
          message: `Approval node ${node.id} contains duplicate resolvers`,
          path: ['nodes', node.id, 'config', 'resolvers'],
          nodeIds: [node.id],
        });
      }
      if (node.config.resolvers.length === 0) {
        issues.push({
          code: 'zero_resolvers',
          message: `Approval node ${node.id} has no resolvers`,
          path: ['nodes', node.id, 'config', 'resolvers'],
          nodeIds: [node.id],
        });
      }
      if (
        node.type === 'approver_group' &&
        node.config.quorum.type === 'count' &&
        node.config.resolvers.every((resolver) => resolver.type === 'user') &&
        node.config.quorum.count > new Set(resolverIdentities).size
      ) {
        issues.push({
          code: 'invalid_quorum',
          message: `Approval node ${node.id} requires more approvals than it has resolvers`,
          path: ['nodes', node.id, 'config', 'quorum'],
          nodeIds: [node.id],
        });
      }
      issues.push(
        ...validateSeparationOfDuties(node, node.config.resolvers, node.config.separationOfDuties),
      );
    }

    if (node.type === 'escalation_timer') {
      const parent = nodeById.get(node.config.parentNodeId);
      if (!parent) {
        issues.push({
          code: 'missing_parent_node',
          message: `Escalation timer ${node.id} references missing parent ${node.config.parentNodeId}`,
          path: ['nodes', node.id, 'config', 'parentNodeId'],
          nodeIds: [node.id, node.config.parentNodeId],
        });
      } else if (parent.disabled || !isApprovalNode(parent)) {
        issues.push({
          code: 'invalid_parent_node',
          message: `Escalation timer ${node.id} must reference an enabled approval node`,
          path: ['nodes', node.id, 'config', 'parentNodeId'],
          nodeIds: [node.id, parent.id],
        });
      }
    }

    const terminal = (TERMINAL_NODE_TYPES as readonly string[]).includes(node.type);
    if (terminal && outgoing.length > 0) {
      issues.push({
        code: 'terminal_has_outgoing_edge',
        message: `Terminal node ${node.id} has an outgoing edge`,
        path: ['nodes', node.id],
        nodeIds: [node.id],
        edgeIds: outgoing.map((edge) => edge.id),
      });
    }
    if (!terminal && reachableEnabledTargets(node.id, nodeById, outgoingEdges).length === 0) {
      issues.push({
        code: 'dead_end',
        message: `Node ${node.id} has no path to an enabled downstream node`,
        path: ['nodes', node.id],
        nodeIds: [node.id],
      });
    }
  }

  const enabledNodeIds = new Set(
    graph.nodes.filter((node) => !node.disabled).map((node) => node.id),
  );
  const enabledEdges = [...enabledNodeIds].flatMap((sourceNodeId) =>
    reachableEnabledTargets(sourceNodeId, nodeById, outgoingEdges).map((targetNodeId) => ({
      sourceNodeId,
      targetNodeId,
    })),
  );
  const { order, cyclePaths } = topologicalSort(
    [...enabledNodeIds],
    enabledEdges,
  );
  for (const cyclePath of cyclePaths) {
    issues.push({
      code: 'cycle',
      message: `Workflow contains a cycle: ${cyclePath.join(' -> ')}`,
      path: cyclePath,
      nodeIds: cyclePath,
    });
  }

  if (issues.length > 0) {
    return { valid: false, graph, issues, topologicalOrder: order };
  }
  return { valid: true, graph, issues: [], topologicalOrder: order! };
}
