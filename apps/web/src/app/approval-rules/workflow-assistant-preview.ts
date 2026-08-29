import type {
  WorkflowAssistantSnapshot,
  WorkflowEdge,
  WorkflowGraphPatchOperation,
  WorkflowNode,
} from '@betterspend/shared';

export interface WorkflowPatchPreviewItem {
  key: string;
  action: 'Add' | 'Update' | 'Remove' | 'Set';
  subject: 'node' | 'edge' | 'entry';
  title: string;
  before?: string;
  after?: string;
  consequence?: string;
}

function nodeValue(node: WorkflowNode): string {
  return JSON.stringify({
    name: node.name,
    type: node.type,
    enabled: !node.disabled,
    config: node.config,
  });
}

function edgeValue(edge: WorkflowEdge): string {
  return JSON.stringify({
    route: `${edge.sourceNodeId}.${edge.sourceHandle} -> ${edge.targetNodeId}.${edge.targetHandle}`,
    default: edge.isDefault,
    condition: edge.condition,
    priority: edge.priority,
  });
}

/** Builds a sequential, human-reviewable view of the typed operations. */
export function buildWorkflowPatchPreview(
  snapshot: WorkflowAssistantSnapshot,
  operations: readonly WorkflowGraphPatchOperation[],
): WorkflowPatchPreviewItem[] {
  const nodes = new Map(snapshot.graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(snapshot.graph.edges.map((edge) => [edge.id, edge]));
  let entryNodeId = snapshot.graph.entryNodeId;

  return operations.map((operation, index) => {
    switch (operation.type) {
      case 'add_node': {
        nodes.set(operation.node.id, operation.node);
        return {
          key: `${index}-add-node-${operation.node.id}`,
          action: 'Add',
          subject: 'node',
          title: operation.node.id,
          after: nodeValue(operation.node),
        };
      }
      case 'update_node': {
        const before = nodes.get(operation.nodeId);
        nodes.set(operation.nodeId, operation.node);
        return {
          key: `${index}-update-node-${operation.nodeId}`,
          action: 'Update',
          subject: 'node',
          title: operation.nodeId,
          before: before ? nodeValue(before) : 'Missing node',
          after: nodeValue(operation.node),
        };
      }
      case 'remove_node': {
        const before = nodes.get(operation.nodeId);
        const connectedEdges = [...edges.values()].filter(
          (edge) =>
            edge.sourceNodeId === operation.nodeId || edge.targetNodeId === operation.nodeId,
        );
        nodes.delete(operation.nodeId);
        for (const edge of connectedEdges) edges.delete(edge.id);
        return {
          key: `${index}-remove-node-${operation.nodeId}`,
          action: 'Remove',
          subject: 'node',
          title: operation.nodeId,
          before: before ? nodeValue(before) : 'Missing node',
          consequence:
            connectedEdges.length > 0
              ? `Also removes ${connectedEdges.length} connected edge${connectedEdges.length === 1 ? '' : 's'}: ${connectedEdges.map((edge) => edge.id).join(', ')}`
              : undefined,
        };
      }
      case 'add_edge': {
        edges.set(operation.edge.id, operation.edge);
        return {
          key: `${index}-add-edge-${operation.edge.id}`,
          action: 'Add',
          subject: 'edge',
          title: operation.edge.id,
          after: edgeValue(operation.edge),
        };
      }
      case 'update_edge': {
        const before = edges.get(operation.edgeId);
        edges.set(operation.edgeId, operation.edge);
        return {
          key: `${index}-update-edge-${operation.edgeId}`,
          action: 'Update',
          subject: 'edge',
          title: operation.edgeId,
          before: before ? edgeValue(before) : 'Missing edge',
          after: edgeValue(operation.edge),
        };
      }
      case 'remove_edge': {
        const before = edges.get(operation.edgeId);
        edges.delete(operation.edgeId);
        return {
          key: `${index}-remove-edge-${operation.edgeId}`,
          action: 'Remove',
          subject: 'edge',
          title: operation.edgeId,
          before: before ? edgeValue(before) : 'Missing edge',
        };
      }
      case 'set_entry': {
        const before = entryNodeId;
        entryNodeId = operation.nodeId;
        return {
          key: `${index}-set-entry-${operation.nodeId}`,
          action: 'Set',
          subject: 'entry',
          title: 'Entry node',
          before,
          after: operation.nodeId,
        };
      }
    }
  });
}
