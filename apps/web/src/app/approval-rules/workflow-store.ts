'use client';

import type { Connection } from '@xyflow/react';
import { create } from 'zustand';
import {
  WORKFLOW_NODE_PORTS,
  applyWorkflowGraphPatch,
  workflowDraftSchema,
  workflowEdgeSchema,
  type WorkflowAssistantProposalResponse,
  type WorkflowAssistantSnapshot,
  type WorkflowCanvasNote,
  type WorkflowDraft,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodePosition,
  type WorkflowNodeType,
} from '@betterspend/shared';
import { WORKFLOW_NODE_REGISTRY } from './workflow-node-registry';

export type WorkflowSelection =
  { kind: 'node'; id: string } | { kind: 'edge'; id: string } | { kind: 'note'; id: string } | null;

export interface PendingAssistantProposal {
  response: WorkflowAssistantProposalResponse;
  draftRevision: number;
  snapshot: WorkflowAssistantSnapshot;
}

type WorkflowBuilderState = {
  draft: WorkflowDraft | null;
  selection: WorkflowSelection;
  dirty: boolean;
  draftRevision: number;
  assistantProposal: PendingAssistantProposal | null;
  loadDraft: (draft: WorkflowDraft) => void;
  select: (selection: WorkflowSelection) => void;
  addNode: (type: WorkflowNodeType, position: WorkflowNodePosition) => string | null;
  insertNodeOnEdge: (edgeId: string, type: WorkflowNodeType) => string | null;
  replaceNode: (node: WorkflowNode) => boolean;
  removeNode: (nodeId: string) => void;
  connect: (connection: Connection) => string | null;
  replaceEdge: (edge: WorkflowEdge) => boolean;
  removeEdge: (edgeId: string) => void;
  moveNode: (nodeId: string, position: WorkflowNodePosition) => void;
  setPositions: (positions: WorkflowDraft['positions']) => void;
  addNote: (position: WorkflowNodePosition) => string;
  moveNote: (noteId: string, position: WorkflowNodePosition) => void;
  updateNote: (noteId: string, text: string) => void;
  removeNote: (noteId: string) => void;
  markSaved: (revision: number) => void;
  setAssistantProposal: (proposal: PendingAssistantProposal | null) => void;
  applyAssistantProposal: () => boolean;
};

let generatedId = 0;

function nextId(prefix: string): string {
  generatedId += 1;
  return `${prefix}-${Date.now().toString(36)}-${generatedId.toString(36)}`;
}

function mutateDraft(
  set: (partial: Partial<WorkflowBuilderState>) => void,
  state: WorkflowBuilderState,
  draft: WorkflowDraft,
  selection = state.selection,
) {
  set({
    draft,
    selection,
    dirty: true,
    draftRevision: state.draftRevision + 1,
  });
}

export function isValidWorkflowConnection(
  draft: WorkflowDraft | null,
  connection: Connection,
): boolean {
  if (!draft || connection.source === connection.target) return false;
  if (!connection.sourceHandle || !connection.targetHandle) return false;

  const source = draft.graph.nodes.find((node) => node.id === connection.source);
  const target = draft.graph.nodes.find((node) => node.id === connection.target);
  if (!source || !target) return false;

  const sourcePorts = WORKFLOW_NODE_PORTS[source.type].outputs as readonly string[];
  const targetPorts = WORKFLOW_NODE_PORTS[target.type].inputs as readonly string[];
  if (!sourcePorts.includes(connection.sourceHandle)) return false;
  if (!targetPorts.includes(connection.targetHandle)) return false;

  return !draft.graph.edges.some(
    (edge) =>
      edge.sourceNodeId === connection.source &&
      edge.sourceHandle === connection.sourceHandle &&
      edge.targetNodeId === connection.target &&
      edge.targetHandle === connection.targetHandle,
  );
}

function newEdge(draft: WorkflowDraft, connection: Connection) {
  const source = draft.graph.nodes.find((node) => node.id === connection.source);
  if (!source || !connection.sourceHandle || !connection.targetHandle) return null;

  return {
    id: nextId('edge'),
    sourceNodeId: connection.source,
    sourceHandle: connection.sourceHandle,
    targetNodeId: connection.target,
    targetHandle: connection.targetHandle,
    isDefault: source.type === 'condition' && connection.sourceHandle === 'default',
    ...(source.type === 'condition' && connection.sourceHandle === 'branch'
      ? {
          priority: draft.graph.edges.filter(
            (edge) => edge.sourceNodeId === source.id && edge.sourceHandle === 'branch',
          ).length,
        }
      : {}),
  };
}

export const useWorkflowBuilderStore = create<WorkflowBuilderState>((set, get) => ({
  draft: null,
  selection: null,
  dirty: false,
  draftRevision: 0,
  assistantProposal: null,

  loadDraft: (input) => {
    const draft = workflowDraftSchema.parse(input);
    const nextRevision = get().draftRevision + 1;
    set({
      draft,
      selection: draft.graph.nodes[0] ? { kind: 'node', id: draft.graph.nodes[0].id } : null,
      dirty: false,
      // Authoritative loads advance the identity so a late async proposal can never
      // become current merely because both drafts happened to be locally clean.
      draftRevision: nextRevision,
      assistantProposal: null,
    });
  },

  select: (selection) => set({ selection }),

  addNode: (type, position) => {
    const state = get();
    if (!state.draft || type === 'trigger') return null;
    const id = nextId(type.replaceAll('_', '-'));
    const definition = WORKFLOW_NODE_REGISTRY[type];
    if (!definition.domains.includes(state.draft.graph.domain)) return null;
    const node = definition.create(id, state.draft.graph.domain, state.draft.graph.nodes);
    mutateDraft(
      set,
      state,
      {
        ...state.draft,
        graph: { ...state.draft.graph, nodes: [...state.draft.graph.nodes, node] },
        positions: { ...state.draft.positions, [id]: position },
      },
      { kind: 'node', id },
    );
    return id;
  },

  insertNodeOnEdge: (edgeId, type) => {
    const state = get();
    if (!state.draft) return null;
    const edge = state.draft.graph.edges.find((candidate) => candidate.id === edgeId);
    const definition = WORKFLOW_NODE_REGISTRY[type];
    if (!edge || !definition || definition.ports.outputs.length !== 1) return null;

    const sourcePosition = state.draft.positions[edge.sourceNodeId] ?? { x: 0, y: 0 };
    const targetPosition = state.draft.positions[edge.targetNodeId] ?? {
      x: sourcePosition.x + 480,
      y: 0,
    };
    const position = {
      x: (sourcePosition.x + targetPosition.x) / 2,
      y: (sourcePosition.y + targetPosition.y) / 2,
    };
    const id = nextId(type.replaceAll('_', '-'));
    const node = definition.create(id, state.draft.graph.domain, state.draft.graph.nodes);
    const [output] = definition.ports.outputs;
    const [input] = definition.ports.inputs;
    if (!output || !input) return null;

    const firstEdge = { ...edge, targetNodeId: id, targetHandle: input };
    const secondEdge = {
      id: nextId('edge'),
      sourceNodeId: id,
      sourceHandle: output,
      targetNodeId: edge.targetNodeId,
      targetHandle: edge.targetHandle,
      isDefault: false,
    };
    mutateDraft(
      set,
      state,
      {
        ...state.draft,
        graph: {
          ...state.draft.graph,
          nodes: [...state.draft.graph.nodes, node],
          edges: state.draft.graph.edges.flatMap((candidate) =>
            candidate.id === edgeId ? [firstEdge, secondEdge] : [candidate],
          ),
        },
        positions: { ...state.draft.positions, [id]: position },
      },
      { kind: 'node', id },
    );
    return id;
  },

  replaceNode: (node) => {
    const state = get();
    if (!state.draft) return false;
    const definition = WORKFLOW_NODE_REGISTRY[node.type];
    const parsed = definition.schema.safeParse(node);
    if (!parsed.success) return false;
    const exists = state.draft.graph.nodes.some((candidate) => candidate.id === node.id);
    if (!exists) return false;
    mutateDraft(set, state, {
      ...state.draft,
      graph: {
        ...state.draft.graph,
        nodes: state.draft.graph.nodes.map((candidate) =>
          candidate.id === node.id ? parsed.data : candidate,
        ),
      },
    });
    return true;
  },

  removeNode: (nodeId) => {
    const state = get();
    if (!state.draft || nodeId === state.draft.graph.entryNodeId) return;
    const positions = { ...state.draft.positions };
    delete positions[nodeId];
    mutateDraft(
      set,
      state,
      {
        ...state.draft,
        graph: {
          ...state.draft.graph,
          nodes: state.draft.graph.nodes.filter((node) => node.id !== nodeId),
          edges: state.draft.graph.edges.filter(
            (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId,
          ),
        },
        positions,
      },
      null,
    );
  },

  connect: (connection) => {
    const state = get();
    if (!state.draft || !isValidWorkflowConnection(state.draft, connection)) return null;
    const edge = newEdge(state.draft, connection);
    if (!edge) return null;
    mutateDraft(
      set,
      state,
      {
        ...state.draft,
        graph: { ...state.draft.graph, edges: [...state.draft.graph.edges, edge] },
      },
      { kind: 'edge', id: edge.id },
    );
    return edge.id;
  },

  replaceEdge: (edge) => {
    const state = get();
    if (!state.draft) return false;
    const parsed = workflowEdgeSchema.safeParse(edge);
    if (!parsed.success) return false;
    const exists = state.draft.graph.edges.some((candidate) => candidate.id === edge.id);
    if (!exists) return false;
    mutateDraft(set, state, {
      ...state.draft,
      graph: {
        ...state.draft.graph,
        edges: state.draft.graph.edges.map((candidate) =>
          candidate.id === edge.id ? parsed.data : candidate,
        ),
      },
    });
    return true;
  },

  removeEdge: (edgeId) => {
    const state = get();
    if (!state.draft) return;
    mutateDraft(
      set,
      state,
      {
        ...state.draft,
        graph: {
          ...state.draft.graph,
          edges: state.draft.graph.edges.filter((edge) => edge.id !== edgeId),
        },
      },
      state.selection?.kind === 'edge' && state.selection.id === edgeId ? null : state.selection,
    );
  },

  moveNode: (nodeId, position) => {
    const state = get();
    if (!state.draft) return;
    mutateDraft(set, state, {
      ...state.draft,
      positions: { ...state.draft.positions, [nodeId]: position },
    });
  },

  setPositions: (positions) => {
    const state = get();
    if (!state.draft) return;
    mutateDraft(set, state, { ...state.draft, positions });
  },

  addNote: (position) => {
    const state = get();
    const id = nextId('note');
    if (!state.draft) return id;
    const note: WorkflowCanvasNote = { id, text: 'Add a note', position };
    mutateDraft(
      set,
      state,
      { ...state.draft, notes: [...state.draft.notes, note] },
      { kind: 'note', id },
    );
    return id;
  },

  moveNote: (noteId, position) => {
    const state = get();
    if (!state.draft) return;
    mutateDraft(set, state, {
      ...state.draft,
      notes: state.draft.notes.map((note) => (note.id === noteId ? { ...note, position } : note)),
    });
  },

  updateNote: (noteId, text) => {
    const state = get();
    if (!state.draft || !text.trim()) return;
    mutateDraft(set, state, {
      ...state.draft,
      notes: state.draft.notes.map((note) =>
        note.id === noteId ? { ...note, text: text.trim() } : note,
      ),
    });
  },

  removeNote: (noteId) => {
    const state = get();
    if (!state.draft) return;
    mutateDraft(
      set,
      state,
      { ...state.draft, notes: state.draft.notes.filter((note) => note.id !== noteId) },
      null,
    );
  },

  markSaved: (revision) => {
    const state = get();
    if (state.draftRevision === revision) set({ dirty: false });
  },

  setAssistantProposal: (assistantProposal) => set({ assistantProposal }),

  applyAssistantProposal: () => {
    const state = get();
    if (!state.draft || !state.assistantProposal) return false;
    if (state.draftRevision !== state.assistantProposal.draftRevision) return false;
    if (!state.assistantProposal.response.validation.valid) return false;

    const patched = applyWorkflowGraphPatch(
      { graph: state.draft.graph, positions: state.draft.positions },
      state.assistantProposal.response.operations,
    );
    mutateDraft(set, state, {
      ...state.draft,
      graph: patched.graph,
      positions: patched.positions,
    });
    set({ assistantProposal: null });
    return true;
  },
}));
