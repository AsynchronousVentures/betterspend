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
} from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { WorkflowAssistant } from './workflow-assistant';
import {
  canRestoreWorkflowDraft,
  hasUsableWorkflowAssistant,
  openWorkflowDraftAccess,
  ownsWorkflowDraftLease,
} from './workflow-access';
import { WORKFLOW_EDGE_TYPES, type WorkflowFlowEdge } from './workflow-edge';
import { workflowEdgeLabel } from './workflow-edge-config';
import { WorkflowInspector } from './workflow-inspector';
import { WorkflowInsertDialog } from './workflow-insert-dialog';
import { layoutWorkflow } from './workflow-layout';
import {
  WORKFLOW_FLOW_NODE_TYPES,
  WORKFLOW_NODE_REGISTRY,
  availableNodeDefinitions,
  type WorkflowFlowNode,
  type WorkflowNoteFlowNode,
} from './workflow-node-registry';
import { WORKFLOW_NODE_DRAG_TYPE, WorkflowPalette } from './workflow-palette';
import { navigateAfterDraftFlush } from './workflow-navigation';
import { beginWorkflowOperation, endWorkflowOperation } from './workflow-operation-lock';
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

type BuilderCanvasHandle = {
  flushDraftBeforeNavigation: () => Promise<boolean>;
  cancelPreparedNavigation: (error: unknown) => void;
};

const BuilderCanvas = forwardRef<
  BuilderCanvasHandle,
  {
    definition: WorkflowDefinitionRecord;
    versions: WorkflowDefinitionVersionRecord[];
    onDefinitionChange: (definition: WorkflowDefinitionRecord) => void;
    onVersionsChange: (versions: WorkflowDefinitionVersionRecord[]) => void;
    navigationBusy: boolean;
  }
>(function BuilderCanvas(
  { definition, versions, onDefinitionChange, onVersionsChange, navigationBusy },
  ref,
) {
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
  const [leaseBusy, setLeaseBusy] = useState(true);
  const [editorInstanceId] = useState(() => crypto.randomUUID());
  const insertDialogTriggerRef = useRef<HTMLElement | null>(null);
  const leaseTokenRef = useRef<string | null>(null);
  const leaseBusyRef = useRef(true);
  const leaseRequestIdRef = useRef(0);
  const mutationLockRef = useRef(false);
  const restoreLockRef = useRef(false);
  const activeDefinitionIdRef = useRef<string | null>(definition.id);
  const saveRequestIdRef = useRef(0);
  const savePromiseRef = useRef<Promise<WorkflowDefinitionRecord> | null>(null);
  const publishRequestIdRef = useRef(0);
  const proposalRequestIdRef = useRef(0);
  const ownsLease = ownsWorkflowDraftLease(leaseStatus);
  const canEdit = ownsLease && !restoring && !publishing && !navigationBusy;
  const openInsertDialog = useCallback((edgeId: string) => {
    insertDialogTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInsertEdgeId(edgeId);
  }, []);

  useEffect(
    () => () => {
      activeDefinitionIdRef.current = null;
      leaseRequestIdRef.current += 1;
      leaseBusyRef.current = false;
      endWorkflowOperation(mutationLockRef);
      saveRequestIdRef.current += 1;
      publishRequestIdRef.current += 1;
      proposalRequestIdRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    let openedToken: string | null = null;
    const request = {
      definitionId: definition.id,
      requestId: ++leaseRequestIdRef.current,
    };
    leaseBusyRef.current = true;
    openWorkflowDraftAccess(definition.id, {
      status: (id) => api.workflowDefinitions.lease.status(id, editorInstanceId),
      acquire: (id) => api.workflowDefinitions.lease.acquire(id, editorInstanceId),
      release: (id, leaseToken) =>
        api.workflowDefinitions.lease.release(id, { editorInstanceId, leaseToken }),
      getDefinition: api.workflowDefinitions.get,
      isActive: () => active,
    })
      .then(({ status, definition: authoritative }) => {
        openedToken = status.state === 'owned' ? status.leaseToken : null;
        if (!active) {
          if (openedToken)
            void api.workflowDefinitions.lease
              .release(definition.id, { editorInstanceId, leaseToken: openedToken })
              .catch(() => undefined);
          return;
        }
        if (
          !isCurrentWorkflowRequest(
            activeDefinitionIdRef.current,
            leaseRequestIdRef.current,
            request,
          )
        )
          return;
        if (authoritative) {
          saveRequestIdRef.current += 1;
          proposalRequestIdRef.current += 1;
          useWorkflowBuilderStore.getState().loadDraft(authoritative.currentDraft);
        }
        setLeaseStatus(status);
        leaseTokenRef.current = openedToken;
      })
      .catch((accessError: unknown) => {
        if (
          !active ||
          !isCurrentWorkflowRequest(
            activeDefinitionIdRef.current,
            leaseRequestIdRef.current,
            request,
          )
        )
          return;
        setError(messageFor(accessError));
        setLeaseStatus({ state: 'available' });
      })
      .finally(() => {
        if (
          !active ||
          !isCurrentWorkflowRequest(
            activeDefinitionIdRef.current,
            leaseRequestIdRef.current,
            request,
          )
        )
          return;
        leaseBusyRef.current = false;
        setLeaseBusy(false);
      });
    return () => {
      active = false;
      const leaseToken = leaseTokenRef.current ?? openedToken;
      if (leaseToken)
        void api.workflowDefinitions.lease.release(definition.id, {
          editorInstanceId,
          leaseToken,
        });
    };
  }, [definition.id, editorInstanceId]);

  useEffect(() => {
    if (leaseStatus?.state !== 'owned') return;
    const timer = window.setInterval(() => {
      const request = {
        definitionId: definition.id,
        requestId: ++leaseRequestIdRef.current,
      };
      api.workflowDefinitions.lease
        .renew(definition.id, { editorInstanceId, leaseToken: leaseStatus.leaseToken })
        .then((status) => {
          if (
            !isCurrentWorkflowRequest(
              activeDefinitionIdRef.current,
              leaseRequestIdRef.current,
              request,
            )
          )
            return;
          setLeaseStatus(status);
          leaseTokenRef.current = status.state === 'owned' ? status.leaseToken : null;
          if (status.state !== 'owned') {
            restoreLockRef.current = false;
            endWorkflowOperation(mutationLockRef);
            saveRequestIdRef.current += 1;
            publishRequestIdRef.current += 1;
            proposalRequestIdRef.current += 1;
            setSaving(false);
            setPublishing(false);
            setRestoring(false);
            setAssistantBusy(false);
            setInsertEdgeId(null);
            setAssistantOpen(false);
          }
        })
        .catch(() => {
          if (
            !isCurrentWorkflowRequest(
              activeDefinitionIdRef.current,
              leaseRequestIdRef.current,
              request,
            )
          )
            return;
          leaseTokenRef.current = null;
          restoreLockRef.current = false;
          endWorkflowOperation(mutationLockRef);
          saveRequestIdRef.current += 1;
          publishRequestIdRef.current += 1;
          proposalRequestIdRef.current += 1;
          setSaving(false);
          setPublishing(false);
          setRestoring(false);
          setAssistantBusy(false);
          setLeaseStatus({ state: 'available' });
          setInsertEdgeId(null);
          setAssistantOpen(false);
        });
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [definition.id, editorInstanceId, leaseStatus]);

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
  const issuesByEdge = useMemo(() => {
    const result = new Map<string, typeof validation.issues>();
    for (const issue of validation.issues) {
      for (const edgeId of issue.edgeIds ?? []) {
        result.set(edgeId, [...(result.get(edgeId) ?? []), issue]);
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
            selected: selection?.kind === 'edge' && selection.id === edge.id,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#9c968e', width: 14, height: 14 },
            style: {
              stroke:
                selection?.kind === 'edge' && selection.id === edge.id
                  ? '#d4522e'
                  : issuesByEdge.has(edge.id)
                    ? '#f0a230'
                    : '#9c968e',
              strokeWidth: selection?.kind === 'edge' && selection.id === edge.id ? 2 : 1.25,
            },
            label: workflowEdgeLabel(edge),
            labelStyle: { fill: '#6b6560', fontSize: 9 },
            data: { onInsert: openInsertDialog, canInsert: canEdit },
          }))
        : [],
    [canEdit, draft, issuesByEdge, openInsertDialog, selection],
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
    if (
      !draft ||
      !dirty ||
      saving ||
      restoring ||
      publishing ||
      mutationLockRef.current ||
      leaseStatus?.state !== 'owned'
    )
      return;
    const revision = draftRevision;
    const timer = window.setTimeout(() => {
      if (mutationLockRef.current) return;
      const request = {
        definitionId: definition.id,
        requestId: ++saveRequestIdRef.current,
      };
      setSaving(true);
      setError(null);
      const savePromise = api.workflowDefinitions.saveDraft(definition.id, draft, {
        editorInstanceId,
        leaseToken: leaseStatus.leaseToken,
      });
      savePromiseRef.current = savePromise;
      savePromise
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
          if (savePromiseRef.current === savePromise) savePromiseRef.current = null;
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
    editorInstanceId,
    leaseStatus,
    onDefinitionChange,
    publishing,
    restoring,
    saving,
    store,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      flushDraftBeforeNavigation: async () => {
        if (publishing || restoring || !beginWorkflowOperation(mutationLockRef)) {
          setError('Wait for the current workflow operation to finish before leaving.');
          return false;
        }
        try {
          await savePromiseRef.current;
        } catch {
          // The autosave handler already surfaced the failure. Retry the current draft below.
        }

        const state = useWorkflowBuilderStore.getState();
        if (!state.dirty || !state.draft) return true;
        const leaseToken = leaseTokenRef.current;
        if (!leaseToken || leaseStatus?.state !== 'owned') {
          endWorkflowOperation(mutationLockRef);
          setError(
            'Draft could not be saved because edit access was lost. Take over editing and try again.',
          );
          return false;
        }

        const snapshot = state.draft;
        const revision = state.draftRevision;
        const request = {
          definitionId: definition.id,
          requestId: ++saveRequestIdRef.current,
        };
        setSaving(true);
        setError(null);
        try {
          const saved = await api.workflowDefinitions.saveDraft(definition.id, snapshot, {
            editorInstanceId,
            leaseToken,
          });
          if (
            !isCurrentWorkflowRequest(
              activeDefinitionIdRef.current,
              saveRequestIdRef.current,
              request,
            ) ||
            leaseTokenRef.current !== leaseToken
          ) {
            endWorkflowOperation(mutationLockRef);
            setError('Draft save was superseded. Review the current workflow before leaving.');
            return false;
          }
          store.markSaved(revision);
          onDefinitionChange(saved);
          return true;
        } catch (saveError) {
          endWorkflowOperation(mutationLockRef);
          if (activeDefinitionIdRef.current === definition.id) setError(messageFor(saveError));
          return false;
        } finally {
          if (
            isCurrentWorkflowRequest(
              activeDefinitionIdRef.current,
              saveRequestIdRef.current,
              request,
            )
          ) {
            setSaving(false);
          }
        }
      },
      cancelPreparedNavigation: (navigationError) => {
        endWorkflowOperation(mutationLockRef);
        setError(messageFor(navigationError));
      },
    }),
    [
      definition.id,
      editorInstanceId,
      leaseStatus,
      onDefinitionChange,
      publishing,
      restoring,
      store,
    ],
  );

  const runLayout = useCallback(async () => {
    const leaseToken = leaseTokenRef.current;
    if (!draft || !canEdit || !leaseToken || mutationLockRef.current) return;
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
      if (mutationLockRef.current) return;
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
  const selectedEdge =
    selection?.kind === 'edge'
      ? (draft.graph.edges.find((edge) => edge.id === selection.id) ?? null)
      : null;
  const selectedIssues = selectedNode
    ? (issuesByNode.get(selectedNode.id) ?? [])
    : selectedEdge
      ? (issuesByEdge.get(selectedEdge.id) ?? [])
      : [];

  const publish = async () => {
    if (
      !validation.valid ||
      !canEdit ||
      saving ||
      restoreLockRef.current ||
      leaseStatus?.state !== 'owned' ||
      !beginWorkflowOperation(mutationLockRef)
    )
      return;
    const leaseToken = leaseStatus.leaseToken;
    const reviewedDraft = draft;
    const request = {
      definitionId: definition.id,
      requestId: ++publishRequestIdRef.current,
    };
    proposalRequestIdRef.current += 1;
    setAssistantBusy(false);
    setAssistantOpen(false);
    setPublishing(true);
    setError(null);
    try {
      if (dirty) {
        const revision = draftRevision;
        const saved = await api.workflowDefinitions.saveDraft(definition.id, reviewedDraft, {
          editorInstanceId,
          leaseToken,
        });
        if (
          !isCurrentWorkflowRequest(
            activeDefinitionIdRef.current,
            publishRequestIdRef.current,
            request,
          )
        )
          return;
        if (leaseTokenRef.current !== leaseToken) return;
        onDefinitionChange(saved);
        store.markSaved(revision);
      }
      await api.workflowDefinitions.publish(definition.id, reviewedDraft, {
        editorInstanceId,
        leaseToken,
      });
      const [updated, nextVersions] = await Promise.all([
        api.workflowDefinitions.get(definition.id),
        api.workflowDefinitions.versions(definition.id),
      ]);
      if (
        !isCurrentWorkflowRequest(
          activeDefinitionIdRef.current,
          publishRequestIdRef.current,
          request,
        )
      )
        return;
      if (leaseTokenRef.current !== leaseToken) return;
      onDefinitionChange(updated);
      onVersionsChange(nextVersions);
      setTray('versions');
    } catch (publishError) {
      if (
        isCurrentWorkflowRequest(
          activeDefinitionIdRef.current,
          publishRequestIdRef.current,
          request,
        )
      )
        setError(messageFor(publishError));
    } finally {
      if (
        isCurrentWorkflowRequest(
          activeDefinitionIdRef.current,
          publishRequestIdRef.current,
          request,
        )
      ) {
        endWorkflowOperation(mutationLockRef);
        setPublishing(false);
      }
    }
  };

  const requestProposal = async (prompt: string) => {
    if (!canEdit || restoreLockRef.current || mutationLockRef.current) return;
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
    if (leaseBusyRef.current) return;
    const request = {
      definitionId: definition.id,
      requestId: ++leaseRequestIdRef.current,
    };
    leaseBusyRef.current = true;
    setLeaseBusy(true);
    restoreLockRef.current = false;
    endWorkflowOperation(mutationLockRef);
    setError(null);
    saveRequestIdRef.current += 1;
    publishRequestIdRef.current += 1;
    proposalRequestIdRef.current += 1;
    setSaving(false);
    setRestoring(false);
    setAssistantBusy(false);
    setInsertEdgeId(null);
    setAssistantOpen(false);
    try {
      const status = await api.workflowDefinitions.lease.takeover(definition.id, editorInstanceId);
      if (activeDefinitionIdRef.current !== definition.id) {
        if (status.state === 'owned')
          await api.workflowDefinitions.lease
            .release(definition.id, { editorInstanceId, leaseToken: status.leaseToken })
            .catch(() => undefined);
        return;
      }
      if (
        !isCurrentWorkflowRequest(activeDefinitionIdRef.current, leaseRequestIdRef.current, request)
      )
        return;
      if (status.state !== 'owned') {
        setLeaseStatus(status);
        leaseTokenRef.current = null;
        return;
      }

      leaseTokenRef.current = status.leaseToken;
      try {
        const authoritative = await api.workflowDefinitions.get(definition.id);
        if (
          !isCurrentWorkflowRequest(
            activeDefinitionIdRef.current,
            leaseRequestIdRef.current,
            request,
          )
        )
          return;
        store.loadDraft(authoritative.currentDraft);
        onDefinitionChange(authoritative);
        setLeaseStatus(status);
      } catch (loadError) {
        await api.workflowDefinitions.lease
          .release(definition.id, { editorInstanceId, leaseToken: status.leaseToken })
          .catch(() => undefined);
        leaseTokenRef.current = null;
        setLeaseStatus({ state: 'available' });
        throw loadError;
      }
    } catch (leaseError) {
      if (
        isCurrentWorkflowRequest(activeDefinitionIdRef.current, leaseRequestIdRef.current, request)
      )
        setError(messageFor(leaseError));
    } finally {
      if (
        isCurrentWorkflowRequest(activeDefinitionIdRef.current, leaseRequestIdRef.current, request)
      ) {
        leaseBusyRef.current = false;
        setLeaseBusy(false);
      }
    }
  };

  const restoreVersion = async (versionId: string) => {
    if (
      !canRestoreWorkflowDraft({ ownsLease, dirty, saving, publishing, restoring }) ||
      restoreLockRef.current ||
      !ownsWorkflowDraftLease(leaseStatus) ||
      !beginWorkflowOperation(mutationLockRef)
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
      await api.workflowDefinitions.restore(definition.id, versionId, {
        editorInstanceId,
        leaseToken,
      });
      const authoritative = await api.workflowDefinitions.get(definition.id);
      if (activeDefinitionIdRef.current !== definition.id) return;
      if (leaseTokenRef.current !== leaseToken) return;
      if (useWorkflowBuilderStore.getState().draftRevision !== startingRevision) {
        throw new Error('The canvas changed while restoring. Reload before trying again.');
      }
      store.loadDraft(authoritative.currentDraft);
      onDefinitionChange(authoritative);
    } catch (restoreError) {
      if (activeDefinitionIdRef.current === definition.id && leaseTokenRef.current === leaseToken)
        setError(messageFor(restoreError));
    } finally {
      if (activeDefinitionIdRef.current === definition.id && leaseTokenRef.current === leaseToken) {
        restoreLockRef.current = false;
        endWorkflowOperation(mutationLockRef);
        setRestoring(false);
      }
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 bg-muted/30 px-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-foreground">{definition.name}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {definition.domain.replace('_', ' ')}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:block">
            {leaseStatus === null
              ? 'Checking edit access'
              : ownsLease
                ? publishing
                  ? 'Publishing reviewed draft'
                  : restoring
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void takeOverEditing()}
              disabled={leaseBusy}
              className="border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
            >
              {leaseBusy ? 'Checking access' : 'Take over editing'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runLayout()}
            disabled={!canEdit}
            className="gap-1.5"
          >
            <LayoutGrid className="size-3.5" /> Layout
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void publish()}
            disabled={!validation.valid || publishing || saving || !canEdit}
            className="gap-1.5"
          >
            <Upload className="size-3.5" /> {publishing ? 'Publishing' : 'Publish'}
          </Button>
        </div>
      </div>
      {error ? (
        <div className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
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
            if (canEdit && !restoreLockRef.current && !mutationLockRef.current)
              store.addNode(type, position);
          }}
          onAddNote={() => {
            if (canEdit && !restoreLockRef.current && !mutationLockRef.current)
              store.addNote({ x: 180, y: 340 });
          }}
        />
        <div className="relative min-w-0 flex-1 bg-background">
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
            onEdgeClick={(_, edge) => store.select({ kind: 'edge', id: edge.id })}
            onPaneClick={() => store.select(null)}
            onNodesChange={(changes: NodeChange[]) => {
              if (!canEdit || restoreLockRef.current || mutationLockRef.current) return;
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
              if (!canEdit || restoreLockRef.current || mutationLockRef.current) return;
              nodes.forEach((node) =>
                node.type === 'note' ? store.removeNote(node.id) : store.removeNode(node.id),
              );
            }}
            onEdgesDelete={(edges: Edge[]) => {
              if (!canEdit || restoreLockRef.current || mutationLockRef.current) return;
              edges.forEach((edge) => store.removeEdge(edge.id));
            }}
            onConnect={(connection: Connection) => {
              if (canEdit && !restoreLockRef.current && !mutationLockRef.current)
                store.connect(connection);
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
              if (!canEdit || restoreLockRef.current || mutationLockRef.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(event) => {
              if (!canEdit || restoreLockRef.current || mutationLockRef.current) return;
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
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d8d4cc" />
            <Controls
              showInteractive={false}
              className="!rounded-md !border-border !bg-card !shadow-sm [&_button]:!border-border [&_button]:!bg-card [&_button]:!fill-muted-foreground [&_button:hover]:!bg-muted"
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
              if (!canEdit || restoreLockRef.current || mutationLockRef.current) return;
              if (!store.applyAssistantProposal())
                setAssistantError('The canvas changed. Regenerate this proposal.');
            }}
            onReject={() => store.setAssistantProposal(null)}
          />
          <WorkflowInsertDialog
            open={Boolean(insertEdgeId && canEdit)}
            onOpenChange={(open) => {
              if (!open) setInsertEdgeId(null);
            }}
            items={availableNodeDefinitions(draft.graph.domain).filter(
              (item) => item.ports.inputs.length > 0 && item.ports.outputs.length === 1,
            )}
            returnFocusRef={insertDialogTriggerRef}
            onInsert={(type) => {
              if (!insertEdgeId || !canEdit || restoreLockRef.current || mutationLockRef.current)
                return;
              store.insertNodeOnEdge(insertEdgeId, type);
              setInsertEdgeId(null);
            }}
          />
        </div>
        {selection && canEdit ? (
          <WorkflowInspector
            node={selectedNode}
            edge={selectedEdge}
            note={selectedNote}
            nodes={draft.graph.nodes}
            issues={selectedIssues}
            onClose={() => store.select(null)}
            onReplaceNode={(node) => {
              if (canEdit && !restoreLockRef.current && !mutationLockRef.current)
                store.replaceNode(node);
            }}
            onReplaceEdge={(edge) => {
              if (canEdit && !restoreLockRef.current && !mutationLockRef.current)
                store.replaceEdge(edge);
            }}
            onUpdateNote={(noteId, text) => {
              if (canEdit && !restoreLockRef.current && !mutationLockRef.current)
                store.updateNote(noteId, text);
            }}
            onRemoveNode={(nodeId) => {
              if (canEdit && !restoreLockRef.current && !mutationLockRef.current)
                store.removeNode(nodeId);
            }}
            onRemoveEdge={(edgeId) => {
              if (canEdit && !restoreLockRef.current && !mutationLockRef.current)
                store.removeEdge(edgeId);
            }}
            onRemoveNote={(noteId) => {
              if (canEdit && !restoreLockRef.current && !mutationLockRef.current)
                store.removeNote(noteId);
            }}
          />
        ) : null}
      </div>
      <div className="shrink-0 border-t border-border/70 bg-muted/30">
        <div className="flex h-9 items-center px-3">
          <button
            type="button"
            onClick={() => setTray(tray === 'validation' ? null : 'validation')}
            className={`flex h-full items-center gap-1.5 border-r border-border/70 pr-3 text-xs ${validation.valid ? 'text-success' : 'text-amber-700'}`}
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
            className="flex h-full items-center gap-1.5 px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            <History className="size-3" />{' '}
            {versions.length ? `Version ${versions[0]?.version}` : 'No published version'}
          </button>
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <Save className="size-3" /> Draft {draftRevision}
          </span>
          <button
            type="button"
            onClick={() => setTray(null)}
            aria-label="Close tray"
            className="ml-3 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
        {tray === 'validation' ? (
          <div className="max-h-32 overflow-y-auto border-t border-border/70 px-3 py-2">
            {validation.issues.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                All required connections and settings are valid.
              </p>
            ) : (
              validation.issues.map((issue) => (
                <button
                  key={`${issue.code}-${issue.path.join('.')}`}
                  type="button"
                  onClick={() => {
                    const edgeId = issue.edgeIds?.[0];
                    if (edgeId) {
                      store.select({ kind: 'edge', id: edgeId });
                      return;
                    }
                    const nodeId = issue.nodeIds?.[0];
                    if (nodeId) store.select({ kind: 'node', id: nodeId });
                  }}
                  className="flex w-full items-center gap-2 py-1 text-left text-xs text-amber-800 hover:text-amber-950"
                >
                  <span className="font-mono text-amber-600">{issue.code}</span>
                  <span>{issue.message}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
        {tray === 'versions' ? (
          <div className="max-h-40 overflow-y-auto border-t border-border/70">
            {versions.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                Publish this draft to create version 1.
              </p>
            ) : (
              versions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center border-b border-border/60 px-3 py-2 text-xs"
                >
                  <span className="font-semibold text-foreground">Version {version.version}</span>
                  <span className="ml-3 text-muted-foreground">
                    {new Date(version.publishedAt).toLocaleString()}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
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
                    className="ml-auto"
                  >
                    Restore as draft
                  </Button>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});

function WorkflowBuilderInner() {
  const loadDraft = useWorkflowBuilderStore((state) => state.loadDraft);
  const openRequestIdRef = useRef(0);
  const builderRef = useRef<BuilderCanvasHandle>(null);
  const navigationLockRef = useRef(false);
  const [definitions, setDefinitions] = useState<WorkflowDefinitionRecord[]>([]);
  const [active, setActive] = useState<WorkflowDefinitionRecord | null>(null);
  const [versions, setVersions] = useState<WorkflowDefinitionVersionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [navigationBusy, setNavigationBusy] = useState(false);
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
  const leaveActiveWorkflow = async (navigate: () => void | Promise<void>) => {
    if (navigationLockRef.current) return;
    setNavigationBusy(true);
    try {
      await navigateAfterDraftFlush(
        navigationLockRef,
        () => builderRef.current?.flushDraftBeforeNavigation() ?? Promise.resolve(true),
        navigate,
        (navigationError) => builderRef.current?.cancelPreparedNavigation(navigationError),
      );
    } catch {
      // The mounted canvas keeps the user in place and surfaces the load failure.
    } finally {
      setNavigationBusy(false);
    }
  };
  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[620px] flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title="Approval workflows"
        description="Design, validate, and publish the approval logic that routes requisitions, invoices, and PO changes."
        actions={
          active ? (
            <div className="flex items-center gap-3">
              <Select
                value={active.id}
                disabled={navigationBusy}
                onChange={(event) => {
                  const next = definitions.find((item) => item.id === event.target.value);
                  if (next) void leaveActiveWorkflow(() => openDefinition(next));
                }}
                className="w-56"
              >
                {definitions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={navigationBusy}
                onClick={() => {
                  void leaveActiveWorkflow(() => {
                    openRequestIdRef.current += 1;
                    setActive(null);
                  });
                }}
                className="gap-2"
              >
                <Plus className="h-4 w-4" /> New
              </Button>
            </div>
          ) : null
        }
      />
      {loading ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
          Loading workflows
        </div>
      ) : active ? (
        <BuilderCanvas
          ref={builderRef}
          key={active.id}
          definition={active}
          versions={versions}
          onDefinitionChange={(next) => {
            setActive(next);
            setDefinitions((items) => items.map((item) => (item.id === next.id ? next : item)));
          }}
          onVersionsChange={setVersions}
          navigationBusy={navigationBusy}
        />
      ) : (
        <div className="grid flex-1 place-items-center p-6">
          <div className="w-full max-w-md rounded-lg border border-border/70 bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
              New workflow
            </h2>
            <div className="mt-5 grid gap-4">
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Name
                </span>
                <Input
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Domain
                </span>
                <Select
                  value={createDomain}
                  onChange={(event) => setCreateDomain(event.target.value as WorkflowDomain)}
                >
                  {domains.map((domain) => (
                    <option key={domain.value} value={domain.value}>
                      {domain.label}
                    </option>
                  ))}
                </Select>
              </label>
              {error ? <div className="text-xs text-destructive">{error}</div> : null}
              <Button
                type="button"
                onClick={() => void createDefinition()}
                disabled={creating || !createName.trim()}
              >
                {creating ? 'Creating' : 'Create workflow'}
              </Button>
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
