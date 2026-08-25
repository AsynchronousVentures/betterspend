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
    totalAmount: string;
    spentAmount: string;
  };
  mode: BudgetEnforcementMode;
  pendingPolicy: PendingRequisitionPolicy;
  committedAmount: string;
  requestedAmount: string;
  ownerUserId: string | null;
}

export interface BudgetEnforcementDecision {
  action: BudgetEnforcementAction;
  withinBudget: boolean;
  reason: 'no_department' | 'no_budget' | 'within_budget' | 'overrun' | 'owner_missing';
  budgetId?: string;
  budgetName?: string;
  currency?: string;
  mode?: BudgetEnforcementMode;
  pendingPolicy?: PendingRequisitionPolicy;
  ownerUserId?: string;
  allocated?: string;
  spent?: string;
  committed?: string;
  remainingBefore?: string;
  remainingAfter?: string;
  requested?: string;
  overrun?: string;
  message: string;
}

const MONEY_DECIMALS = 2;
const RATE_DECIMALS = 8;

function parseScaledDecimal(value: string, decimals: number): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid decimal amount "${value}"`);

  const [, sign, whole, fraction = ''] = match;
  const keptFraction = fraction.slice(0, decimals).padEnd(decimals, '0');
  const discarded = fraction.slice(decimals);
  let units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(keptFraction || '0');
  if (discarded[0] && discarded[0] >= '5') units += 1n;
  return sign === '-' ? -units : units;
}

function formatScaledDecimal(units: bigint, decimals = MONEY_DECIMALS): string {
  const negative = units < 0;
  const absolute = negative ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Convert a persisted decimal money amount using a persisted decimal exchange rate. */
export function convertMoney(amount: string, rate: string): string {
  const amountUnits = parseScaledDecimal(amount, MONEY_DECIMALS);
  const rateUnits = parseScaledDecimal(rate, RATE_DECIMALS);
  const divisor = 10n ** BigInt(RATE_DECIMALS);
  const product = amountUnits * rateUnits;
  const absolute = product < 0 ? -product : product;
  const rounded = (absolute + divisor / 2n) / divisor;
  return formatScaledDecimal(product < 0 ? -rounded : rounded);
}

export function convertMoneyFromBase(amount: string, rate: string): string {
  const amountUnits = parseScaledDecimal(amount, MONEY_DECIMALS);
  const rateUnits = parseScaledDecimal(rate, RATE_DECIMALS);
  if (rateUnits <= 0n) throw new Error('Exchange rate must be greater than zero');
  const dividend = amountUnits * 10n ** BigInt(RATE_DECIMALS);
  const absolute = dividend < 0 ? -dividend : dividend;
  const rounded = (absolute + rateUnits / 2n) / rateUnits;
  return formatScaledDecimal(dividend < 0 ? -rounded : rounded);
}

export function addMoney(amounts: string[]): string {
  return formatScaledDecimal(
    amounts.reduce((sum, amount) => sum + parseScaledDecimal(amount, MONEY_DECIMALS), 0n),
  );
}

export function normalizeMoney(amount: string): string {
  return formatScaledDecimal(parseScaledDecimal(amount, MONEY_DECIMALS));
}

export function normalizeRate(rate: string): string {
  return formatScaledDecimal(parseScaledDecimal(rate, RATE_DECIMALS), RATE_DECIMALS);
}

export function isZeroMoney(amount: string): boolean {
  return parseScaledDecimal(amount, MONEY_DECIMALS) === 0n;
}

export function subtractMoneyFloorZero(total: string, used: string): string {
  const remaining =
    parseScaledDecimal(total, MONEY_DECIMALS) - parseScaledDecimal(used, MONEY_DECIMALS);
  return formatScaledDecimal(remaining > 0n ? remaining : 0n);
}

function money(currency: string, amount: bigint): string {
  return `${currency} ${formatScaledDecimal(amount)}`;
}

export function noBudgetDecision(): BudgetEnforcementDecision {
  return {
    action: 'allow',
    withinBudget: true,
    reason: 'no_budget',
    message: 'No matching department budget is configured',
  };
}

export function noDepartmentDecision(): BudgetEnforcementDecision {
  return {
    action: 'allow',
    withinBudget: true,
    reason: 'no_department',
    message: 'Department budget enforcement was skipped because no department is assigned',
  };
}

/** Pure policy evaluation. Data lookup and currency conversion stay in BudgetsService. */
export function evaluateBudgetPolicy(input: EvaluateBudgetPolicyInput): BudgetEnforcementDecision {
  const { budget, mode, pendingPolicy, committedAmount, requestedAmount, ownerUserId } = input;
  const allocatedUnits = parseScaledDecimal(budget.totalAmount, MONEY_DECIMALS);
  const spentUnits = parseScaledDecimal(budget.spentAmount, MONEY_DECIMALS);
  const committedUnits = parseScaledDecimal(committedAmount, MONEY_DECIMALS);
  const requestedUnits = parseScaledDecimal(requestedAmount, MONEY_DECIMALS);
  const remainingBeforeUnits = allocatedUnits - spentUnits - committedUnits;
  const remainingAfterUnits = remainingBeforeUnits - requestedUnits;
  const overrunUnits = remainingAfterUnits < 0 ? -remainingAfterUnits : 0n;
  const common = {
    budgetId: budget.id,
    budgetName: budget.name,
    currency: budget.currency,
    mode,
    pendingPolicy,
    allocated: formatScaledDecimal(allocatedUnits),
    spent: formatScaledDecimal(spentUnits),
    committed: formatScaledDecimal(committedUnits),
    remainingBefore: formatScaledDecimal(remainingBeforeUnits),
    remainingAfter: formatScaledDecimal(remainingAfterUnits),
    requested: formatScaledDecimal(requestedUnits),
    overrun: formatScaledDecimal(overrunUnits),
  };

  if (overrunUnits === 0n) {
    return {
      ...common,
      action: 'allow',
      withinBudget: true,
      reason: 'within_budget',
      message: `${budget.name} has ${money(budget.currency, remainingAfterUnits)} remaining after this request`,
    };
  }

  const overrunMessage =
    `${budget.name} would be exceeded by ${money(budget.currency, overrunUnits)}. ` +
    `Available before this request: ${money(budget.currency, remainingBeforeUnits)}; ` +
    `requested: ${money(budget.currency, requestedUnits)}.`;

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
