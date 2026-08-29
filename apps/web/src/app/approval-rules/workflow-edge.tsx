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
  canInsert: boolean;
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
  label,
  labelStyle,
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
      {label || data?.canInsert ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex items-center gap-1.5"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
          >
            {label ? (
              <span
                className="border border-white/15 bg-black px-1.5 py-0.5 text-[9px] text-zinc-300"
                style={labelStyle}
              >
                {label}
              </span>
            ) : null}
            {data?.canInsert ? (
              <button
                type="button"
                aria-label="Insert step on route"
                onClick={(event) => {
                  event.stopPropagation();
                  data.onInsert(id);
                }}
                className="grid size-5 place-items-center border border-white/30 bg-black text-zinc-300 shadow-lg hover:border-orange-300 hover:text-orange-200 focus-visible:ring-orange-300"
                style={{ pointerEvents: 'all' }}
              >
                <Plus className="size-3" />
              </button>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const WORKFLOW_EDGE_TYPES = { workflow: WorkflowEdge };
