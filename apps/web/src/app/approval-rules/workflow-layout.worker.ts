/// <reference lib="webworker" />

import ELK from 'elkjs/lib/elk.bundled.js';

type LayoutRequest = {
  nodes: Array<{ id: string; width: number; height: number }>;
  edges: Array<{ id: string; source: string; target: string }>;
};

type LayoutResponse = Record<string, { x: number; y: number }>;

const elk = new ELK();

self.onmessage = async (event: MessageEvent<LayoutRequest>) => {
  const graph = await elk.layout({
    id: 'workflow',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '48',
    },
    children: event.data.nodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
    })),
    edges: event.data.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });

  const positions: LayoutResponse = {};
  for (const node of graph.children ?? []) {
    positions[node.id] = { x: node.x ?? 0, y: node.y ?? 0 };
  }
  self.postMessage(positions);
};

export {};
