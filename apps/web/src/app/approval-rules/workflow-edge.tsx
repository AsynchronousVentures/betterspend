'use client';

import { Plus } from 'lucide-react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';

type WorkflowEdgeData = {
  onInsert: (edgeId: string) => void;
} & Record<string, unknown>;

export type WorkflowFlowEdge = Edge<WorkflowEdgeData, 'workflow'>;

export function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<WorkflowFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <button
          type="button"
          aria-label="Insert node on edge"
          onClick={(event) => {
            event.stopPropagation();
            data?.onInsert(id);
          }}
          className="nodrag nopan absolute grid size-5 place-items-center border border-white/30 bg-black text-zinc-300 shadow-lg hover:border-orange-300 hover:text-orange-200 focus-visible:ring-orange-300"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          <Plus className="size-3" />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

export const WORKFLOW_EDGE_TYPES = { workflow: WorkflowEdge };
