import type { WorkflowDraft } from '@betterspend/shared';

export interface MeasuredWorkflowNode {
  id: string;
  width: number;
  height: number;
}

/** Runs ELK off the main thread after React Flow has measured node dimensions. */
export function layoutWorkflow(
  draft: WorkflowDraft,
  measuredNodes: MeasuredWorkflowNode[],
): Promise<WorkflowDraft['positions']> {
  const worker = new Worker(new URL('./workflow-layout.worker.ts', import.meta.url), {
    type: 'module',
  });

  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkflowDraft['positions']>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Unable to auto-layout workflow'));
    };
    worker.postMessage({
      nodes: measuredNodes,
      edges: draft.graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
      })),
    });
  });
}
