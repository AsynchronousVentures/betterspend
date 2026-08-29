import { workflowEdgeSchema, type WorkflowEdge } from '@betterspend/shared';

export const WORKFLOW_CONDITION_FIELDS = [
  { value: 'totalAmount', label: 'Amount', valueKind: 'number' },
  { value: 'departmentId', label: 'Department ID', valueKind: 'text' },
  { value: 'currency', label: 'Currency', valueKind: 'text' },
] as const;

export const WORKFLOW_CONDITION_OPERATORS = [
  { value: '>=', label: 'is at least' },
  { value: '>', label: 'is greater than' },
  { value: '<=', label: 'is at most' },
  { value: '<', label: 'is less than' },
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
] as const;

export type WorkflowConditionField = (typeof WORKFLOW_CONDITION_FIELDS)[number]['value'];
export type WorkflowConditionOperator = (typeof WORKFLOW_CONDITION_OPERATORS)[number]['value'];

type ConditionEdgeInput = {
  edge: WorkflowEdge;
  defaultRoute: boolean;
  field: WorkflowConditionField;
  operator: WorkflowConditionOperator;
  rawValue: string;
  priority: number;
};

export type ConditionEdgeResult =
  { success: true; edge: WorkflowEdge } | { success: false; error: string };

/** Builds one typed condition route while preserving the edge endpoints and identity. */
export function buildWorkflowConditionEdge(input: ConditionEdgeInput): ConditionEdgeResult {
  const { condition: _condition, priority: _priority, ...base } = input.edge;
  const value = parseConditionValue(input.field, input.rawValue);
  if (!input.defaultRoute && value === null)
    return { success: false, error: 'Enter a valid route value' };
  const candidate = input.defaultRoute
    ? { ...base, sourceHandle: 'default', isDefault: true }
    : {
        ...base,
        sourceHandle: 'branch',
        isDefault: false,
        condition: { field: input.field, operator: input.operator, value },
        priority: input.priority,
      };

  const parsed = workflowEdgeSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? 'Enter a valid route condition',
    };
  }
  return { success: true, edge: parsed.data };
}

function parseConditionValue(field: WorkflowConditionField, rawValue: string) {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  if (field !== 'totalAmount') return field === 'currency' ? trimmed.toUpperCase() : trimmed;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
