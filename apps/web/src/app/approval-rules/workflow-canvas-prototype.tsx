'use client';

// THROWAWAY PROTOTYPE, issue #130.
// Three variants of the approval workflow canvas, switchable via ?variant=, on the existing /approval-rules route.
// All edits are in-memory stubs. This file must not be promoted directly to production.

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Command,
  Eye,
  GitBranch,
  GripVertical,
  History,
  LayoutGrid,
  LockKeyhole,
  Maximize2,
  MessageSquareText,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Split,
  StickyNote,
  UserRoundCheck,
  Wand2,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react';

type VariantKey = 'A' | 'B' | 'C';
type NodeTone = 'trigger' | 'logic' | 'approval' | 'terminal' | 'note';

type PrototypeNode = {
  id: string;
  type: string;
  name: string;
  detail: string;
  tone: NodeTone;
  icon: LucideIcon;
  inputs: string[];
  outputs: string[];
  disabled?: boolean;
  issue?: string;
};

const VARIANT_NAMES: Record<VariantKey, string> = {
  A: 'Focus canvas',
  B: 'Three-pane studio',
  C: 'Command canvas',
};

const SAMPLE_NODES: PrototypeNode[] = [
  {
    id: 'trigger',
    type: 'Trigger',
    name: 'Requisition submitted',
    detail: 'Any entity',
    tone: 'trigger',
    icon: Zap,
    inputs: [],
    outputs: ['out'],
  },
  {
    id: 'amount',
    type: 'Condition',
    name: 'Total amount',
    detail: 'First true branch',
    tone: 'logic',
    icon: Split,
    inputs: ['in'],
    outputs: ['< $10k', '$10k+', 'default'],
  },
  {
    id: 'manager',
    type: 'Resolver',
    name: 'Manager chain',
    detail: 'Up to spend limit',
    tone: 'approval',
    icon: UserRoundCheck,
    inputs: ['in'],
    outputs: ['out'],
  },
  {
    id: 'budget',
    type: 'Budget check',
    name: 'Department budget',
    detail: 'Organization policy',
    tone: 'logic',
    icon: ShieldCheck,
    inputs: ['in'],
    outputs: ['available', 'breach'],
  },
  {
    id: 'finance',
    type: 'Approver group',
    name: 'Finance review',
    detail: 'Parallel, majority',
    tone: 'approval',
    icon: UserRoundCheck,
    inputs: ['in'],
    outputs: ['out'],
    issue: 'Fallback resolver required',
  },
  {
    id: 'timer',
    type: 'Escalation',
    name: '48h escalation',
    detail: 'Reassign to CFO',
    tone: 'approval',
    icon: Clock3,
    inputs: ['in'],
    outputs: ['out'],
  },
  {
    id: 'notify',
    type: 'Notify',
    name: 'Slack watchers',
    detail: 'Disabled in draft',
    tone: 'approval',
    icon: Send,
    inputs: ['in'],
    outputs: ['out'],
    disabled: true,
  },
  {
    id: 'auto',
    type: 'Terminal',
    name: 'Auto-approve',
    detail: 'Below threshold',
    tone: 'terminal',
    icon: BadgeCheck,
    inputs: ['in'],
    outputs: [],
  },
  {
    id: 'approved',
    type: 'Terminal',
    name: 'Approved',
    detail: 'Issue purchase order',
    tone: 'terminal',
    icon: Check,
    inputs: ['in'],
    outputs: [],
  },
  {
    id: 'note',
    type: 'Sticky note',
    name: 'Policy review',
    detail: 'Confirm FY27 threshold with Finance before publish.',
    tone: 'note',
    icon: StickyNote,
    inputs: [],
    outputs: [],
  },
];

const NODE_POSITIONS: Record<string, { left: number; top: number }> = {
  trigger: { left: 70, top: 245 },
  amount: { left: 300, top: 245 },
  manager: { left: 560, top: 115 },
  budget: { left: 560, top: 365 },
  finance: { left: 820, top: 365 },
  timer: { left: 820, top: 115 },
  notify: { left: 1070, top: 115 },
  auto: { left: 820, top: 540 },
  approved: { left: 1080, top: 365 },
  note: { left: 320, top: 505 },
};

const EDGE_PATHS = [
  'M 248 302 C 272 302, 276 302, 300 302',
  'M 478 280 C 520 280, 510 170, 560 170',
  'M 478 324 C 520 324, 510 420, 560 420',
  'M 478 344 C 500 344, 510 595, 820 595',
  'M 738 170 C 775 170, 780 170, 820 170',
  'M 738 420 C 775 420, 780 420, 820 420',
  'M 998 170 C 1030 170, 1040 170, 1070 170',
  'M 998 420 C 1030 420, 1040 420, 1080 420',
];

const PALETTE_GROUPS = [
  { label: 'Entry', items: ['Requisition submitted', 'Invoice submitted', 'PO change order'] },
  { label: 'Logic', items: ['Condition / split', 'Budget check', 'Match check'] },
  {
    label: 'Approval',
    items: ['Approver group', 'Manager resolver', 'Delegation', 'Escalation timer'],
  },
  { label: 'Outcome', items: ['Auto-approve', 'Reject', 'Approved'] },
];

const canvasGrid: CSSProperties = {
  backgroundColor: '#050505',
  backgroundImage: 'radial-gradient(circle, rgba(255,255,255,.13) 1px, transparent 1px)',
  backgroundSize: '20px 20px',
};

function IconButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center border border-white/15 bg-black text-zinc-300 hover:border-white/35 hover:text-white focus-visible:ring-white/80"
    >
      {children}
    </button>
  );
}

function StatusLine({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3 text-[11px] text-zinc-400">
      <span className="flex items-center gap-1.5 text-amber-300">
        <CircleDot className="size-3" /> Draft v8
      </span>
      <span className="hidden h-3 w-px bg-white/15 sm:block" />
      <span className={compact ? 'hidden xl:inline' : ''}>Last saved 12 sec ago</span>
      <span className="hidden items-center gap-1.5 text-zinc-300 lg:flex">
        <LockKeyhole className="size-3" /> You hold the draft lock
      </span>
    </div>
  );
}

function WorkflowHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className="flex min-h-14 flex-wrap items-center gap-3 border-b border-white/12 bg-black px-4 py-2 text-white">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Workflow className="size-4 text-orange-400" />
          <h1 className="truncate text-sm font-semibold">High-value requisitions</h1>
          <span className="border border-white/15 px-1.5 py-0.5 text-[10px] text-zinc-400">
            Requisition
          </span>
        </div>
        {!compact ? <StatusLine /> : null}
      </div>
      {compact ? <StatusLine compact /> : null}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="flex h-8 items-center gap-2 border border-white/15 px-3 text-xs text-zinc-300 hover:border-white/35 hover:text-white"
        >
          <Eye className="size-3.5" /> Simulate
        </button>
        <button
          type="button"
          className="flex h-8 items-center gap-2 bg-white px-3 text-xs font-semibold text-black hover:bg-zinc-200"
        >
          <Send className="size-3.5" /> Publish
        </button>
      </div>
    </header>
  );
}

function TypedPorts({ node }: { node: PrototypeNode }) {
  return (
    <>
      {node.inputs.map((port, index) => (
        <span
          key={`in-${port}`}
          title={`Input: ${port}`}
          className="absolute -left-1 top-[calc(50%+var(--port-shift,0px))] size-2 -translate-y-1/2 border border-sky-300 bg-black"
          style={{ '--port-shift': `${index * 13}px` } as CSSProperties}
        />
      ))}
      {node.outputs.map((port, index) => (
        <span
          key={`out-${port}`}
          title={`Output: ${port}`}
          className="absolute -right-1 top-[calc(44%+var(--port-shift,0px))] size-2 -translate-y-1/2 border border-orange-300 bg-black"
          style={{ '--port-shift': `${index * 13}px` } as CSSProperties}
        />
      ))}
    </>
  );
}

function CanvasNode({
  node,
  selected,
  onSelect,
  dense = false,
}: {
  node: PrototypeNode;
  selected?: boolean;
  onSelect?: () => void;
  dense?: boolean;
}) {
  const Icon = node.icon;
  if (node.tone === 'note') {
    return (
      <button
        type="button"
        onClick={onSelect}
        className="w-[210px] -rotate-1 border border-amber-200/40 bg-[#241f08] p-3 text-left text-amber-50 shadow-[4px_4px_0_rgba(0,0,0,.45)] hover:border-amber-200/70"
      >
        <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-300">
          <StickyNote className="size-3" /> {node.name}
        </span>
        <span className="mt-2 block text-xs leading-5 text-amber-100/80">{node.detail}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative w-[178px] border bg-[#0b0b0b] text-left shadow-[0_8px_24px_rgba(0,0,0,.45)] ${
        selected
          ? 'border-orange-400 ring-1 ring-orange-400/40'
          : 'border-white/18 hover:border-white/40'
      } ${node.disabled ? 'opacity-45' : ''}`}
    >
      <TypedPorts node={node} />
      <span
        className={`flex items-center gap-2 border-b border-white/10 px-2.5 ${dense ? 'py-1.5' : 'py-2'}`}
      >
        <Icon
          className={`size-3.5 ${node.tone === 'terminal' ? 'text-emerald-300' : node.tone === 'logic' ? 'text-sky-300' : node.tone === 'trigger' ? 'text-orange-300' : 'text-violet-300'}`}
        />
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          {node.type}
        </span>
        {node.disabled ? (
          <span className="ml-auto text-[9px] uppercase text-zinc-500">Off</span>
        ) : null}
        {node.issue ? <AlertTriangle className="ml-auto size-3.5 text-amber-300" /> : null}
      </span>
      <span className={`block px-2.5 ${dense ? 'py-2' : 'py-2.5'}`}>
        <span className="block truncate text-xs font-semibold text-white">{node.name}</span>
        <span className="mt-1 block truncate font-mono text-[9px] text-zinc-500">
          {node.detail}
        </span>
      </span>
      {node.outputs.length > 1 ? (
        <span className="flex border-t border-white/10 px-2.5 py-1 font-mono text-[8px] text-zinc-500">
          {node.outputs.slice(0, 2).join('  /  ')}
        </span>
      ) : null}
    </button>
  );
}

function CanvasChrome({ children, onFit }: { children?: ReactNode; onFit?: () => void }) {
  return (
    <div className="absolute bottom-4 left-4 z-20 flex items-center border border-white/15 bg-black shadow-xl">
      <button
        type="button"
        className="h-8 border-r border-white/15 px-2.5 text-xs text-zinc-300 hover:text-white"
      >
        62%
      </button>
      <IconButton label="Fit workflow" onClick={onFit}>
        <Maximize2 className="size-3.5" />
      </IconButton>
      <IconButton label="Auto layout">
        <Wand2 className="size-3.5" />
      </IconButton>
      {children}
    </div>
  );
}

function EdgePlus({ left, top, onClick }: { left: number; top: number; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label="Add node on this edge"
      onClick={onClick}
      className="absolute z-10 grid size-5 place-items-center border border-white/30 bg-black text-zinc-300 shadow-lg hover:border-orange-300 hover:text-orange-200 focus-visible:ring-orange-300"
      style={{ left, top }}
    >
      <Plus className="size-3" />
    </button>
  );
}

function WorkflowCanvas({
  selectedNodeId,
  onSelectNode,
  onAddEdge,
  compact = false,
}: {
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  onAddEdge: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className="relative h-full min-h-[620px] min-w-[1260px] overflow-hidden"
      style={canvasGrid}
    >
      <svg className="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#71717a" />
          </marker>
        </defs>
        {EDGE_PATHS.map((path) => (
          <path
            key={path}
            d={path}
            fill="none"
            stroke="#52525b"
            strokeWidth="1.2"
            markerEnd="url(#arrow)"
          />
        ))}
      </svg>
      <div className="absolute left-[490px] top-[248px] font-mono text-[9px] text-zinc-500">
        $10k+
      </div>
      <div className="absolute left-[492px] top-[340px] font-mono text-[9px] text-zinc-500">
        default
      </div>
      <div className="absolute left-[495px] top-[573px] font-mono text-[9px] text-zinc-500">
        &lt; $10k
      </div>
      {SAMPLE_NODES.map((node) => {
        const position = NODE_POSITIONS[node.id];
        return (
          <div key={node.id} className="absolute" style={position}>
            <CanvasNode
              node={node}
              selected={selectedNodeId === node.id}
              onSelect={() => onSelectNode(node.id)}
              dense={compact}
            />
          </div>
        );
      })}
      <EdgePlus left={510} top={283} onClick={onAddEdge} />
      <EdgePlus left={780} top={410} onClick={onAddEdge} />
      <div className="absolute right-4 top-4 border border-white/12 bg-black/90 p-2 font-mono text-[9px] text-zinc-500">
        9 nodes · 8 edges · DAG
      </div>
      <CanvasChrome />
    </div>
  );
}

function NodePicker({ onPick, onClose }: { onPick: () => void; onClose: () => void }) {
  return (
    <div className="absolute left-1/2 top-1/2 z-40 w-[320px] -translate-x-1/2 -translate-y-1/2 border border-white/25 bg-[#0a0a0a] p-3 shadow-[0_20px_80px_rgba(0,0,0,.8)]">
      <div className="flex items-center gap-2 border-b border-white/12 pb-3">
        <Search className="size-4 text-zinc-500" />
        <input
          autoFocus
          aria-label="Search nodes"
          placeholder="Insert on edge..."
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
        />
        <button type="button" onClick={onClose} aria-label="Close picker">
          <X className="size-4 text-zinc-500" />
        </button>
      </div>
      <div className="pt-2">
        <div className="px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-600">
          Valid next nodes
        </div>
        {['Approver group', 'Budget check', 'Notify watchers', 'Collect request details'].map(
          (item, index) => (
            <button
              key={item}
              type="button"
              onClick={onPick}
              className="flex w-full items-center gap-3 px-2 py-2 text-left text-xs text-zinc-300 hover:bg-white/8 hover:text-white"
            >
              <span className="grid size-7 place-items-center border border-white/15">
                <Workflow className="size-3.5" />
              </span>
              <span>{item}</span>
              {index === 0 ? (
                <span className="ml-auto font-mono text-[9px] text-zinc-600">A</span>
              ) : null}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function ConfigFields({
  selectedNode,
  terse = false,
}: {
  selectedNode: PrototypeNode;
  terse?: boolean;
}) {
  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
        Step name
        <input
          defaultValue={selectedNode.name}
          className="h-9 border border-white/15 bg-black px-2.5 text-xs normal-case tracking-normal text-white focus:border-orange-300"
        />
      </label>
      {selectedNode.id === 'finance' ? (
        <>
          <label className="grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
            Execution
            <select
              defaultValue="parallel"
              className="h-9 border border-white/15 bg-black px-2.5 text-xs normal-case tracking-normal text-white"
            >
              <option value="parallel">Parallel</option>
              <option value="serial">Serial</option>
            </select>
          </label>
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Resolvers
            </div>
            <div className="border border-white/15">
              {['Finance · global', 'Controller · entity'].map((resolver) => (
                <div
                  key={resolver}
                  className="flex items-center gap-2 border-b border-white/10 px-2.5 py-2 text-xs text-zinc-300 last:border-0"
                >
                  <GripVertical className="size-3 text-zinc-600" /> {resolver}
                  <X className="ml-auto size-3 text-zinc-600" />
                </div>
              ))}
            </div>
          </div>
          {!terse ? (
            <label className="flex items-start gap-2 border border-amber-300/30 bg-amber-300/5 p-2.5 text-xs text-amber-100">
              <input type="checkbox" defaultChecked className="mt-0.5 accent-orange-400" />
              <span>
                <strong className="block font-semibold">Separation of duties</strong>
                <span className="mt-1 block text-[10px] leading-4 text-amber-100/65">
                  Exclude requester. A fallback resolver is still required.
                </span>
              </span>
            </label>
          ) : null}
        </>
      ) : (
        <div className="border border-white/12 px-3 py-2 text-xs text-zinc-400">
          Schema fields for <span className="font-mono text-zinc-200">{selectedNode.type}</span>{' '}
          appear here.
        </div>
      )}
      <div className="flex items-center justify-between border-t border-white/12 pt-3 text-xs">
        <label className="flex items-center gap-2 text-zinc-300">
          <input
            type="checkbox"
            defaultChecked={!selectedNode.disabled}
            className="accent-orange-400"
          />{' '}
          Enabled
        </label>
        <span className="text-zinc-600">Changes stay in memory</span>
      </div>
    </div>
  );
}

function ValidationSummary({ expanded = false }: { expanded?: boolean }) {
  return (
    <div className={expanded ? 'grid gap-2' : 'flex items-center gap-3'}>
      <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
        <AlertTriangle className="size-3.5" /> 1 publish blocker
      </span>
      <span className="text-[10px] text-zinc-500">
        Finance review needs a fallback resolver for separation of duties.
      </span>
      {expanded ? (
        <button
          type="button"
          className="w-fit text-[10px] font-semibold text-white underline underline-offset-4"
        >
          Jump to node
        </button>
      ) : null}
    </div>
  );
}

function VariantA() {
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState('finance');
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedNode = SAMPLE_NODES.find((node) => node.id === selectedNodeId) ?? SAMPLE_NODES[0];

  return (
    <section className="flex min-h-[calc(100vh-4.5rem)] flex-col bg-black text-white">
      <WorkflowHeader />
      <div className="flex min-h-0 flex-1">
        <aside
          className={`${paletteOpen ? 'w-56' : 'w-12'} shrink-0 border-r border-white/12 bg-[#070707] transition-[width]`}
        >
          <div className="flex h-11 items-center border-b border-white/12 px-2">
            {paletteOpen ? <span className="px-2 text-xs font-semibold">Nodes</span> : null}
            <button
              type="button"
              onClick={() => setPaletteOpen((open) => !open)}
              className="ml-auto grid size-7 place-items-center text-zinc-500 hover:text-white"
              aria-label={paletteOpen ? 'Collapse node palette' : 'Open node palette'}
            >
              {paletteOpen ? (
                <PanelLeftClose className="size-4" />
              ) : (
                <PanelLeftOpen className="size-4" />
              )}
            </button>
          </div>
          {paletteOpen ? (
            <div className="h-[calc(100%-2.75rem)] overflow-y-auto p-2">
              <label className="mb-3 flex h-8 items-center gap-2 border border-white/12 px-2">
                <Search className="size-3.5 text-zinc-600" />
                <input
                  aria-label="Search nodes"
                  placeholder="Search nodes"
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-zinc-700"
                />
              </label>
              {PALETTE_GROUPS.map((group) => (
                <div key={group.label} className="mb-4">
                  <div className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
                    {group.label}
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="flex w-full items-center gap-2 px-1.5 py-1.5 text-left text-[11px] text-zinc-400 hover:bg-white/7 hover:text-white"
                    >
                      <GripVertical className="size-3 text-zinc-700" /> {item}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-1 p-2">
              {[Zap, Split, UserRoundCheck, Check].map((Icon, index) => (
                <IconButton key={index} label="Open node category">
                  <Icon className="size-3.5" />
                </IconButton>
              ))}
            </div>
          )}
        </aside>

        <div className="relative min-w-0 flex-1 overflow-auto">
          <WorkflowCanvas
            selectedNodeId={selectedNodeId}
            onSelectNode={(id) => {
              setSelectedNodeId(id);
              setInspectorOpen(true);
            }}
            onAddEdge={() => setPickerOpen(true)}
          />
          {pickerOpen ? (
            <NodePicker onPick={() => setPickerOpen(false)} onClose={() => setPickerOpen(false)} />
          ) : null}
          <div className="absolute left-4 top-4 z-20 flex items-center gap-1 border border-white/15 bg-black p-1">
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 bg-white/10 px-2 text-[10px] text-white"
            >
              <MousePointer2 className="size-3" /> Select
            </button>
            <IconButton label="Add sticky note">
              <StickyNote className="size-3.5" />
            </IconButton>
          </div>
        </div>

        {inspectorOpen ? (
          <aside className="w-[310px] shrink-0 border-l border-white/15 bg-[#080808]">
            <div className="flex h-11 items-center border-b border-white/12 px-3">
              <div>
                <div className="text-xs font-semibold">{selectedNode.name}</div>
                <div className="font-mono text-[9px] text-zinc-600">
                  {selectedNode.type} · {selectedNode.id}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectorOpen(false)}
                className="ml-auto text-zinc-600 hover:text-white"
                aria-label="Close inspector"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="border-b border-white/12 px-3 py-2 text-[10px] text-amber-200">
              <ValidationSummary expanded />
            </div>
            <div className="p-4">
              <ConfigFields selectedNode={selectedNode} />
            </div>
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setInspectorOpen(true)}
            className="w-10 shrink-0 border-l border-white/12 bg-[#070707] text-zinc-500 hover:text-white"
            aria-label="Open node inspector"
          >
            <Settings2 className="mx-auto size-4" />
          </button>
        )}
      </div>
    </section>
  );
}

function PalettePane() {
  return (
    <aside className="min-w-0 overflow-y-auto border-r border-white/12 bg-[#080808]">
      <div className="border-b border-white/12 p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-white">Node library</h2>
          <span className="font-mono text-[9px] text-zinc-600">13 types</span>
        </div>
        <label className="mt-2 flex h-8 items-center gap-2 border border-white/15 bg-black px-2">
          <Search className="size-3.5 text-zinc-600" />
          <input
            aria-label="Filter node library"
            placeholder="Filter"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
      </div>
      <div className="p-2">
        {PALETTE_GROUPS.map((group) => (
          <div key={group.label} className="mb-3 border-b border-white/8 pb-2">
            <button
              type="button"
              className="mb-1 flex w-full items-center gap-2 px-1 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-600"
            >
              <ChevronDown className="size-3" /> {group.label}
            </button>
            {group.items.map((item) => (
              <button
                key={item}
                type="button"
                className="group flex w-full items-center gap-2 border border-transparent px-1.5 py-1.5 text-left text-[10px] text-zinc-400 hover:border-white/15 hover:bg-black hover:text-white"
              >
                <span className="grid size-6 place-items-center border border-white/12 bg-black">
                  <Workflow className="size-3" />
                </span>
                <span className="truncate">{item}</span>
                <GripVertical className="ml-auto size-3 text-zinc-700 group-hover:text-zinc-400" />
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function VariantB() {
  const [selectedNodeId, setSelectedNodeId] = useState('finance');
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedNode = SAMPLE_NODES.find((node) => node.id === selectedNodeId) ?? SAMPLE_NODES[0];

  return (
    <section className="flex min-h-[calc(100vh-4.5rem)] flex-col bg-black text-white">
      <WorkflowHeader compact />
      <div className="grid min-h-0 flex-1 grid-cols-[190px_minmax(680px,1fr)_300px]">
        <PalettePane />
        <main className="flex min-w-0 flex-col bg-black">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/12 px-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
              Canvas
            </span>
            <span className="h-3 w-px bg-white/12" />
            <button
              type="button"
              className="flex items-center gap-1.5 text-[10px] text-zinc-400 hover:text-white"
            >
              <LayoutGrid className="size-3" /> Auto layout
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 text-[10px] text-zinc-400 hover:text-white"
            >
              <Braces className="size-3" /> Graph JSON
            </button>
            <span className="ml-auto font-mono text-[9px] text-zinc-600">9 nodes / 8 edges</span>
          </div>
          <div className="relative min-h-[620px] flex-1 overflow-auto">
            <WorkflowCanvas
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onAddEdge={() => setPickerOpen(true)}
              compact
            />
            {pickerOpen ? (
              <NodePicker
                onPick={() => setPickerOpen(false)}
                onClose={() => setPickerOpen(false)}
              />
            ) : null}
          </div>
          <div className="flex min-h-11 shrink-0 items-center gap-3 border-t border-white/12 bg-[#080808] px-3">
            <ValidationSummary />
            <button
              type="button"
              className="ml-auto text-[10px] font-semibold text-zinc-300 underline underline-offset-4"
            >
              Review all
            </button>
          </div>
        </main>
        <aside className="min-w-0 overflow-y-auto border-l border-white/12 bg-[#080808]">
          <div className="border-b border-white/12 px-4 py-3">
            <div className="flex items-start gap-2">
              <selectedNode.icon className="mt-0.5 size-4 text-violet-300" />
              <div className="min-w-0">
                <h2 className="truncate text-xs font-semibold">{selectedNode.name}</h2>
                <div className="font-mono text-[9px] text-zinc-600">
                  {selectedNode.type} · {selectedNode.id}
                </div>
              </div>
              <button type="button" className="ml-auto text-zinc-600">
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 border-b border-white/12 text-[10px] text-zinc-500">
            <button type="button" className="border-b border-orange-400 px-2 py-2.5 text-white">
              Configure
            </button>
            <button type="button" className="px-2 py-2.5 hover:text-white">
              Ports
            </button>
            <button type="button" className="px-2 py-2.5 hover:text-white">
              Notes
            </button>
          </div>
          <div className="p-4">
            <ConfigFields selectedNode={selectedNode} />
          </div>
          <div className="border-y border-white/12 px-4 py-3">
            <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
              Typed ports
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-[9px]">
              <span className="border border-sky-300/30 px-2 py-1.5 text-sky-200">
                in · request
              </span>
              <span className="border border-orange-300/30 px-2 py-1.5 text-orange-200">
                out · decision
              </span>
            </div>
          </div>
          <div className="p-4">
            <button
              type="button"
              className="w-full border border-white/15 py-2 text-xs text-zinc-300 hover:border-white/35 hover:text-white"
            >
              <RotateCcw className="mr-2 inline size-3.5" />
              Reset node changes
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function CommandBar({ onCommand }: { onCommand: () => void }) {
  return (
    <div className="absolute left-1/2 top-4 z-30 w-[min(620px,calc(100%-2rem))] -translate-x-1/2 border border-white/25 bg-black shadow-[0_12px_50px_rgba(0,0,0,.7)]">
      <button
        type="button"
        onClick={onCommand}
        className="flex h-11 w-full items-center gap-3 px-3 text-left"
      >
        <Command className="size-4 text-orange-300" />
        <span className="text-xs text-zinc-300">Add a step or jump to a node...</span>
        <kbd className="ml-auto border border-white/15 px-1.5 py-0.5 font-mono text-[9px] text-zinc-600">
          ⌘ K
        </kbd>
      </button>
      <div className="flex border-t border-white/10 px-2 py-1.5 text-[9px] text-zinc-600">
        <span>Try &quot;add finance approval after budget check&quot;</span>
        <span className="ml-auto">9 nodes</span>
      </div>
    </div>
  );
}

function VariantC() {
  const [selectedNodeId, setSelectedNodeId] = useState('finance');
  const [trayTab, setTrayTab] = useState<'validation' | 'config' | 'versions'>('validation');
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedNode = SAMPLE_NODES.find((node) => node.id === selectedNodeId) ?? SAMPLE_NODES[0];

  return (
    <section className="flex min-h-[calc(100vh-4.5rem)] flex-col bg-black text-white">
      <WorkflowHeader compact />
      <div className="relative min-h-[660px] flex-1 overflow-auto">
        <WorkflowCanvas
          selectedNodeId={selectedNodeId}
          onSelectNode={(id) => {
            setSelectedNodeId(id);
            setTrayTab('config');
          }}
          onAddEdge={() => setPickerOpen(true)}
        />
        <CommandBar onCommand={() => setPickerOpen(true)} />
        {pickerOpen ? (
          <NodePicker onPick={() => setPickerOpen(false)} onClose={() => setPickerOpen(false)} />
        ) : null}
        <div className="absolute right-4 top-4 z-20 grid gap-2">
          <IconButton label="Open workflow outline">
            <GitBranch className="size-3.5" />
          </IconButton>
          <IconButton label="Add sticky note">
            <MessageSquareText className="size-3.5" />
          </IconButton>
        </div>
      </div>
      <aside className="relative z-30 shrink-0 border-t border-white/18 bg-[#080808] shadow-[0_-16px_50px_rgba(0,0,0,.55)]">
        <div className="flex h-10 items-center border-b border-white/10 px-3">
          <button
            type="button"
            onClick={() => setTrayTab('validation')}
            className={`flex h-full items-center gap-2 border-b px-3 text-[10px] font-semibold ${trayTab === 'validation' ? 'border-amber-300 text-white' : 'border-transparent text-zinc-500'}`}
          >
            <AlertTriangle className="size-3" /> Validation{' '}
            <span className="bg-amber-300 px-1 text-[9px] text-black">1</span>
          </button>
          <button
            type="button"
            onClick={() => setTrayTab('config')}
            className={`flex h-full items-center gap-2 border-b px-3 text-[10px] font-semibold ${trayTab === 'config' ? 'border-orange-400 text-white' : 'border-transparent text-zinc-500'}`}
          >
            <Settings2 className="size-3" /> Selected node
          </button>
          <button
            type="button"
            onClick={() => setTrayTab('versions')}
            className={`flex h-full items-center gap-2 border-b px-3 text-[10px] font-semibold ${trayTab === 'versions' ? 'border-sky-300 text-white' : 'border-transparent text-zinc-500'}`}
          >
            <History className="size-3" /> Versions
          </button>
          <div className="ml-auto flex items-center gap-2 font-mono text-[9px] text-zinc-600">
            <Save className="size-3" /> Local draft state · 9 nodes
          </div>
        </div>
        <div className="h-32 overflow-auto px-4 py-3">
          {trayTab === 'validation' ? (
            <div className="grid grid-cols-[minmax(280px,1fr)_auto] items-center gap-6">
              <ValidationSummary expanded />
              <div className="flex items-center gap-4 text-[10px] text-zinc-500">
                <span className="text-emerald-300">8 checks passed</span>
                <button type="button" className="border border-white/15 px-3 py-2 text-white">
                  Run validation
                </button>
              </div>
            </div>
          ) : null}
          {trayTab === 'config' ? (
            <div className="grid grid-cols-[220px_1fr] gap-6">
              <div>
                <div className="text-xs font-semibold">{selectedNode.name}</div>
                <div className="mt-1 font-mono text-[9px] text-zinc-600">
                  {selectedNode.type} · {selectedNode.id}
                </div>
                <div className="mt-3 flex gap-2 font-mono text-[9px]">
                  <span className="border border-sky-300/30 px-2 py-1 text-sky-200">in</span>
                  <span className="border border-orange-300/30 px-2 py-1 text-orange-200">out</span>
                </div>
              </div>
              <div className="max-w-3xl">
                <ConfigFields selectedNode={selectedNode} terse />
              </div>
            </div>
          ) : null}
          {trayTab === 'versions' ? (
            <div className="flex items-center gap-6">
              <div>
                <div className="text-xs font-semibold text-amber-300">Draft v8</div>
                <div className="mt-1 text-[10px] text-zinc-600">Edited just now by you</div>
              </div>
              <div className="h-10 w-px bg-white/12" />
              <div>
                <div className="text-xs font-semibold">Published v7</div>
                <div className="mt-1 text-[10px] text-zinc-600">
                  Aug 26 by Tyler · 23 active runs
                </div>
              </div>
              <button
                type="button"
                className="ml-auto flex items-center gap-2 border border-white/15 px-3 py-2 text-[10px] text-zinc-300"
              >
                <RotateCcw className="size-3" /> Restore as draft
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    </section>
  );
}

function PrototypeSwitcher({
  current,
  onChange,
}: {
  current: VariantKey;
  onChange: (variant: VariantKey) => void;
}) {
  const variants = useMemo(() => ['A', 'B', 'C'] as const, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select, [contenteditable="true"]') ||
          target.isContentEditable)
      )
        return;
      event.preventDefault();
      const currentIndex = variants.indexOf(current);
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      onChange(variants[(currentIndex + direction + variants.length) % variants.length]);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [current, onChange, variants]);

  function cycle(direction: -1 | 1) {
    const currentIndex = variants.indexOf(current);
    onChange(variants[(currentIndex + direction + variants.length) % variants.length]);
  }

  return (
    <nav
      aria-label="Prototype variants"
      className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center border border-white/30 bg-[#171717] p-1 text-white shadow-[0_12px_50px_rgba(0,0,0,.8)]"
    >
      <button
        type="button"
        onClick={() => cycle(-1)}
        aria-label="Previous prototype variant"
        className="grid size-9 place-items-center hover:bg-white/10"
      >
        <ArrowLeft className="size-4" />
      </button>
      <div className="min-w-44 border-x border-white/15 px-4 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-orange-300">
          Throwaway prototype
        </div>
        <div className="mt-0.5 text-xs">
          {current} · {VARIANT_NAMES[current]}
        </div>
      </div>
      <button
        type="button"
        onClick={() => cycle(1)}
        aria-label="Next prototype variant"
        className="grid size-9 place-items-center hover:bg-white/10"
      >
        <ArrowRight className="size-4" />
      </button>
    </nav>
  );
}

export function ApprovalWorkflowCanvasPrototype() {
  const router = useRouter();
  const [variant, setVariant] = useState<VariantKey>('A');

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('variant')?.toUpperCase();
    if (requested !== 'A' && requested !== 'B' && requested !== 'C') return;

    const syncVariant = window.setTimeout(() => setVariant(requested), 0);
    return () => window.clearTimeout(syncVariant);
  }, []);

  function changeVariant(nextVariant: VariantKey) {
    setVariant(nextVariant);
    const params = new URLSearchParams(window.location.search);
    params.set('variant', nextVariant);
    router.replace(`/approval-rules?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="relative isolate bg-black">
      {variant === 'A' ? <VariantA /> : null}
      {variant === 'B' ? <VariantB /> : null}
      {variant === 'C' ? <VariantC /> : null}
      <PrototypeSwitcher current={variant} onChange={changeVariant} />
    </div>
  );
}
