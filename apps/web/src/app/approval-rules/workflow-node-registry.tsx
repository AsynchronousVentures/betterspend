'use client';

import { memo, type ComponentType } from 'react';
import {
  BadgeCheck,
  Bell,
  CheckCircle2,
  Clock3,
  FileInput,
  GitBranch,
  ShieldCheck,
  Split,
  StickyNote,
  UserRoundCheck,
  UsersRound,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  WORKFLOW_NODE_PORTS,
  approvedNodeSchema,
  approverGroupNodeSchema,
  autoApproveNodeSchema,
  budgetCheckNodeSchema,
  collectFormNodeSchema,
  conditionNodeSchema,
  delegationNodeSchema,
  escalationTimerNodeSchema,
  matchCheckNodeSchema,
  notifyNodeSchema,
  rejectNodeSchema,
  resolverNodeSchema,
  triggerNodeSchema,
  type WorkflowDomain,
  type WorkflowCanvasNote,
  type WorkflowNode,
  type WorkflowNodeType,
  type WorkflowValidationIssue,
} from '@betterspend/shared';
import { z } from 'zod';

export type WorkflowNodeData = {
  domainNode: WorkflowNode;
  issues: WorkflowValidationIssue[];
} & Record<string, unknown>;

export type WorkflowFlowNode = Node<WorkflowNodeData, 'workflow'>;

export type WorkflowNoteData = {
  note: WorkflowCanvasNote;
} & Record<string, unknown>;

export type WorkflowNoteFlowNode = Node<WorkflowNoteData, 'note'>;

export type WorkflowConfigField = {
  path: string;
  label: string;
  description?: string;
  advanced?: boolean;
} & (
  | { kind: 'readonly' }
  | { kind: 'text'; optional?: boolean; multiline?: boolean }
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'boolean' }
  | { kind: 'select'; options: ReadonlyArray<{ value: string; label: string }> }
  | { kind: 'approval_node' }
  | { kind: 'form_fields' }
  | { kind: 'json' }
);

export interface WorkflowNodeDefinition {
  type: WorkflowNodeType;
  label: string;
  description: string;
  category: 'common' | 'advanced' | 'system';
  icon: LucideIcon;
  schema: z.ZodType<WorkflowNode>;
  component: ComponentType<NodeProps<WorkflowFlowNode>>;
  ports: { inputs: readonly string[]; outputs: readonly string[] };
  domains: readonly WorkflowDomain[];
  configFields: readonly WorkflowConfigField[];
  create: (id: string, domain: WorkflowDomain, nodes: WorkflowNode[]) => WorkflowNode;
}

function nodeSummary(node: WorkflowNode): string {
  switch (node.type) {
    case 'trigger':
      return node.config.event.replaceAll('_', ' ');
    case 'condition':
      return node.config.mode === 'first_true' ? 'First matching branch' : 'All matching branches';
    case 'match_check':
      return 'Within tolerance or exception';
    case 'budget_check':
      return 'Organization budget policy';
    case 'approver_group':
      return `${node.config.execution}, ${node.config.resolvers.length} resolver${node.config.resolvers.length === 1 ? '' : 's'}`;
    case 'resolver':
      return `${node.config.resolvers.length} hierarchy resolver${node.config.resolvers.length === 1 ? '' : 's'}`;
    case 'delegation':
      return node.config.mode.replaceAll('_', ' ');
    case 'escalation_timer':
      return `${node.config.slaHours}h SLA`;
    case 'collect_form':
      return `${node.config.fields.length} requested field${node.config.fields.length === 1 ? '' : 's'}`;
    case 'notify':
      return node.config.channels.join(', ');
    case 'auto_approve':
      return node.config.reason;
    case 'reject':
      return node.config.reasonRequired ? 'Reason required' : 'Reason optional';
    case 'approved':
      return 'Workflow complete';
  }
}

function handleOffset(index: number, length: number): string {
  return `${((index + 1) / (length + 1)) * 100}%`;
}

function WorkflowNodeCardView({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const definition = WORKFLOW_NODE_REGISTRY[data.domainNode.type];
  const Icon = definition.icon;
  const disabled = data.domainNode.disabled;

  return (
    <div
      className={`w-52 border bg-[#090909] text-left shadow-[0_10px_30px_rgba(0,0,0,0.48)] ${
        selected ? 'border-orange-400 ring-1 ring-orange-400/35' : 'border-white/18'
      } ${disabled ? 'opacity-45' : ''}`}
    >
      {definition.ports.inputs.map((port, index) => (
        <Handle
          key={port}
          id={port}
          type="target"
          position={Position.Left}
          style={{ top: handleOffset(index, definition.ports.inputs.length) }}
          className="!size-2.5 !rounded-none !border !border-sky-300 !bg-black"
          title={`Input: ${port}`}
        />
      ))}
      {definition.ports.outputs.map((port, index) => (
        <Handle
          key={port}
          id={port}
          type="source"
          position={Position.Right}
          style={{ top: handleOffset(index, definition.ports.outputs.length) }}
          className="!size-2.5 !rounded-none !border !border-orange-300 !bg-black"
          title={`Output: ${port}`}
        />
      ))}

      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Icon className="size-3.5 text-orange-300" />
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          {definition.label}
        </span>
        {disabled ? <span className="ml-auto text-[9px] uppercase text-zinc-500">Off</span> : null}
        {data.issues.length > 0 ? (
          <span
            className="ml-auto grid min-w-4 place-items-center bg-amber-300 px-1 text-[9px] font-bold text-black"
            title={data.issues.map((issue) => issue.message).join('\n')}
          >
            {data.issues.length}
          </span>
        ) : null}
      </div>
      <div className="px-3 py-2.5">
        <div className="truncate text-xs font-semibold text-white">{data.domainNode.name}</div>
        <div className="mt-1 truncate font-mono text-[9px] text-zinc-500">
          {nodeSummary(data.domainNode)}
        </div>
      </div>
      {definition.ports.outputs.length > 1 ? (
        <div className="flex flex-wrap gap-x-2 border-t border-white/10 px-3 py-1 font-mono text-[8px] text-zinc-500">
          {definition.ports.outputs.map((port) => (
            <span key={port}>{port}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const WorkflowNodeCard = memo(
  WorkflowNodeCardView,
  (previous, next) =>
    previous.selected === next.selected &&
    previous.data.domainNode === next.data.domainNode &&
    previous.data.issues.length === next.data.issues.length &&
    previous.data.issues.every(
      (issue, index) =>
        issue.code === next.data.issues[index]?.code &&
        issue.message === next.data.issues[index]?.message,
    ),
);

function WorkflowNoteCardView({ data, selected }: NodeProps<WorkflowNoteFlowNode>) {
  return (
    <div
      className={`w-52 -rotate-1 border bg-[#211d08] p-3 text-amber-50 shadow-[4px_4px_0_rgba(0,0,0,0.5)] ${
        selected ? 'border-amber-200' : 'border-amber-200/35'
      }`}
    >
      <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-300">
        <StickyNote className="size-3" /> Note
      </div>
      <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-amber-100/80">
        {data.note.text}
      </div>
    </div>
  );
}

export const WorkflowNoteCard = memo(
  WorkflowNoteCardView,
  (previous, next) => previous.selected === next.selected && previous.data.note === next.data.note,
);

const ALL_DOMAINS: readonly WorkflowDomain[] = ['requisition', 'invoice', 'po_change'];

export const WORKFLOW_NODE_REGISTRY: Record<WorkflowNodeType, WorkflowNodeDefinition> = {
  trigger: {
    type: 'trigger',
    label: 'Trigger',
    description: 'Starts the workflow when a record is submitted.',
    category: 'system',
    icon: Zap,
    schema: triggerNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.trigger,
    domains: ALL_DOMAINS,
    configFields: [{ path: 'event', label: 'Event', kind: 'readonly' }],
    create: (id, domain) => {
      const event =
        domain === 'requisition'
          ? 'requisition_submitted'
          : domain === 'invoice'
            ? 'invoice_submitted'
            : 'po_change_submitted';
      return {
        id,
        name: 'Submitted',
        type: 'trigger',
        disabled: false,
        config: { event },
      };
    },
  },
  condition: {
    type: 'condition',
    label: 'Condition',
    description: 'Routes by amount, department, currency, or another record field.',
    category: 'common',
    icon: Split,
    schema: conditionNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.condition,
    domains: ALL_DOMAINS,
    configFields: [
      {
        path: 'mode',
        label: 'Branch behavior',
        kind: 'select',
        options: [
          { value: 'first_true', label: 'First match' },
          { value: 'all_true', label: 'All matches' },
        ],
      },
    ],
    create: (id) => ({
      id,
      name: 'Route request',
      type: 'condition',
      disabled: false,
      config: { mode: 'first_true' },
    }),
  },
  match_check: {
    type: 'match_check',
    label: 'Match check',
    description: 'Routes invoices by 3-way match tolerance.',
    category: 'advanced',
    icon: BadgeCheck,
    schema: matchCheckNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.match_check,
    domains: ['invoice'],
    configFields: [],
    create: (id) => ({
      id,
      name: '3-way match',
      type: 'match_check',
      disabled: false,
      config: {},
    }),
  },
  budget_check: {
    type: 'budget_check',
    label: 'Budget check',
    description: 'Routes by the organization budget policy.',
    category: 'advanced',
    icon: ShieldCheck,
    schema: budgetCheckNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.budget_check,
    domains: ['requisition', 'po_change'],
    configFields: [{ path: 'policy', label: 'Policy', kind: 'readonly' }],
    create: (id) => ({
      id,
      name: 'Budget available?',
      type: 'budget_check',
      disabled: false,
      config: { policy: 'organization_default' },
    }),
  },
  approver_group: {
    type: 'approver_group',
    label: 'Approver group',
    description: 'Collects serial or parallel approval from a group.',
    category: 'common',
    icon: UsersRound,
    schema: approverGroupNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.approver_group,
    domains: ALL_DOMAINS,
    configFields: [
      {
        path: 'execution',
        label: 'Execution',
        kind: 'select',
        options: [
          { value: 'serial', label: 'Serial' },
          { value: 'parallel', label: 'Parallel' },
        ],
      },
      {
        path: 'resolvers',
        label: 'Approvers',
        kind: 'json',
        description: 'Ordered role, user, or manager-chain resolvers.',
      },
      {
        path: 'quorum',
        label: 'Quorum',
        kind: 'json',
        description: 'Use all, majority, or a fixed count.',
      },
      {
        path: 'separationOfDuties',
        label: 'Separation of duties',
        kind: 'json',
        advanced: true,
      },
    ],
    create: (id) => ({
      id,
      name: 'Approval group',
      type: 'approver_group',
      disabled: false,
      config: {
        execution: 'serial',
        resolvers: [{ type: 'role', role: 'approver', scope: 'global' }],
        quorum: { type: 'all' },
        separationOfDuties: { enabled: false, exclude: [], fallbackResolvers: [] },
      },
    }),
  },
  resolver: {
    type: 'resolver',
    label: 'Manager approval',
    description: 'Resolves a manager chain or scoped role at runtime.',
    category: 'common',
    icon: UserRoundCheck,
    schema: resolverNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.resolver,
    domains: ALL_DOMAINS,
    configFields: [
      {
        path: 'resolvers',
        label: 'Approvers',
        kind: 'json',
        description: 'Ordered role, user, or manager-chain resolvers.',
      },
      {
        path: 'separationOfDuties',
        label: 'Separation of duties',
        kind: 'json',
        advanced: true,
      },
    ],
    create: (id) => ({
      id,
      name: 'Manager approval',
      type: 'resolver',
      disabled: false,
      config: {
        resolvers: [{ type: 'manager_chain', maxLevels: 10 }],
        separationOfDuties: { enabled: false, exclude: [], fallbackResolvers: [] },
      },
    }),
  },
  delegation: {
    type: 'delegation',
    label: 'Delegation',
    description: 'Allows standing or per-request delegated approval.',
    category: 'advanced',
    icon: GitBranch,
    schema: delegationNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.delegation,
    domains: ALL_DOMAINS,
    configFields: [
      {
        path: 'mode',
        label: 'Delegation mode',
        kind: 'select',
        options: [
          { value: 'both', label: 'Standing and per request' },
          { value: 'standing', label: 'Standing only' },
          { value: 'per_instance', label: 'Per request only' },
        ],
      },
    ],
    create: (id) => ({
      id,
      name: 'Apply delegation',
      type: 'delegation',
      disabled: false,
      config: { mode: 'both' },
    }),
  },
  escalation_timer: {
    type: 'escalation_timer',
    label: 'Escalation',
    description: 'Acts when an approval step passes its SLA.',
    category: 'advanced',
    icon: Clock3,
    schema: escalationTimerNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.escalation_timer,
    domains: ALL_DOMAINS,
    configFields: [
      { path: 'parentNodeId', label: 'Approval step', kind: 'approval_node' },
      { path: 'slaHours', label: 'SLA hours', kind: 'number', min: 1 },
      {
        path: 'warningPercent',
        label: 'Warning percent',
        kind: 'number',
        min: 1,
        max: 99,
        advanced: true,
      },
      {
        path: 'action',
        label: 'Escalation action',
        kind: 'json',
        description: 'Notify, reassign, auto-approve, or auto-reject.',
      },
    ],
    create: (id, _domain, nodes) => ({
      id,
      name: '48h escalation',
      type: 'escalation_timer',
      disabled: false,
      config: {
        parentNodeId:
          nodes.find((node) => node.type === 'approver_group' || node.type === 'resolver')?.id ??
          'select-approval-step',
        slaHours: 48,
        warningPercent: 75,
        action: { type: 'notify' },
      },
    }),
  },
  collect_form: {
    type: 'collect_form',
    label: 'Collect details',
    description: 'Pauses the workflow to request structured information.',
    category: 'advanced',
    icon: FileInput,
    schema: collectFormNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.collect_form,
    domains: ALL_DOMAINS,
    configFields: [{ path: 'fields', label: 'Requested fields', kind: 'form_fields' }],
    create: (id) => ({
      id,
      name: 'Request details',
      type: 'collect_form',
      disabled: false,
      config: {
        fields: [{ key: 'details', label: 'Additional details', type: 'text', required: true }],
      },
    }),
  },
  notify: {
    type: 'notify',
    label: 'Notify',
    description: 'Sends a non-blocking workflow notification.',
    category: 'advanced',
    icon: Bell,
    schema: notifyNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.notify,
    domains: ALL_DOMAINS,
    configFields: [
      {
        path: 'channels',
        label: 'Channels',
        kind: 'json',
        description: 'One or more of email, slack, or in_app.',
      },
      {
        path: 'recipients',
        label: 'Recipients',
        kind: 'json',
        description: 'Role, user, or manager-chain resolvers.',
        advanced: true,
      },
      { path: 'message', label: 'Message', kind: 'text', multiline: true },
    ],
    create: (id) => ({
      id,
      name: 'Notify watchers',
      type: 'notify',
      disabled: false,
      config: {
        channels: ['email'],
        recipients: [{ type: 'role', role: 'approver', scope: 'global' }],
        message: 'A workflow record needs attention.',
      },
    }),
  },
  auto_approve: {
    type: 'auto_approve',
    label: 'Auto-approve',
    description: 'Completes the workflow without an approver.',
    category: 'common',
    icon: CheckCircle2,
    schema: autoApproveNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.auto_approve,
    domains: ALL_DOMAINS,
    configFields: [{ path: 'reason', label: 'Reason', kind: 'text' }],
    create: (id) => ({
      id,
      name: 'Auto-approve',
      type: 'auto_approve',
      disabled: false,
      config: { reason: 'Meets automatic approval policy' },
    }),
  },
  reject: {
    type: 'reject',
    label: 'Reject',
    description: 'Ends the workflow with a rejection.',
    category: 'common',
    icon: XCircle,
    schema: rejectNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.reject,
    domains: ALL_DOMAINS,
    configFields: [
      { path: 'reasonRequired', label: 'Require a rejection reason', kind: 'boolean' },
      {
        path: 'defaultReason',
        label: 'Default reason',
        kind: 'text',
        optional: true,
        advanced: true,
      },
    ],
    create: (id) => ({
      id,
      name: 'Rejected',
      type: 'reject',
      disabled: false,
      config: { reasonRequired: true },
    }),
  },
  approved: {
    type: 'approved',
    label: 'Approved',
    description: 'Completes the workflow and emits downstream events.',
    category: 'common',
    icon: CheckCircle2,
    schema: approvedNodeSchema,
    component: WorkflowNodeCard,
    ports: WORKFLOW_NODE_PORTS.approved,
    domains: ALL_DOMAINS,
    configFields: [],
    create: (id) => ({
      id,
      name: 'Approved',
      type: 'approved',
      disabled: false,
      config: {},
    }),
  },
};

export function workflowNodeConfigSchemaKeys(definition: WorkflowNodeDefinition): string[] {
  if (!(definition.schema instanceof z.ZodObject)) {
    throw new Error(`Workflow node ${definition.type} must use a Zod object schema`);
  }
  const configSchema = definition.schema.shape.config;
  if (!(configSchema instanceof z.ZodObject)) {
    throw new Error(`Workflow node ${definition.type} config must use a Zod object schema`);
  }
  return Object.keys(configSchema.shape).sort();
}

/** Keeps the small field renderer exhaustive without introducing a second config schema. */
export function assertWorkflowNodeConfigFields(): void {
  for (const definition of Object.values(WORKFLOW_NODE_REGISTRY)) {
    const schemaKeys = workflowNodeConfigSchemaKeys(definition);
    const fieldKeys = definition.configFields.map((field) => field.path.split('.')[0] ?? '').sort();
    if (
      schemaKeys.length !== fieldKeys.length ||
      schemaKeys.some((key, index) => key !== fieldKeys[index])
    ) {
      throw new Error(
        `Workflow node ${definition.type} config fields must match its Zod schema: expected ${schemaKeys.join(', ') || '(none)'}`,
      );
    }
  }
}

assertWorkflowNodeConfigFields();

export const WORKFLOW_FLOW_NODE_TYPES = { workflow: WorkflowNodeCard, note: WorkflowNoteCard };

export function availableNodeDefinitions(domain: WorkflowDomain): WorkflowNodeDefinition[] {
  return Object.values(WORKFLOW_NODE_REGISTRY).filter(
    (definition) => definition.category !== 'system' && definition.domains.includes(domain),
  );
}
