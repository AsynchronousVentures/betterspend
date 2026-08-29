'use client';

import { AlertTriangle, Trash2, X } from 'lucide-react';
import type {
  ApproverResolver,
  SeparationOfDuties,
  WorkflowCanvasNote,
  WorkflowNode,
  WorkflowValidationIssue,
} from '@betterspend/shared';

const inputClass =
  'h-9 w-full border border-white/15 bg-black px-2.5 text-xs text-white outline-none focus:border-orange-300';
const labelClass =
  'grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500';

function firstResolver(node: Extract<WorkflowNode, { type: 'approver_group' | 'resolver' }>) {
  return node.config.resolvers[0] ?? ({ type: 'role', role: 'approver', scope: 'global' } as const);
}

function replaceFirstResolver(
  node: Extract<WorkflowNode, { type: 'approver_group' | 'resolver' }>,
  resolver: ApproverResolver,
): WorkflowNode {
  if (node.type === 'approver_group') {
    return {
      ...node,
      config: {
        ...node.config,
        resolvers: [resolver, ...node.config.resolvers.slice(1)],
      },
    };
  }
  return {
    ...node,
    config: {
      ...node.config,
      resolvers: [resolver, ...node.config.resolvers.slice(1)],
    },
  };
}

function ResolverFields({
  node,
  onChange,
}: {
  node: Extract<WorkflowNode, { type: 'approver_group' | 'resolver' }>;
  onChange: (node: WorkflowNode) => void;
}) {
  const resolver = firstResolver(node);
  return (
    <>
      <label className={labelClass}>
        Resolver
        <select
          className={inputClass}
          value={resolver.type}
          onChange={(event) => {
            const type = event.target.value;
            onChange(
              replaceFirstResolver(
                node,
                type === 'manager_chain'
                  ? { type: 'manager_chain', maxLevels: 10 }
                  : type === 'user'
                    ? { type: 'user', userId: '00000000-0000-4000-8000-000000000000' }
                    : { type: 'role', role: 'approver', scope: 'global' },
              ),
            );
          }}
        >
          <option value="role">Role</option>
          <option value="manager_chain">Manager chain</option>
          <option value="user">Specific user</option>
        </select>
      </label>
      {resolver.type === 'role' ? (
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            Role
            <input
              className={inputClass}
              defaultValue={resolver.role}
              onBlur={(event) =>
                onChange(
                  replaceFirstResolver(node, {
                    ...resolver,
                    role: event.target.value.trim() || resolver.role,
                  }),
                )
              }
            />
          </label>
          <label className={labelClass}>
            Scope
            <select
              className={inputClass}
              value={resolver.scope}
              onChange={(event) =>
                onChange(
                  replaceFirstResolver(node, {
                    ...resolver,
                    scope: event.target.value as typeof resolver.scope,
                  }),
                )
              }
            >
              <option value="global">Global</option>
              <option value="entity">Entity</option>
              <option value="department">Department</option>
              <option value="project">Project</option>
            </select>
          </label>
        </div>
      ) : null}
      {resolver.type === 'manager_chain' ? (
        <label className={labelClass}>
          Maximum levels
          <input
            className={inputClass}
            type="number"
            min={1}
            max={20}
            value={resolver.maxLevels}
            onChange={(event) =>
              onChange(
                replaceFirstResolver(node, {
                  ...resolver,
                  maxLevels: Math.max(1, Math.min(20, Number(event.target.value) || 1)),
                }),
              )
            }
          />
        </label>
      ) : null}
      {resolver.type === 'user' ? (
        <label className={labelClass}>
          User ID
          <input
            className={inputClass}
            defaultValue={resolver.userId}
            onBlur={(event) =>
              onChange(
                replaceFirstResolver(node, { ...resolver, userId: event.target.value.trim() }),
              )
            }
          />
        </label>
      ) : null}
    </>
  );
}

function AdvancedApprovalSettings({
  node,
  onChange,
}: {
  node: Extract<WorkflowNode, { type: 'approver_group' | 'resolver' }>;
  onChange: (node: WorkflowNode) => void;
}) {
  const resolver = firstResolver(node);
  return (
    <div className="grid gap-4 border-t border-white/10 pt-4">
      <label className="flex items-start gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          className="mt-0.5 accent-orange-400"
          checked={node.config.separationOfDuties.enabled}
          onChange={(event) => {
            const exclude: SeparationOfDuties['exclude'] = event.target.checked
              ? ['requester']
              : [];
            const separationOfDuties = {
              ...node.config.separationOfDuties,
              enabled: event.target.checked,
              exclude,
            };
            onChange(
              node.type === 'approver_group'
                ? { ...node, config: { ...node.config, separationOfDuties } }
                : { ...node, config: { ...node.config, separationOfDuties } },
            );
          }}
        />
        <span>
          <strong className="block font-semibold text-white">Separation of duties</strong>
          <span className="mt-1 block text-[10px] leading-4 text-zinc-500">
            Excludes the requester. Add a fallback resolver before publishing.
          </span>
        </span>
      </label>
      <label className={labelClass}>
        Spend limit (base currency)
        <input
          className={inputClass}
          inputMode="decimal"
          defaultValue={resolver.spendLimitBaseAmount ?? ''}
          placeholder="No limit"
          onBlur={(event) => {
            const spendLimitBaseAmount = event.target.value.trim() || undefined;
            onChange(replaceFirstResolver(node, { ...resolver, spendLimitBaseAmount }));
          }}
        />
      </label>
    </div>
  );
}

function NodeTypeFields({
  node,
  nodes,
  onChange,
}: {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  onChange: (node: WorkflowNode) => void;
}) {
  switch (node.type) {
    case 'trigger':
      return (
        <div className="text-xs text-zinc-500">The workflow trigger is fixed by its domain.</div>
      );
    case 'condition':
      return (
        <label className={labelClass}>
          Branch behavior
          <select
            className={inputClass}
            value={node.config.mode}
            onChange={(event) =>
              onChange({
                ...node,
                config: { mode: event.target.value as typeof node.config.mode },
              })
            }
          >
            <option value="first_true">First match</option>
            <option value="all_true">All matches</option>
          </select>
        </label>
      );
    case 'approver_group':
      return (
        <>
          <label className={labelClass}>
            Execution
            <select
              className={inputClass}
              value={node.config.execution}
              onChange={(event) =>
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    execution: event.target.value as typeof node.config.execution,
                  },
                })
              }
            >
              <option value="serial">Serial</option>
              <option value="parallel">Parallel</option>
            </select>
          </label>
          <ResolverFields node={node} onChange={onChange} />
          <label className={labelClass}>
            Quorum
            <select
              className={inputClass}
              value={node.config.quorum.type}
              onChange={(event) => {
                const type = event.target.value;
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    quorum:
                      type === 'count'
                        ? { type: 'count', count: 1 }
                        : ({ type } as typeof node.config.quorum),
                  },
                });
              }}
            >
              <option value="all">All</option>
              <option value="majority">Majority</option>
              <option value="count">Fixed count</option>
            </select>
          </label>
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-400 hover:text-white">
              More settings
            </summary>
            <div className="mt-4">
              <AdvancedApprovalSettings node={node} onChange={onChange} />
            </div>
          </details>
        </>
      );
    case 'resolver':
      return (
        <>
          <ResolverFields node={node} onChange={onChange} />
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-400 hover:text-white">
              More settings
            </summary>
            <div className="mt-4">
              <AdvancedApprovalSettings node={node} onChange={onChange} />
            </div>
          </details>
        </>
      );
    case 'delegation':
      return (
        <label className={labelClass}>
          Delegation mode
          <select
            className={inputClass}
            value={node.config.mode}
            onChange={(event) =>
              onChange({ ...node, config: { mode: event.target.value as typeof node.config.mode } })
            }
          >
            <option value="both">Standing and per request</option>
            <option value="standing">Standing only</option>
            <option value="per_instance">Per request only</option>
          </select>
        </label>
      );
    case 'escalation_timer':
      return (
        <>
          <label className={labelClass}>
            Approval step
            <select
              className={inputClass}
              value={node.config.parentNodeId}
              onChange={(event) =>
                onChange({
                  ...node,
                  config: { ...node.config, parentNodeId: event.target.value },
                })
              }
            >
              <option value="select-approval-step">Select a step</option>
              {nodes
                .filter(
                  (candidate) =>
                    candidate.type === 'approver_group' || candidate.type === 'resolver',
                )
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
            </select>
          </label>
          <label className={labelClass}>
            SLA hours
            <input
              className={inputClass}
              type="number"
              min={1}
              value={node.config.slaHours}
              onChange={(event) =>
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    slaHours: Math.max(1, Number(event.target.value) || 1),
                  },
                })
              }
            />
          </label>
          <label className={labelClass}>
            Action
            <select
              className={inputClass}
              value={node.config.action.type}
              onChange={(event) => {
                const type = event.target.value;
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    action:
                      type === 'reassign'
                        ? {
                            type: 'reassign',
                            resolvers: [{ type: 'role', role: 'admin', scope: 'global' }],
                          }
                        : ({ type } as typeof node.config.action),
                  },
                });
              }}
            >
              <option value="notify">Notify</option>
              <option value="reassign">Reassign</option>
              <option value="auto_approve">Auto-approve</option>
              <option value="auto_reject">Auto-reject</option>
            </select>
          </label>
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-zinc-400 hover:text-white">
              More settings
            </summary>
            <label className={`${labelClass} mt-4`}>
              Warning percent
              <input
                className={inputClass}
                type="number"
                min={1}
                max={99}
                value={node.config.warningPercent}
                onChange={(event) =>
                  onChange({
                    ...node,
                    config: {
                      ...node.config,
                      warningPercent: Math.max(1, Math.min(99, Number(event.target.value) || 75)),
                    },
                  })
                }
              />
            </label>
          </details>
        </>
      );
    case 'notify':
      return (
        <>
          <label className={labelClass}>
            Channel
            <select
              className={inputClass}
              value={node.config.channels[0]}
              onChange={(event) =>
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    channels: [event.target.value as 'email' | 'slack' | 'in_app'],
                  },
                })
              }
            >
              <option value="email">Email</option>
              <option value="slack">Slack</option>
              <option value="in_app">In app</option>
            </select>
          </label>
          <label className={labelClass}>
            Message
            <textarea
              className="min-h-24 w-full border border-white/15 bg-black p-2.5 text-xs normal-case tracking-normal text-white outline-none focus:border-orange-300"
              defaultValue={node.config.message}
              onBlur={(event) =>
                onChange({
                  ...node,
                  config: {
                    ...node.config,
                    message: event.target.value.trim() || node.config.message,
                  },
                })
              }
            />
          </label>
        </>
      );
    case 'auto_approve':
      return (
        <label className={labelClass}>
          Reason
          <input
            className={inputClass}
            defaultValue={node.config.reason}
            onBlur={(event) =>
              onChange({
                ...node,
                config: { reason: event.target.value.trim() || node.config.reason },
              })
            }
          />
        </label>
      );
    case 'reject':
      return (
        <>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={node.config.reasonRequired}
              className="accent-orange-400"
              onChange={(event) =>
                onChange({
                  ...node,
                  config: { ...node.config, reasonRequired: event.target.checked },
                })
              }
            />
            Require a rejection reason
          </label>
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-zinc-400 hover:text-white">
              More settings
            </summary>
            <label className={`${labelClass} mt-4`}>
              Default reason
              <input
                className={inputClass}
                defaultValue={node.config.defaultReason ?? ''}
                placeholder="Optional"
                onBlur={(event) =>
                  onChange({
                    ...node,
                    config: {
                      ...node.config,
                      defaultReason: event.target.value.trim() || undefined,
                    },
                  })
                }
              />
            </label>
          </details>
        </>
      );
    case 'collect_form':
      return (
        <div className="text-xs leading-5 text-zinc-400">
          Collects <strong className="text-white">{node.config.fields[0]?.label}</strong>.
          Additional form fields are an advanced workflow setting.
        </div>
      );
    case 'match_check':
    case 'budget_check':
    case 'approved':
      return <div className="text-xs text-zinc-500">This node has no required settings.</div>;
  }
}

export function WorkflowInspector({
  node,
  note,
  nodes,
  issues,
  onClose,
  onReplaceNode,
  onUpdateNote,
  onRemoveNode,
  onRemoveNote,
}: {
  node: WorkflowNode | null;
  note: WorkflowCanvasNote | null;
  nodes: WorkflowNode[];
  issues: WorkflowValidationIssue[];
  onClose: () => void;
  onReplaceNode: (node: WorkflowNode) => void;
  onUpdateNote: (noteId: string, text: string) => void;
  onRemoveNode: (nodeId: string) => void;
  onRemoveNote: (noteId: string) => void;
}) {
  const title = node?.name ?? (note ? 'Sticky note' : 'Inspector');
  return (
    <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-white/15 bg-[#080808] text-white">
      <div className="flex min-h-12 items-center border-b border-white/12 px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">{title}</div>
          <div className="font-mono text-[9px] text-zinc-600">
            {node?.type ?? note?.id ?? 'Nothing selected'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="ml-auto text-zinc-600 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>

      {issues.length > 0 ? (
        <div className="border-b border-amber-300/25 bg-amber-300/5 px-4 py-3">
          {issues.map((issue) => (
            <div
              key={`${issue.code}-${issue.path.join('.')}`}
              className="flex gap-2 text-[10px] leading-4 text-amber-100"
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-300" /> {issue.message}
            </div>
          ))}
        </div>
      ) : null}

      {node ? (
        <div className="grid gap-4 p-4">
          <label className={labelClass}>
            Step name
            <input
              key={node.id}
              className={inputClass}
              defaultValue={node.name}
              onBlur={(event) =>
                onReplaceNode({ ...node, name: event.target.value.trim() || node.name })
              }
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              className="accent-orange-400"
              checked={!node.disabled}
              onChange={(event) => onReplaceNode({ ...node, disabled: !event.target.checked })}
            />
            Enabled
          </label>
          <div className="h-px bg-white/10" />
          <NodeTypeFields node={node} nodes={nodes} onChange={onReplaceNode} />
          {node.type !== 'trigger' ? (
            <button
              type="button"
              onClick={() => onRemoveNode(node.id)}
              className="mt-3 flex h-9 items-center justify-center gap-2 border border-rose-400/30 text-xs text-rose-200 hover:border-rose-300"
            >
              <Trash2 className="size-3.5" /> Delete node
            </button>
          ) : null}
        </div>
      ) : null}

      {note ? (
        <div className="grid gap-4 p-4">
          <label className={labelClass}>
            Note
            <textarea
              key={note.id}
              className="min-h-40 w-full border border-white/15 bg-black p-2.5 text-xs normal-case tracking-normal text-white outline-none focus:border-amber-300"
              defaultValue={note.text}
              onBlur={(event) => onUpdateNote(note.id, event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => onRemoveNote(note.id)}
            className="flex h-9 items-center justify-center gap-2 border border-rose-400/30 text-xs text-rose-200 hover:border-rose-300"
          >
            <Trash2 className="size-3.5" /> Delete note
          </button>
        </div>
      ) : null}

      {!node && !note ? (
        <div className="p-6 text-xs leading-5 text-zinc-500">
          Select a node or note to configure it.
        </div>
      ) : null}
    </aside>
  );
}
