import type {
  ExecutableStep,
  ExecutableTransition,
  WorkflowAssignmentStatus,
  WorkflowCondition,
} from '@betterspend/shared';

export type { WorkflowAssignmentStatus } from '@betterspend/shared';

export type WorkflowQuorum =
  { type: 'all' } | { type: 'majority' } | { type: 'count'; count: number };

function readContextValue(context: Record<string, unknown>, field: string): unknown {
  return field.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, segment)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, context);
}

function exactDecimal(value: unknown): { units: bigint; scale: number } | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? '';
  const unsigned = BigInt(`${match[2]}${fraction}`);
  return { units: match[1] === '-' ? -unsigned : unsigned, scale: fraction.length };
}

/** Compare plain decimal values without passing persisted money through IEEE-754. */
export function compareWorkflowDecimals(left: unknown, right: unknown): number | null {
  const leftDecimal = exactDecimal(left);
  const rightDecimal = exactDecimal(right);
  if (!leftDecimal || !rightDecimal) return null;
  const scale = Math.max(leftDecimal.scale, rightDecimal.scale);
  const leftUnits = leftDecimal.units * 10n ** BigInt(scale - leftDecimal.scale);
  const rightUnits = rightDecimal.units * 10n ** BigInt(scale - rightDecimal.scale);
  return leftUnits === rightUnits ? 0 : leftUnits < rightUnits ? -1 : 1;
}

function compareValues(left: unknown, right: unknown): number | null {
  const decimalComparison = compareWorkflowDecimals(left, right);
  if (decimalComparison != null) return decimalComparison;
  if (left === right) return 0;
  if (left == null || right == null) return null;
  const leftText = String(left);
  const rightText = String(right);
  return leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
}

export function evaluateWorkflowCondition(
  condition: WorkflowCondition,
  context: Record<string, unknown>,
): boolean {
  if ('conditions' in condition) {
    const results = condition.conditions.map((nested) =>
      evaluateWorkflowCondition(nested, context),
    );
    return condition.operator === 'AND' ? results.every(Boolean) : results.some(Boolean);
  }

  const comparison = compareValues(readContextValue(context, condition.field), condition.value);
  if (comparison == null) return condition.operator === '!=' || condition.operator === 'neq';
  switch (condition.operator) {
    case '>=':
      return comparison >= 0;
    case '>':
      return comparison > 0;
    case '<=':
      return comparison <= 0;
    case '<':
      return comparison < 0;
    case '==':
    case 'eq':
      return comparison === 0;
    case '!=':
    case 'neq':
      return comparison !== 0;
  }
}

/** Select one deterministic transition from a compiled step. */
export function selectWorkflowTransition(
  step: ExecutableStep,
  context: Record<string, unknown>,
  sourceHandle?: string,
): ExecutableTransition | null {
  const eligible = (
    sourceHandle
      ? step.transitions.filter((transition) => transition.sourceHandle === sourceHandle)
      : step.transitions
  )
    .slice()
    .sort(
      (left, right) =>
        (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER) ||
        left.edgeId.localeCompare(right.edgeId),
    );
  const conditional = eligible.find(
    (transition) =>
      !transition.isDefault &&
      !!transition.condition &&
      evaluateWorkflowCondition(transition.condition, context),
  );
  return (
    conditional ??
    eligible.find((transition) => transition.isDefault || !transition.condition) ??
    null
  );
}

export function requiredWorkflowApprovals(quorum: WorkflowQuorum, total: number): number {
  if (total < 1) throw new Error('Approval groups require at least one assignment');
  if (quorum.type === 'all') return total;
  if (quorum.type === 'majority') return Math.floor(total / 2) + 1;
  if (quorum.count > total) throw new Error('Approval quorum exceeds the assignment count');
  return quorum.count;
}

export type WorkflowQuorumProgress =
  | { state: 'approved'; nextSequence: null }
  | { state: 'rejected'; nextSequence: null }
  | { state: 'pending'; nextSequence: number | null };

export function evaluateWorkflowQuorum(
  execution: 'serial' | 'parallel',
  quorum: WorkflowQuorum,
  assignments: Array<{ sequence: number; status: WorkflowAssignmentStatus }>,
): WorkflowQuorumProgress {
  const active = assignments.filter((assignment) => assignment.status !== 'skipped');
  const required = requiredWorkflowApprovals(quorum, active.length);
  const approved = active.filter((assignment) => assignment.status === 'approved').length;
  if (approved >= required) return { state: 'approved', nextSequence: null };

  const available = active.filter(
    (assignment) =>
      assignment.status === 'waiting' ||
      assignment.status === 'pending' ||
      assignment.status === 'approved',
  ).length;
  if (available < required) return { state: 'rejected', nextSequence: null };

  if (execution === 'serial') {
    const next = active
      .filter((assignment) => assignment.status === 'waiting')
      .sort((left, right) => left.sequence - right.sequence)[0];
    return { state: 'pending', nextSequence: next?.sequence ?? null };
  }
  return { state: 'pending', nextSequence: null };
}
