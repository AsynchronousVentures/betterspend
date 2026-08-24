export const BUDGET_ENFORCEMENT_MODES = ['hard_stop', 'owner_approval', 'visibility_only'] as const;

export type BudgetEnforcementMode = (typeof BUDGET_ENFORCEMENT_MODES)[number];

export const PENDING_REQUISITION_POLICIES = ['approved_only', 'include_pending'] as const;

export type PendingRequisitionPolicy = (typeof PENDING_REQUISITION_POLICIES)[number];

export type BudgetEnforcementAction = 'allow' | 'block' | 'require_approval';

interface EvaluateBudgetPolicyInput {
  budget: {
    id: string;
    name: string;
    currency: string;
    totalAmount: number;
    spentAmount: number;
  };
  mode: BudgetEnforcementMode;
  pendingPolicy: PendingRequisitionPolicy;
  committedAmount: number;
  requestedAmount: number;
  ownerUserId: string | null;
}

export interface BudgetEnforcementDecision {
  action: BudgetEnforcementAction;
  withinBudget: boolean;
  reason: 'no_budget' | 'within_budget' | 'overrun' | 'owner_missing';
  budgetId?: string;
  budgetName?: string;
  currency?: string;
  mode?: BudgetEnforcementMode;
  pendingPolicy?: PendingRequisitionPolicy;
  ownerUserId?: string;
  allocated?: number;
  spent?: number;
  committed?: number;
  remainingBefore?: number;
  remainingAfter?: number;
  requested?: number;
  overrun?: number;
  message: string;
}

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toFixed(2)}`;
}

export function noBudgetDecision(): BudgetEnforcementDecision {
  return {
    action: 'allow',
    withinBudget: true,
    reason: 'no_budget',
    message: 'No matching department budget is configured',
  };
}

/** Pure policy evaluation. Data lookup and currency conversion stay in BudgetsService. */
export function evaluateBudgetPolicy(input: EvaluateBudgetPolicyInput): BudgetEnforcementDecision {
  const { budget, mode, pendingPolicy, committedAmount, requestedAmount, ownerUserId } = input;
  const remainingBefore = budget.totalAmount - budget.spentAmount - committedAmount;
  const remainingAfter = remainingBefore - requestedAmount;
  const overrun = Math.max(0, -remainingAfter);
  const common = {
    budgetId: budget.id,
    budgetName: budget.name,
    currency: budget.currency,
    mode,
    pendingPolicy,
    allocated: budget.totalAmount,
    spent: budget.spentAmount,
    committed: committedAmount,
    remainingBefore,
    remainingAfter,
    requested: requestedAmount,
    overrun,
  };

  if (overrun === 0) {
    return {
      ...common,
      action: 'allow',
      withinBudget: true,
      reason: 'within_budget',
      message: `${budget.name} has ${money(budget.currency, remainingAfter)} remaining after this request`,
    };
  }

  const overrunMessage =
    `${budget.name} would be exceeded by ${money(budget.currency, overrun)}. ` +
    `Available before this request: ${money(budget.currency, remainingBefore)}; ` +
    `requested: ${money(budget.currency, requestedAmount)}.`;

  if (mode === 'visibility_only') {
    return {
      ...common,
      action: 'allow',
      withinBudget: false,
      reason: 'overrun',
      message: overrunMessage,
    };
  }

  if (mode === 'owner_approval') {
    if (!ownerUserId) {
      return {
        ...common,
        action: 'block',
        withinBudget: false,
        reason: 'owner_missing',
        message: `${overrunMessage} Assign an active budget owner to the department before submitting.`,
      };
    }
    return {
      ...common,
      action: 'require_approval',
      withinBudget: false,
      reason: 'overrun',
      ownerUserId,
      message: `${overrunMessage} Budget owner approval is required.`,
    };
  }

  return {
    ...common,
    action: 'block',
    withinBudget: false,
    reason: 'overrun',
    message: overrunMessage,
  };
}

export function isBudgetEnforcementMode(
  value: string | null | undefined,
): value is BudgetEnforcementMode {
  return BUDGET_ENFORCEMENT_MODES.some((mode) => mode === value);
}

export function isPendingRequisitionPolicy(
  value: string | null | undefined,
): value is PendingRequisitionPolicy {
  return PENDING_REQUISITION_POLICIES.some((policy) => policy === value);
}
