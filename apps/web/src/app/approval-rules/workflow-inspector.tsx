'use client';

import { AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type {
  WorkflowCanvasNote,
  WorkflowEdge,
  WorkflowNode,
  WorkflowValidationIssue,
} from '@betterspend/shared';
import {
  buildWorkflowConditionEdge,
  WORKFLOW_CONDITION_FIELDS,
  WORKFLOW_CONDITION_OPERATORS,
  type WorkflowConditionField,
  type WorkflowConditionOperator,
} from './workflow-edge-config';
import { WORKFLOW_NODE_REGISTRY, type WorkflowConfigField } from './workflow-node-registry';

const inputClass =
  'h-9 w-full rounded-md border border-input bg-white/80 px-2.5 text-xs text-foreground shadow-[inset_0_1px_2px_0_rgba(26,26,26,0.06)] outline-none focus:border-primary/40';
const labelClass =
  'grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground';

type FormField = Extract<WorkflowNode, { type: 'collect_form' }>['config']['fields'][number];

function ConditionEdgeConfig({
  edge,
  source,
  target,
  onChange,
}: {
  edge: WorkflowEdge;
  source: WorkflowNode;
  target: WorkflowNode;
  onChange: (edge: WorkflowEdge) => void;
}) {
  const leafCondition = edge.condition && 'field' in edge.condition ? edge.condition : null;
  const initialField = WORKFLOW_CONDITION_FIELDS.some(
    (candidate) => candidate.value === leafCondition?.field,
  )
    ? (leafCondition?.field as WorkflowConditionField)
    : 'totalAmount';
  const initialOperator = WORKFLOW_CONDITION_OPERATORS.some(
    (candidate) => candidate.value === leafCondition?.operator,
  )
    ? (leafCondition?.operator as WorkflowConditionOperator)
    : '>=';
  const [defaultRoute, setDefaultRoute] = useState(
    edge.isDefault || edge.sourceHandle === 'default',
  );
  const [field, setField] = useState<WorkflowConditionField>(initialField);
  const [operator, setOperator] = useState<WorkflowConditionOperator>(initialOperator);
  const [rawValue, setRawValue] = useState(
    leafCondition?.value === undefined || leafCondition.value === null
      ? ''
      : String(leafCondition.value),
  );
  const [priority, setPriority] = useState(edge.priority ?? 0);
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const result = buildWorkflowConditionEdge({
      edge,
      defaultRoute,
      field,
      operator,
      rawValue,
      priority,
    });
    if (!result.success) {
      setError(result.error);
      return;
    }
    setError(null);
    onChange(result.edge);
  };

  return (
    <div className="grid gap-4 p-4">
      <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-[10px] leading-5 text-muted-foreground">
        <span className="text-foreground">{source.name}</span> to{' '}
        <span className="text-foreground">{target.name}</span>
      </div>
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={defaultRoute}
          onChange={(event) => setDefaultRoute(event.target.checked)}
          className="accent-primary"
        />
        Default route
      </label>
      {!defaultRoute ? (
        <>
          <label className={labelClass}>
            Field
            <select
              value={field}
              onChange={(event) => setField(event.target.value as WorkflowConditionField)}
              className={inputClass}
            >
              {WORKFLOW_CONDITION_FIELDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Comparison
            <select
              value={operator}
              onChange={(event) => setOperator(event.target.value as WorkflowConditionOperator)}
              className={inputClass}
            >
              {WORKFLOW_CONDITION_OPERATORS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Value
            <input
              type={field === 'totalAmount' ? 'number' : 'text'}
              value={rawValue}
              onChange={(event) => setRawValue(event.target.value)}
              placeholder={
                field === 'totalAmount' ? '25000' : field === 'currency' ? 'USD' : 'Department ID'
              }
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Route order
            <input
              type="number"
              min={0}
              step={1}
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
              className={inputClass}
            />
          </label>
          {edge.condition && !leafCondition ? (
            <p className="text-[10px] leading-4 text-amber-700">
              This route has a compound condition. Applying replaces it with the condition above.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-[10px] leading-4 text-muted-foreground">
          Used when no earlier condition matches.
        </p>
      )}
      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
      <button
        type="button"
        onClick={apply}
        className="h-9 rounded-md bg-primary text-xs font-semibold text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] hover:bg-primary/85"
      >
        Apply route
      </button>
    </div>
  );
}

function configValue(node: WorkflowNode, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, node.config);
}

function replacePath(value: unknown, path: readonly string[], replacement: unknown): unknown {
  if (path.length === 0) return replacement;
  const [segment, ...rest] = path;
  if (!segment) return replacement;
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return { ...record, [segment]: replacePath(record[segment], rest, replacement) };
}

function commitConfigValue(
  node: WorkflowNode,
  path: string,
  value: unknown,
  onChange: (node: WorkflowNode) => void,
): string | null {
  const candidate = { ...node, config: replacePath(node.config, path.split('.'), value) };
  const parsed = WORKFLOW_NODE_REGISTRY[node.type].schema.safeParse(candidate);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid configuration';
  onChange(parsed.data);
  return null;
}

function JsonConfigField({
  node,
  field,
  onChange,
}: {
  node: WorkflowNode;
  field: Extract<WorkflowConfigField, { kind: 'json' }>;
  onChange: (node: WorkflowNode) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(configValue(node, field.path), null, 2));
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-2">
      <label className={labelClass}>
        {field.label}
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          className="min-h-28 w-full resize-y rounded-md border border-input bg-white/80 p-2.5 font-mono text-[10px] font-normal normal-case tracking-normal text-foreground shadow-[inset_0_1px_2px_0_rgba(26,26,26,0.06)] outline-none focus:border-primary/40"
        />
      </label>
      {field.description ? (
        <p className="text-[10px] leading-4 text-muted-foreground">{field.description}</p>
      ) : null}
      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
      <button
        type="button"
        onClick={() => {
          try {
            const parsed: unknown = JSON.parse(text);
            setError(commitConfigValue(node, field.path, parsed, onChange));
          } catch {
            setError('Enter valid JSON');
          }
        }}
        className="h-8 rounded-md border border-border text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        Apply {field.label.toLowerCase()}
      </button>
    </div>
  );
}

function FormFieldsConfig({
  node,
  field,
  onChange,
}: {
  node: WorkflowNode;
  field: Extract<WorkflowConfigField, { kind: 'form_fields' }>;
  onChange: (node: WorkflowNode) => void;
}) {
  const initial = node.type === 'collect_form' ? node.config.fields : [];
  const [fields, setFields] = useState<FormField[]>(initial);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-3">
      <div className="flex items-center">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {field.label}
        </span>
        <button
          type="button"
          onClick={() =>
            setFields((current) => [
              ...current,
              {
                key: `field_${current.length + 1}`,
                label: 'New field',
                type: 'text',
                required: false,
              },
            ])
          }
          className="ml-auto flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[9px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3" /> Add field
        </button>
      </div>
      {fields.map((formField, index) => (
        <div
          key={`${formField.key}-${index}`}
          className="grid grid-cols-2 gap-2 rounded-md border border-border/70 p-2"
        >
          <input
            aria-label={`Field ${index + 1} key`}
            value={formField.key}
            onChange={(event) =>
              setFields((current) =>
                current.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, key: event.target.value } : item,
                ),
              )
            }
            placeholder="Key"
            className={inputClass}
          />
          <input
            aria-label={`Field ${index + 1} label`}
            value={formField.label}
            onChange={(event) =>
              setFields((current) =>
                current.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, label: event.target.value } : item,
                ),
              )
            }
            placeholder="Label"
            className={inputClass}
          />
          <select
            aria-label={`Field ${index + 1} type`}
            value={formField.type}
            onChange={(event) =>
              setFields((current) =>
                current.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, type: event.target.value as FormField['type'] }
                    : item,
                ),
              )
            }
            className={inputClass}
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
            <option value="date">Date</option>
          </select>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={formField.required}
                onChange={(event) =>
                  setFields((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, required: event.target.checked } : item,
                    ),
                  )
                }
                className="accent-primary"
              />
              Required
            </label>
            <button
              type="button"
              aria-label={`Remove field ${index + 1}`}
              onClick={() =>
                setFields((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
              className="ml-auto text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
      <button
        type="button"
        onClick={() => setError(commitConfigValue(node, field.path, fields, onChange))}
        className="h-8 rounded-md border border-border text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        Apply fields
      </button>
    </div>
  );
}

function ConfigField({
  node,
  field,
  nodes,
  onChange,
}: {
  node: WorkflowNode;
  field: WorkflowConfigField;
  nodes: WorkflowNode[];
  onChange: (node: WorkflowNode) => void;
}) {
  const value = configValue(node, field.path);
  if (field.kind === 'json')
    return <JsonConfigField node={node} field={field} onChange={onChange} />;
  if (field.kind === 'form_fields')
    return <FormFieldsConfig node={node} field={field} onChange={onChange} />;
  if (field.kind === 'readonly') {
    return (
      <label className={labelClass}>
        {field.label}
        <div className="rounded-md border border-border/70 bg-muted/40 px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-muted-foreground">
          {String(value ?? '')}
        </div>
      </label>
    );
  }
  if (field.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => commitConfigValue(node, field.path, event.target.checked, onChange)}
          className="accent-primary"
        />
        {field.label}
      </label>
    );
  }
  if (field.kind === 'select') {
    return (
      <label className={labelClass}>
        {field.label}
        <select
          value={String(value ?? '')}
          onChange={(event) => commitConfigValue(node, field.path, event.target.value, onChange)}
          className={inputClass}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.kind === 'approval_node') {
    return (
      <label className={labelClass}>
        {field.label}
        <select
          value={String(value ?? '')}
          onChange={(event) => commitConfigValue(node, field.path, event.target.value, onChange)}
          className={inputClass}
        >
          <option value="select-approval-step">Select a step</option>
          {nodes
            .filter(
              (candidate) => candidate.type === 'approver_group' || candidate.type === 'resolver',
            )
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
        </select>
      </label>
    );
  }
  if (field.kind === 'number') {
    return (
      <label className={labelClass}>
        {field.label}
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={field.min}
          max={field.max}
          onChange={(event) => {
            const number = Number(event.target.value);
            if (Number.isFinite(number)) commitConfigValue(node, field.path, number, onChange);
          }}
          className={inputClass}
        />
      </label>
    );
  }

  const defaultValue = typeof value === 'string' ? value : '';
  const onBlur = (next: string) =>
    commitConfigValue(
      node,
      field.path,
      next.trim() || (field.optional ? undefined : value),
      onChange,
    );
  return (
    <label className={labelClass}>
      {field.label}
      {field.multiline ? (
        <textarea
          key={`${node.id}-${field.path}-${defaultValue}`}
          defaultValue={defaultValue}
          onBlur={(event) => onBlur(event.target.value)}
          className="min-h-24 w-full rounded-md border border-input bg-white/80 p-2.5 text-xs font-normal normal-case tracking-normal text-foreground shadow-[inset_0_1px_2px_0_rgba(26,26,26,0.06)] outline-none focus:border-primary/40"
        />
      ) : (
        <input
          key={`${node.id}-${field.path}-${defaultValue}`}
          defaultValue={defaultValue}
          onBlur={(event) => onBlur(event.target.value)}
          placeholder={field.optional ? 'Optional' : undefined}
          className={inputClass}
        />
      )}
    </label>
  );
}

function SchemaConfigFields({
  node,
  nodes,
  onChange,
}: {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  onChange: (node: WorkflowNode) => void;
}) {
  const fields = WORKFLOW_NODE_REGISTRY[node.type].configFields;
  const primary = fields.filter((field) => !field.advanced);
  const advanced = fields.filter((field) => field.advanced);
  if (fields.length === 0)
    return <div className="text-xs text-muted-foreground">This node has no configuration.</div>;

  return (
    <>
      {primary.map((field) => (
        <ConfigField
          key={`${field.path}-${JSON.stringify(configValue(node, field.path))}`}
          node={node}
          field={field}
          nodes={nodes}
          onChange={onChange}
        />
      ))}
      {advanced.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">
            Advanced configuration
          </summary>
          <div className="mt-4 grid gap-4">
            {advanced.map((field) => (
              <ConfigField
                key={`${field.path}-${JSON.stringify(configValue(node, field.path))}`}
                node={node}
                field={field}
                nodes={nodes}
                onChange={onChange}
              />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

export function WorkflowInspector({
  node,
  edge,
  note,
  nodes,
  issues,
  onClose,
  onReplaceNode,
  onReplaceEdge,
  onUpdateNote,
  onRemoveNode,
  onRemoveEdge,
  onRemoveNote,
}: {
  node: WorkflowNode | null;
  edge: WorkflowEdge | null;
  note: WorkflowCanvasNote | null;
  nodes: WorkflowNode[];
  issues: WorkflowValidationIssue[];
  onClose: () => void;
  onReplaceNode: (node: WorkflowNode) => void;
  onReplaceEdge: (edge: WorkflowEdge) => void;
  onUpdateNote: (noteId: string, text: string) => void;
  onRemoveNode: (nodeId: string) => void;
  onRemoveEdge: (edgeId: string) => void;
  onRemoveNote: (noteId: string) => void;
}) {
  const sourceNode = edge
    ? (nodes.find((candidate) => candidate.id === edge.sourceNodeId) ?? null)
    : null;
  const targetNode = edge
    ? (nodes.find((candidate) => candidate.id === edge.targetNodeId) ?? null)
    : null;
  const title = node?.name ?? (edge ? 'Route' : note ? 'Sticky note' : 'Inspector');
  return (
    <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-border/70 bg-card text-foreground">
      <div className="flex min-h-12 items-center border-b border-border/70 px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-foreground">{title}</div>
          <div className="font-mono text-[9px] text-muted-foreground">
            {node?.type ?? edge?.id ?? note?.id ?? 'Nothing selected'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {issues.length > 0 ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
          {issues.map((issue) => (
            <div
              key={`${issue.code}-${issue.path.join('.')}`}
              className="flex gap-2 text-[10px] leading-4 text-amber-800"
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-500" />
              {issue.message}
            </div>
          ))}
        </div>
      ) : null}

      {node ? (
        <div className="grid gap-4 p-4">
          <label className={labelClass}>
            Step name
            <input
              key={`${node.id}-${node.name}`}
              className={inputClass}
              defaultValue={node.name}
              onBlur={(event) => {
                const candidate = { ...node, name: event.target.value.trim() || node.name };
                const parsed = WORKFLOW_NODE_REGISTRY[node.type].schema.safeParse(candidate);
                if (parsed.success) onReplaceNode(parsed.data);
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              className="accent-primary"
              checked={!node.disabled}
              onChange={(event) => onReplaceNode({ ...node, disabled: !event.target.checked })}
            />
            Enabled
          </label>
          <div className="h-px bg-border/70" />
          <SchemaConfigFields node={node} nodes={nodes} onChange={onReplaceNode} />
          {node.type !== 'trigger' ? (
            <button
              type="button"
              onClick={() => onRemoveNode(node.id)}
              className="mt-3 flex h-9 items-center justify-center gap-2 rounded-md border border-destructive/30 text-xs text-destructive hover:border-destructive/60 hover:bg-destructive/5"
            >
              <Trash2 className="size-3.5" /> Delete node
            </button>
          ) : null}
        </div>
      ) : null}

      {edge && sourceNode && targetNode ? (
        <>
          {sourceNode.type === 'condition' ? (
            <ConditionEdgeConfig
              key={`${edge.id}-${JSON.stringify(edge.condition)}-${edge.isDefault}`}
              edge={edge}
              source={sourceNode}
              target={targetNode}
              onChange={onReplaceEdge}
            />
          ) : (
            <div className="p-4 text-xs text-muted-foreground">
              {sourceNode.name} to {targetNode.name}
            </div>
          )}
          <div className="px-4 pb-4">
            <button
              type="button"
              onClick={() => onRemoveEdge(edge.id)}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-destructive/30 text-xs text-destructive hover:border-destructive/60 hover:bg-destructive/5"
            >
              <Trash2 className="size-3.5" /> Delete route
            </button>
          </div>
        </>
      ) : null}

      {note ? (
        <div className="grid gap-4 p-4">
          <label className={labelClass}>
            Note
            <textarea
              key={note.id}
              className="min-h-40 w-full rounded-md border border-input bg-white/80 p-2.5 text-xs normal-case tracking-normal text-foreground shadow-[inset_0_1px_2px_0_rgba(26,26,26,0.06)] outline-none focus:border-primary/40"
              defaultValue={note.text}
              onBlur={(event) => onUpdateNote(note.id, event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => onRemoveNote(note.id)}
            className="flex h-9 items-center justify-center gap-2 rounded-md border border-destructive/30 text-xs text-destructive hover:border-destructive/60 hover:bg-destructive/5"
          >
            <Trash2 className="size-3.5" /> Delete note
          </button>
        </div>
      ) : null}
    </aside>
  );
}
