'use client';

import '@xyflow/react/dist/style.css';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  History,
  LayoutGrid,
  Plus,
  Save,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  validateWorkflowGraph,
  workflowAssistantProposalResponseSchema,
  type WorkflowDomain,
  type WorkflowDraftLeaseStatus,
  type WorkflowNodePosition,
  type WorkflowNodeType,
} from '@betterspend/shared';
import {
  api,
  type WorkflowDefinitionRecord,
  type WorkflowDefinitionVersionRecord,
} from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { WorkflowAssistant } from './workflow-assistant';
import {
  canRestoreWorkflowDraft,
  hasUsableWorkflowAssistant,
  openWorkflowDraftAccess,
  ownsWorkflowDraftLease,
} from './workflow-access';
import { WORKFLOW_EDGE_TYPES, type WorkflowFlowEdge } from './workflow-edge';
import { WorkflowInspector } from './workflow-inspector';
import { layoutWorkflow } from './workflow-layout';
import {
  WORKFLOW_FLOW_NODE_TYPES,
  WORKFLOW_NODE_REGISTRY,
  availableNodeDefinitions,
  type WorkflowFlowNode,
  type WorkflowNoteFlowNode,
} from './workflow-node-registry';
import { WORKFLOW_NODE_DRAG_TYPE, WorkflowPalette } from './workflow-palette';
import { isCurrentWorkflowRequest } from './workflow-request-identity';
import { isValidWorkflowConnection, useWorkflowBuilderStore } from './workflow-store';

const domains: Array<{ value: WorkflowDomain; label: string }> = [
  { value: 'requisition', label: 'Requisitions' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'po_change', label: 'PO changes' },
];

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function BuilderCanvas({
  definition,
  versions,
  onDefinitionChange,
  onVersionsChange,
}: {
  definition: WorkflowDefinitionRecord;
  versions: WorkflowDefinitionVersionRecord[];
  onDefinitionChange: (definition: WorkflowDefinitionRecord) => void;
  onVersionsChange: (versions: WorkflowDefinitionVersionRecord[]) => void;
}) {
  const store = useWorkflowBuilderStore();
  const { draft, selection, dirty, draftRevision, assistantProposal } = store;
  const { fitView, getNodes, screenToFlowPosition } = useReactFlow();
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [tray, setTray] = useState<'validation' | 'versions' | null>('validation');
  const [insertEdgeId, setInsertEdgeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantAvailable, setAssistantAvailable] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [leaseStatus, setLeaseStatus] = useState<WorkflowDraftLeaseStatus | null>(null);
  const leaseTokenRef = useRef<string | null>(null);
  const restoreLockRef = useRef(false);
  const activeDefinitionIdRef = useRef<string | null>(definition.id);
  const saveRequestIdRef = useRef(0);
  const proposalRequestIdRef = useRef(0);
  const ownsLease = ownsWorkflowDraftLease(leaseStatus);
  const canEdit = ownsLease && !restoring;

  useEffect(
    () => () => {
      activeDefinitionIdRef.current = null;
      saveRequestIdRef.current += 1;
      proposalRequestIdRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    let openedToken: string | null = null;
    openWorkflowDraftAccess(definition.id, {
      status: api.workflowDefinitions.lease.status,
      acquire: api.workflowDefinitions.lease.acquire,
      release: api.workflowDefinitions.lease.release,
      getDefinition: api.workflowDefinitions.get,
      isActive: () => active,
    })
      .then(({ status, definition: authoritative }) => {
        openedToken = status.state === 'owned' ? status.leaseToken : null;
        if (!active) {
          if (openedToken)
            void api.workflowDefinitions.lease
              .release(definition.id, openedToken)
              .catch(() => undefined);
          return;
        }
        if (authoritative) {
          saveRequestIdRef.current += 1;
          proposalRequestIdRef.current += 1;
          useWorkflowBuilderStore.getState().loadDraft(authoritative.currentDraft);
        }
        setLeaseStatus(status);
        leaseTokenRef.current = openedToken;
      })
      .catch((accessError: unknown) => {
        if (!active) return;
        setError(messageFor(accessError));
        setLeaseStatus({ state: 'available' });
      });
    return () => {
      active = false;
      const leaseToken = leaseTokenRef.current ?? openedToken;
      if (leaseToken) void api.workflowDefinitions.lease.release(definition.id, leaseToken);
    };
  }, [definition.id]);

  useEffect(() => {
    if (leaseStatus?.state !== 'owned') return;
    const timer = window.setInterval(() => {
      api.workflowDefinitions.lease
        .renew(definition.id, leaseStatus.leaseToken)
        .then((status) => {
          setLeaseStatus(status);
          leaseTokenRef.current = status.state === 'owned' ? status.leaseToken : null;
          if (status.state !== 'owned') {
            restoreLockRef.current = false;
            saveRequestIdRef.current += 1;
            proposalRequestIdRef.current += 1;
            setSaving(false);
            setRestoring(false);
            setAssistantBusy(false);
            setInsertEdgeId(null);
            setAssistantOpen(false);
          }
        })
        .catch(() => {
          leaseTokenRef.current = null;
          restoreLockRef.current = false;
          saveRequestIdRef.current += 1;
          proposalRequestIdRef.current += 1;
          setSaving(false);
          setRestoring(false);
          setAssistantBusy(false);
          setLeaseStatus({ state: 'available' });
          setInsertEdgeId(null);
          setAssistantOpen(false);
        });
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [definition.id, leaseStatus]);

  const validation = useMemo(
    () => (draft ? validateWorkflowGraph(draft.graph) : { valid: false as const, issues: [] }),
    [draft],
  );
  const issuesByNode = useMemo(() => {
    const result = new Map<string, typeof validation.issues>();
    for (const issue of validation.issues) {
      for (const nodeId of issue.nodeIds ?? []) {
        result.set(nodeId, [...(result.get(nodeId) ?? []), issue]);
      }
    }
    return result;
  }, [validation]);

  const flowNodes = useMemo<Array<WorkflowFlowNode | WorkflowNoteFlowNode>>(() => {
    if (!draft) return [];
    const graphNodes: WorkflowFlowNode[] = draft.graph.nodes.map((node, index) => ({
      id: node.id,
      type: 'workflow',
      position: draft.positions[node.id] ?? { x: index * 270, y: 140 },
      data: { domainNode: node, issues: issuesByNode.get(node.id) ?? [] },
      selected: selection?.kind === 'node' && selection.id === node.id,
    }));
    const notes: WorkflowNoteFlowNode[] = draft.notes.map((note) => ({
      id: note.id,
      type: 'note',
      position: note.position,
      data: { note },
      selected: selection?.kind === 'note' && selection.id === note.id,
    }));
    return [...graphNodes, ...notes];
  }, [draft, issuesByNode, selection]);

  const flowEdges = useMemo<WorkflowFlowEdge[]>(
    () =>
      draft
        ? draft.graph.edges.map((edge) => ({
            id: edge.id,
            type: 'workflow',
            source: edge.sourceNodeId,
            target: edge.targetNodeId,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#71717a', width: 14, height: 14 },
            style: { stroke: '#71717a', strokeWidth: 1.25 },
            label:
              edge.condition && 'field' in edge.condition
                ? `${edge.condition.field} ${edge.condition.operator}`
                : undefined,
            labelStyle: { fill: '#a1a1aa', fontSize: 9 },
            data: { onInsert: setInsertEdgeId, canInsert: canEdit },
          }))
        : [],
    [canEdit, draft],
  );

  useEffect(() => {
    let active = true;
    api.aiProviders
      .status()
      .then((status) => active && setAssistantAvailable(hasUsableWorkflowAssistant(status)))
      .catch(() => active && setAssistantAvailable(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!draft || !dirty || saving || restoring || leaseStatus?.state !== 'owned') return;
    const revision = draftRevision;
    const timer = window.setTimeout(() => {
      const request = {
        definitionId: definition.id,
        requestId: ++saveRequestIdRef.current,
      };
      setSaving(true);
      setError(null);
      api.workflowDefinitions
        .saveDraft(definition.id, draft, leaseStatus.leaseToken)
        .then((saved) => {
          if (
            !isCurrentWorkflowRequest(
              activeDefinitionIdRef.current,
              saveRequestIdRef.current,
              request,
            )
          )
            return;
          store.markSaved(revision);
          if (useWorkflowBuilderStore.getState().draftRevision === revision)
            onDefinitionChange(saved);
        })
        .catch((saveError: unknown) => {
          if (
            isCurrentWorkflowRequest(
              activeDefinitionIdRef.current,
              saveRequestIdRef.current,
              request,
            )
          )
            setError(messageFor(saveError));
        })
        .finally(() => {
          if (
            isCurrentWorkflowRequest(
              activeDefinitionIdRef.current,
              saveRequestIdRef.current,
              request,
            )
          )
            setSaving(false);
        });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    definition.id,
    dirty,
    draft,
    draftRevision,
    leaseStatus,
    onDefinitionChange,
    restoring,
    saving,
    store,
  ]);

  const runLayout = useCallback(async () => {
    const leaseToken = leaseTokenRef.current;
    if (!draft || !canEdit || !leaseToken) return;
    const measured = getNodes()
      .filter((node) => node.type === 'workflow')
      .map((node) => ({
        id: node.id,
        width: node.measured?.width ?? node.width ?? 208,
        height: node.measured?.height ?? node.height ?? 90,
      }));
    if (measured.length !== draft.graph.nodes.length) return;
    try {
      const positions = await layoutWorkflow(draft, measured);
      if (activeDefinitionIdRef.current !== definition.id) return;
      if (leaseTokenRef.current !== leaseToken) return;
      store.setPositions(positions);
      window.requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 0 }));
    } catch (layoutError) {
      if (activeDefinitionIdRef.current === definition.id) setError(messageFor(layoutError));
    }
  }, [canEdit, definition.id, draft, fitView, getNodes, store]);

  if (!draft) return null;
  const selectedNode =
    selection?.kind === 'node'
      ? (draft.graph.nodes.find((node) => node.id === selection.id) ?? null)
      : null;
  const selectedNote =
    selection?.kind === 'note'
      ? (draft.notes.find((note) => note.id === selection.id) ?? null)
      : null;
  const selectedIssues = selectedNode ? (issuesByNode.get(selectedNode.id) ?? []) : [];

  const publish = async () => {
    if (!validation.valid || !canEdit || restoreLockRef.current || leaseStatus?.state !== 'owned')
      return;
    const leaseToken = leaseStatus.leaseToken;
    setPublishing(true);
    setError(null);
    try {
      if (dirty) {
        const revision = draftRevision;
        const saved = await api.workflowDefinitions.saveDraft(definition.id, draft, leaseToken);
        if (activeDefinitionIdRef.current !== definition.id) return;
        if (leaseTokenRef.current !== leaseToken) return;
        onDefinitionChange(saved);
        store.markSaved(revision);
      }
      await api.workflowDefinitions.publish(definition.id, leaseToken);
      const [updated, nextVersions] = await Promise.all([
        api.workflowDefinitions.get(definition.id),
        api.workflowDefinitions.versions(definition.id),
      ]);
      if (activeDefinitionIdRef.current !== definition.id) return;
      if (leaseTokenRef.current !== leaseToken) return;
      onDefinitionChange(updated);
      onVersionsChange(nextVersions);
      setTray('versions');
    } catch (publishError) {
      if (activeDefinitionIdRef.current === definition.id) setError(messageFor(publishError));
    } finally {
      if (activeDefinitionIdRef.current === definition.id) setPublishing(false);
    }
  };

  const requestProposal = async (prompt: string) => {
    if (!canEdit || restoreLockRef.current) return;
    const proposalRevision = draftRevision;
    const proposalSnapshot = { graph: draft.graph, positions: draft.positions };
    const request = {
      definitionId: definition.id,
      requestId: ++proposalRequestIdRef.current,
    };
    setAssistantBusy(true);
    setAssistantError(null);
    try {
      const response = workflowAssistantProposalResponseSchema.parse(
        await api.workflowDefinitions.propose(definition.id, {
          prompt,
          ...proposalSnapshot,
        }),
      );
      if (
        !isCurrentWorkflowRequest(
          activeDefinitionIdRef.current,
          proposalRequestIdRef.current,
          request,
        )
      )
        return;
      store.setAssistantProposal({
        response,
        draftRevision: proposalRevision,
        snapshot: proposalSnapshot,
      });
    } catch (proposalError) {
      if (
        isCurrentWorkflowRequest(
          activeDefinitionIdRef.current,
          proposalRequestIdRef.current,
          request,
        )
      )
        setAssistantError(messageFor(proposalError));
    } finally {
      if (
        isCurrentWorkflowRequest(
          activeDefinitionIdRef.current,
          proposalRequestIdRef.current,
          request,
        )
      )
        setAssistantBusy(false);
    }
  };

  const takeOverEditing = async () => {
    restoreLockRef.current = false;
    setError(null);
    saveRequestIdRef.current += 1;
    proposalRequestIdRef.current += 1;
    setSaving(false);
    setRestoring(false);
    setAssistantBusy(false);
    setInsertEdgeId(null);
    setAssistantOpen(false);
    try {
      const status = await api.workflowDefinitions.lease.takeover(definition.id);
      if (activeDefinitionIdRef.current !== definition.id) {
        if (status.state === 'owned')
          await api.workflowDefinitions.lease
            .release(definition.id, status.leaseToken)
            .catch(() => undefined);
        return;
      }
      if (status.state !== 'owned') {
        setLeaseStatus(status);
        leaseTokenRef.current = null;
        return;
      }

      leaseTokenRef.current = status.leaseToken;
      try {
        const authoritative = await api.workflowDefinitions.get(definition.id);
        if (activeDefinitionIdRef.current !== definition.id) return;
        store.loadDraft(authoritative.currentDraft);
        onDefinitionChange(authoritative);
        setLeaseStatus(status);
      } catch (loadError) {
        await api.workflowDefinitions.lease
          .release(definition.id, status.leaseToken)
          .catch(() => undefined);
        leaseTokenRef.current = null;
        setLeaseStatus({ state: 'available' });
        throw loadError;
      }
    } catch (leaseError) {
      if (activeDefinitionIdRef.current === definition.id) setError(messageFor(leaseError));
    }
  };

  const restoreVersion = async (versionId: string) => {
    if (
      !canRestoreWorkflowDraft({ ownsLease, dirty, saving, publishing, restoring }) ||
      restoreLockRef.current ||
      !ownsWorkflowDraftLease(leaseStatus)
    )
      return;
    const leaseToken = leaseStatus.leaseToken;
    const startingRevision = useWorkflowBuilderStore.getState().draftRevision;
    restoreLockRef.current = true;
    saveRequestIdRef.current += 1;
    proposalRequestIdRef.current += 1;
    store.setAssistantProposal(null);
    setAssistantBusy(false);
    setAssistantOpen(false);
    setRestoring(true);
    setError(null);
    try {
      await api.workflowDefinitions.restore(definition.id, versionId, leaseToken);
      const authoritative = await api.workflowDefinitions.get(definition.id);
      if (activeDefinitionIdRef.current !== definition.id) return;
      if (leaseTokenRef.current !== leaseToken) return;
      if (useWorkflowBuilderStore.getState().draftRevision !== startingRevision) {
        throw new Error('The canvas changed while restoring. Reload before trying again.');
      }
      store.loadDraft(authoritative.currentDraft);
      onDefinitionChange(authoritative);
    } catch (restoreError) {
      if (activeDefinitionIdRef.current === definition.id) setError(messageFor(restoreError));
    } finally {
      restoreLockRef.current = false;
      if (activeDefinitionIdRef.current === definition.id) setRestoring(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-black text-white">
      <div className="flex h-12 shrink-0 items-center gap-2 border-y border-white/12 bg-black px-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">{definition.name}</div>
          <div className="font-mono text-[9px] uppercase text-zinc-600">
            {definition.domain.replace('_', ' ')}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[10px] text-zinc-500 sm:block">
            {leaseStatus === null
              ? 'Checking edit access'
              : ownsLease
                ? restoring
                  ? 'Restoring version'
                  : saving
                    ? 'Saving'
                    : dirty
                      ? 'Unsaved changes'
                      : 'Saved'
                : leaseStatus.state === 'held'
                  ? `Read only, ${leaseStatus.lease.holderName} is editing`
                  : 'Edit lease unavailable'}
          </span>
          {!ownsLease ? (
            <button
              type="button"
              onClick={() => void takeOverEditing()}
              className="h-8 border border-amber-300/30 px-2.5 text-[10px] text-amber-200 hover:text-white"
            >
              Take over editing
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void runLayout()}
            disabled={!canEdit}
            className="flex h-8 items-center gap-1.5 border border-white/15 px-2.5 text-[10px] text-zinc-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            <LayoutGrid className="size-3" /> Layout
          </button>
          <button
            type="button"
            onClick={() => void publish()}
            disabled={!validation.valid || publishing || !canEdit}
            className="flex h-8 items-center gap-1.5 bg-white px-3 text-[10px] font-bold text-black disabled:opacity-35"
          >
            <Upload className="size-3" /> {publishing ? 'Publishing' : 'Publish'}
          </button>
        </div>
      </div>
      {error ? (
        <div className="border-b border-red-300/20 bg-red-300/5 px-3 py-2 text-[10px] text-red-200">
          {error}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <WorkflowPalette
          domain={draft.graph.domain}
          collapsed={paletteCollapsed}
          disabled={!canEdit}
          onToggle={() => setPaletteCollapsed((value) => !value)}
          onAdd={(type, position) => {
            if (canEdit && !restoreLockRef.current) store.addNode(type, position);
          }}
          onAddNote={() => {
            if (canEdit && !restoreLockRef.current) store.addNote({ x: 180, y: 340 });
          }}
        />
        <div className="relative min-w-0 flex-1 bg-black">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={WORKFLOW_FLOW_NODE_TYPES}
            edgeTypes={WORKFLOW_EDGE_TYPES}
            onNodeClick={(_, node) =>
              store.select(
                node.type === 'note'
                  ? { kind: 'note', id: node.id }
                  : { kind: 'node', id: node.id },
              )
            }
            onPaneClick={() => store.select(null)}
            onNodesChange={(changes: NodeChange[]) => {
              if (!canEdit || restoreLockRef.current) return;
              for (const change of changes) {
                if (change.type !== 'position' || !change.position) continue;
                if (draft.notes.some((note) => note.id === change.id)) {
                  store.moveNote(change.id, change.position);
                } else {
                  store.moveNode(change.id, change.position);
                }
              }
            }}
            onNodesDelete={(nodes: Node[]) => {
              if (!canEdit || restoreLockRef.current) return;
              nodes.forEach((node) =>
                node.type === 'note' ? store.removeNote(node.id) : store.removeNode(node.id),
              );
            }}
            onEdgesDelete={(edges: Edge[]) => {
              if (!canEdit || restoreLockRef.current) return;
              edges.forEach((edge) => store.removeEdge(edge.id));
            }}
            onConnect={(connection: Connection) => {
              if (canEdit && !restoreLockRef.current) store.connect(connection);
            }}
            isValidConnection={(connection) =>
              canEdit &&
              isValidWorkflowConnection(draft, {
                source: connection.source,
                target: connection.target,
                sourceHandle: connection.sourceHandle ?? null,
                targetHandle: connection.targetHandle ?? null,
              })
            }
            onDragOver={(event) => {
              if (!canEdit || restoreLockRef.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(event) => {
              if (!canEdit || restoreLockRef.current) return;
              event.preventDefault();
              const type = event.dataTransfer.getData(WORKFLOW_NODE_DRAG_TYPE) as WorkflowNodeType;
              if (WORKFLOW_NODE_REGISTRY[type])
                store.addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
            }}
            fitView
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            edgesReconnectable={false}
            minZoom={0.25}
            maxZoom={1.5}
            deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
            proOptions={{ hideAttribution: true }}
            className="workflow-canvas"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
            <Controls
              showInteractive={false}
              className="!rounded-none !border-white/15 !bg-black [&_button]:!rounded-none [&_button]:!border-white/10 [&_button]:!bg-black [&_button]:!fill-zinc-400"
            />
          </ReactFlow>
          <WorkflowAssistant
            available={assistantAvailable && canEdit}
            open={assistantOpen && canEdit}
            busy={assistantBusy}
            proposal={assistantProposal}
            currentRevision={draftRevision}
            error={assistantError}
            onOpenChange={setAssistantOpen}
            onSubmit={(prompt) => void requestProposal(prompt)}
            onApply={() => {
              if (!canEdit || restoreLockRef.current) return;
              if (!store.applyAssistantProposal())
                setAssistantError('The canvas changed. Regenerate this proposal.');
            }}
            onReject={() => store.setAssistantProposal(null)}
          />
          {insertEdgeId && canEdit ? (
            <div
              className="absolute inset-0 z-30 grid place-items-center bg-black/75 p-4"
              onClick={() => setInsertEdgeId(null)}
            >
              <div
                className="w-full max-w-md border border-white/20 bg-[#080808]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex h-11 items-center border-b border-white/12 px-3 text-xs font-semibold">
                  Insert step
                  <button
                    type="button"
                    onClick={() => setInsertEdgeId(null)}
                    className="ml-auto text-zinc-600 hover:text-white"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="grid max-h-80 grid-cols-2 overflow-y-auto">
                  {availableNodeDefinitions(draft.graph.domain)
                    .filter(
                      (item) => item.ports.inputs.length > 0 && item.ports.outputs.length === 1,
                    )
                    .map((item) => (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => {
                          if (!canEdit || restoreLockRef.current) return;
                          store.insertNodeOnEdge(insertEdgeId, item.type);
                          setInsertEdgeId(null);
                        }}
                        className="border-b border-r border-white/10 p-3 text-left hover:bg-white/[0.04]"
                      >
                        <span className="block text-xs font-medium">{item.label}</span>
                        <span className="mt-1 block text-[10px] leading-4 text-zinc-600">
                          {item.description}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        {selection && canEdit ? (
          <WorkflowInspector
            node={selectedNode}
            note={selectedNote}
            nodes={draft.graph.nodes}
            issues={selectedIssues}
            onClose={() => store.select(null)}
            onReplaceNode={(node) => {
              if (canEdit && !restoreLockRef.current) store.replaceNode(node);
            }}
            onUpdateNote={(noteId, text) => {
              if (canEdit && !restoreLockRef.current) store.updateNote(noteId, text);
            }}
            onRemoveNode={(nodeId) => {
              if (canEdit && !restoreLockRef.current) store.removeNode(nodeId);
            }}
            onRemoveNote={(noteId) => {
              if (canEdit && !restoreLockRef.current) store.removeNote(noteId);
            }}
          />
        ) : null}
      </div>
      <div className="shrink-0 border-t border-white/15 bg-[#070707]">
        <div className="flex h-9 items-center px-3">
          <button
            type="button"
            onClick={() => setTray(tray === 'validation' ? null : 'validation')}
            className={`flex h-full items-center gap-1.5 border-r border-white/10 pr-3 text-[10px] ${validation.valid ? 'text-emerald-300' : 'text-amber-200'}`}
          >
            {validation.valid ? (
              <CheckCircle2 className="size-3" />
            ) : (
              <AlertTriangle className="size-3" />
            )}
            {validation.valid
              ? 'Ready to publish'
              : `${validation.issues.length} issue${validation.issues.length === 1 ? '' : 's'}`}
          </button>
          <button
            type="button"
            onClick={() => setTray(tray === 'versions' ? null : 'versions')}
            className="flex h-full items-center gap-1.5 px-3 text-[10px] text-zinc-400 hover:text-white"
          >
            <History className="size-3" />{' '}
            {versions.length ? `Version ${versions[0]?.version}` : 'No published version'}
          </button>
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[9px] text-zinc-600">
            <Save className="size-3" /> Draft {draftRevision}
          </span>
          <button
            type="button"
            onClick={() => setTray(null)}
            aria-label="Close tray"
            className="ml-3 text-zinc-700 hover:text-white"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
        {tray === 'validation' ? (
          <div className="max-h-32 overflow-y-auto border-t border-white/10 px-3 py-2">
            {validation.issues.length === 0 ? (
              <p className="text-[10px] text-zinc-500">
                All required connections and settings are valid.
              </p>
            ) : (
              validation.issues.map((issue) => (
                <button
                  key={`${issue.code}-${issue.path.join('.')}`}
                  type="button"
                  onClick={() => {
                    const nodeId = issue.nodeIds?.[0];
                    if (nodeId) store.select({ kind: 'node', id: nodeId });
                  }}
                  className="flex w-full items-center gap-2 py-1 text-left text-[10px] text-amber-100 hover:text-white"
                >
                  <span className="font-mono text-amber-300">{issue.code}</span>
                  <span>{issue.message}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
        {tray === 'versions' ? (
          <div className="max-h-40 overflow-y-auto border-t border-white/10">
            {versions.length === 0 ? (
              <p className="px-3 py-3 text-[10px] text-zinc-600">
                Publish this draft to create version 1.
              </p>
            ) : (
              versions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center border-b border-white/8 px-3 py-2 text-[10px]"
                >
                  <span className="font-semibold text-white">Version {version.version}</span>
                  <span className="ml-3 text-zinc-600">
                    {new Date(version.publishedAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      if (leaseStatus?.state !== 'owned') return;
                      await restoreVersion(version.id);
                    }}
                    disabled={
                      !canRestoreWorkflowDraft({
                        ownsLease,
                        dirty,
                        saving,
                        publishing,
                        restoring,
                      })
                    }
                    className="ml-auto border border-white/15 px-2 py-1 text-zinc-400 hover:text-white disabled:opacity-35"
                  >
                    Restore as draft
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WorkflowBuilderInner() {
  const loadDraft = useWorkflowBuilderStore((state) => state.loadDraft);
  const openRequestIdRef = useRef(0);
  const [definitions, setDefinitions] = useState<WorkflowDefinitionRecord[]>([]);
  const [active, setActive] = useState<WorkflowDefinitionRecord | null>(null);
  const [versions, setVersions] = useState<WorkflowDefinitionVersionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('Requisition approvals');
  const [createDomain, setCreateDomain] = useState<WorkflowDomain>('requisition');
  const [error, setError] = useState<string | null>(null);
  const openDefinition = useCallback(
    async (definition: WorkflowDefinitionRecord) => {
      const requestId = ++openRequestIdRef.current;
      const [authoritative, nextVersions] = await Promise.all([
        api.workflowDefinitions.get(definition.id),
        api.workflowDefinitions.versions(definition.id),
      ]);
      if (requestId !== openRequestIdRef.current) return;
      setActive(authoritative);
      setDefinitions((items) =>
        items.map((item) => (item.id === authoritative.id ? authoritative : item)),
      );
      loadDraft(authoritative.currentDraft);
      setVersions(nextVersions);
    },
    [loadDraft],
  );
  useEffect(() => {
    api.workflowDefinitions
      .list()
      .then(async (items) => {
        setDefinitions(items);
        if (items[0]) await openDefinition(items[0]);
      })
      .catch((loadError: unknown) => setError(messageFor(loadError)))
      .finally(() => setLoading(false));
  }, [openDefinition]);
  const createDefinition = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.workflowDefinitions.create({
        name: createName.trim(),
        domain: createDomain,
      });
      setDefinitions((current) => [...current, created]);
      await openDefinition(created);
    } catch (createError) {
      setError(messageFor(createError));
    } finally {
      setCreating(false);
    }
  };
  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[620px] flex-col bg-black">
      <PageHeader
        title="Approval workflows"
        description="Build and publish approval logic"
        actions={
          active ? (
            <div className="flex items-center gap-2">
              <select
                value={active.id}
                onChange={(event) => {
                  const next = definitions.find((item) => item.id === event.target.value);
                  if (next) void openDefinition(next);
                }}
                className="h-8 border border-white/15 bg-black px-2 text-xs text-white"
              >
                {definitions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  openRequestIdRef.current += 1;
                  setActive(null);
                }}
                className="flex h-8 items-center gap-1.5 border border-white/15 px-2.5 text-[10px] text-zinc-300 hover:text-white"
              >
                <Plus className="size-3" /> New
              </button>
            </div>
          ) : null
        }
      />
      {loading ? (
        <div className="grid flex-1 place-items-center text-xs text-zinc-600">
          Loading workflows
        </div>
      ) : active ? (
        <BuilderCanvas
          key={active.id}
          definition={active}
          versions={versions}
          onDefinitionChange={(next) => {
            setActive(next);
            setDefinitions((items) => items.map((item) => (item.id === next.id ? next : item)));
          }}
          onVersionsChange={setVersions}
        />
      ) : (
        <div className="grid flex-1 place-items-center p-6">
          <div className="w-full max-w-md border border-white/15 bg-[#070707] p-5 text-white">
            <h2 className="text-sm font-semibold">New workflow</h2>
            <div className="mt-5 grid gap-4">
              <label className="grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Name
                <input
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  className="h-9 border border-white/15 bg-black px-2.5 text-xs normal-case tracking-normal text-white outline-none focus:border-orange-300"
                />
              </label>
              <label className="grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Domain
                <select
                  value={createDomain}
                  onChange={(event) => setCreateDomain(event.target.value as WorkflowDomain)}
                  className="h-9 border border-white/15 bg-black px-2.5 text-xs normal-case tracking-normal text-white"
                >
                  {domains.map((domain) => (
                    <option key={domain.value} value={domain.value}>
                      {domain.label}
                    </option>
                  ))}
                </select>
              </label>
              {error ? <div className="text-[10px] text-red-300">{error}</div> : null}
              <button
                type="button"
                onClick={() => void createDefinition()}
                disabled={creating || !createName.trim()}
                className="h-9 bg-white text-xs font-semibold text-black disabled:opacity-40"
              >
                {creating ? 'Creating' : 'Create workflow'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkflowBuilder() {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderInner />
    </ReactFlowProvider>
  );
}
