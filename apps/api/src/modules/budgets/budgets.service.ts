import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { asc, eq, and, sql, gte, inArray, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db, DbTransaction } from '@betterspend/db';
import {
  auditLog,
  budgetCommitmentEvents,
  budgets,
  budgetPeriods,
  invoices,
  purchaseOrders,
  requisitions,
} from '@betterspend/db';
import { EntitiesService } from '../entities/entities.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { SettingsService } from '../settings/settings.service';
import {
  BUDGET_COMMITMENT_EVENT_TYPE,
  budgetCommitmentEventKey,
  type BudgetCommitmentEventType,
} from '@betterspend/shared';
import {
  evaluateBudgetPolicy,
  addMoney,
  convertMoney,
  convertMoneyFromBase,
  isZeroMoney,
  subtractMoneyFloorZero,
  isBudgetEnforcementMode,
  isPendingRequisitionPolicy,
  noBudgetDecision,
  noDepartmentDecision,
  type BudgetEnforcementDecision,
  type BudgetEnforcementMode,
  type PendingRequisitionPolicy,
} from './budget-enforcement';
import {
  commitmentDeltas,
  committedPurchaseOrderBalance,
  reopenedInvoiceBalance,
  reducedPurchaseOrderBalance,
  releasedPurchaseOrderBalance,
  type CommitmentBalance,
  type PurchaseOrderCommitmentBalance,
} from './budget-commitments';

export interface CreateBudgetInput {
  name: string;
  entityId?: string;
  departmentId?: string;
  projectId?: string;
  glAccount?: string;
  fiscalYear: number;
  totalAmount: number;
  currency?: string;
  exchangeRate?: number;
  enforcementMode?: BudgetEnforcementMode;
  pendingRequisitionPolicy?: PendingRequisitionPolicy;
  periods?: Array<{
    periodType?: string;
    periodStart: string;
    periodEnd: string;
    allocatedAmount: number;
  }>;
}

interface EnforcementInput {
  organizationId: string;
  departmentId?: string | null;
  requestedAmount: string;
  currency: string;
  fiscalYear: number;
  excludeRequisitionId?: string | null;
  excludePurchaseOrderId?: string | null;
}

interface EnforcementContext {
  settings: Record<string, string>;
  baseCurrency: string;
  rates: Map<string, string>;
  ownerUserId: string | null;
}

const departmentBudgetOrder = (record: Pick<typeof budgets, 'entityId' | 'createdAt' | 'id'>) => [
  sql`${record.entityId} nulls first`,
  asc(record.createdAt),
  asc(record.id),
];

@Injectable()
export class BudgetsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly entitiesService: EntitiesService,
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly settingsService: SettingsService,
  ) {}

  private assertPolicyOverrides(input: {
    enforcementMode?: string | null;
    pendingRequisitionPolicy?: string | null;
  }): void {
    if (input.enforcementMode != null && !isBudgetEnforcementMode(input.enforcementMode)) {
      throw new BadRequestException(
        `Unsupported budget enforcement mode "${input.enforcementMode}"`,
      );
    }
    if (
      input.pendingRequisitionPolicy != null &&
      !isPendingRequisitionPolicy(input.pendingRequisitionPolicy)
    ) {
      throw new BadRequestException(
        `Unsupported pending requisition policy "${input.pendingRequisitionPolicy}"`,
      );
    }
  }

  async findAll(organizationId: string, entityId?: string) {
    return this.db.query.budgets.findMany({
      where: (b, { and, eq }) =>
        and(eq(b.organizationId, organizationId), entityId ? eq(b.entityId, entityId) : undefined),
      with: { periods: true, entity: true },
      orderBy: (b, { desc }) => desc(b.createdAt),
    });
  }

  async findOne(id: string, organizationId: string) {
    const budget = await this.db.query.budgets.findFirst({
      where: (b, { and, eq }) => and(eq(b.id, id), eq(b.organizationId, organizationId)),
      with: { periods: true, entity: true },
    });
    if (!budget) throw new NotFoundException(`Budget ${id} not found`);
    return budget;
  }

  async create(organizationId: string, actorId: string, input: CreateBudgetInput) {
    this.assertPolicyOverrides(input);
    await this.entitiesService.assertBelongsToOrg(organizationId, input.entityId);
    const currency = input.currency ?? 'USD';
    const { baseCurrency, exchangeRate, baseAmount } =
      await this.exchangeRatesService.convertToBase(
        organizationId,
        input.totalAmount,
        currency,
        input.exchangeRate,
      );
    // Determine budgetType and scopeId from input
    let budgetType: string;
    let scopeId: string;

    if (input.departmentId) {
      budgetType = 'department';
      scopeId = input.departmentId;
    } else if (input.projectId) {
      budgetType = 'project';
      scopeId = input.projectId;
    } else if (input.glAccount) {
      budgetType = 'gl_account';
      // For GL accounts we use a deterministic placeholder UUID derived from the string.
      // Since scopeId must be uuid, we store the glAccount string in a separate way.
      // For simplicity, use a nil UUID and rely on the name to identify.
      scopeId = '00000000-0000-0000-0000-000000000000';
    } else {
      budgetType = 'department';
      scopeId = '00000000-0000-0000-0000-000000000000';
    }

    const budgetId = await this.db.transaction(async (tx) => {
      const [budget] = await tx
        .insert(budgets)
        .values({
          organizationId,
          entityId: input.entityId ?? null,
          name: input.name,
          budgetType,
          scopeId,
          fiscalYear: input.fiscalYear,
          periodType: 'annual',
          totalAmount: String(input.totalAmount),
          currency,
          baseCurrency,
          exchangeRate: String(exchangeRate),
          baseTotalAmount: String(baseAmount),
          baseAllocatedAmount: '0',
          baseSpentAmount: '0',
          enforcementMode: input.enforcementMode ?? null,
          pendingRequisitionPolicy: input.pendingRequisitionPolicy ?? null,
        })
        .returning();

      if (input.periods && input.periods.length > 0) {
        await tx.insert(budgetPeriods).values(
          input.periods.map((p) => ({
            budgetId: budget.id,
            periodStart: new Date(p.periodStart),
            periodEnd: new Date(p.periodEnd),
            amount: String(p.allocatedAmount),
            allocatedAmount: String(p.allocatedAmount),
          })),
        );
      }

      await tx.insert(auditLog).values({
        organizationId,
        userId: actorId,
        entityType: 'budget',
        entityId: budget.id,
        action: 'created',
        changes: {
          name: budget.name,
          enforcementMode: budget.enforcementMode,
          pendingRequisitionPolicy: budget.pendingRequisitionPolicy,
        },
      });

      return budget.id;
    });

    return this.findOne(budgetId, organizationId);
  }

  async checkBudget(
    organizationId: string,
    departmentId: string,
    amount: number,
    fiscalYear: number,
  ): Promise<{
    withinBudget: boolean;
    budgetName?: string;
    allocated?: number;
    spent?: number;
    remaining?: number;
    message?: string;
  }> {
    const budget = await this.db.query.budgets.findFirst({
      where: (b, { and, eq }) =>
        and(
          eq(b.organizationId, organizationId),
          eq(b.budgetType, 'department'),
          eq(b.scopeId, departmentId),
          eq(b.fiscalYear, fiscalYear),
        ),
      orderBy: (record) => departmentBudgetOrder(record),
    });

    if (!budget) {
      return { withinBudget: true, message: 'No budget configured' };
    }

    const allocated = parseFloat(String(budget.totalAmount));
    const spent = parseFloat(String(budget.spentAmount));
    const remaining = allocated - spent;

    return {
      withinBudget: amount <= remaining,
      budgetName: budget.name,
      allocated,
      spent,
      remaining,
    };
  }

  async update(
    id: string,
    organizationId: string,
    actorId: string,
    input: {
      name?: string;
      totalAmount?: number;
      currency?: string;
      entityId?: string | null;
      enforcementMode?: BudgetEnforcementMode | null;
      pendingRequisitionPolicy?: PendingRequisitionPolicy | null;
    },
  ) {
    this.assertPolicyOverrides(input);
    await this.entitiesService.assertBelongsToOrg(organizationId, input.entityId);
    const moneyChanged = input.currency !== undefined || input.totalAmount !== undefined;

    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(budgets)
        .where(and(eq(budgets.id, id), eq(budgets.organizationId, organizationId)))
        .for('update');
      if (!locked) throw new NotFoundException(`Budget ${id} not found`);
      const nextCurrency = input.currency ?? locked.currency;
      const baseCurrency = moneyChanged
        ? await this.exchangeRatesService.getOrganizationBaseCurrency(organizationId, tx)
        : null;
      const [totalRate, spentRate] = baseCurrency
        ? await Promise.all([
            this.exchangeRatesService.getRateDecimal(
              organizationId,
              nextCurrency,
              baseCurrency,
              undefined,
              tx,
            ),
            this.exchangeRatesService.getRateDecimal(
              organizationId,
              locked.currency,
              baseCurrency,
              undefined,
              tx,
            ),
          ])
        : [null, null];
      await tx
        .update(budgets)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.totalAmount !== undefined ? { totalAmount: String(input.totalAmount) } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
          ...(input.enforcementMode !== undefined
            ? { enforcementMode: input.enforcementMode }
            : {}),
          ...(input.pendingRequisitionPolicy !== undefined
            ? { pendingRequisitionPolicy: input.pendingRequisitionPolicy }
            : {}),
          ...(baseCurrency && totalRate && spentRate
            ? {
                baseCurrency,
                exchangeRate: totalRate,
                baseTotalAmount: convertMoney(
                  input.totalAmount !== undefined ? String(input.totalAmount) : locked.totalAmount,
                  totalRate,
                ),
                baseSpentAmount: convertMoney(locked.spentAmount, spentRate),
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(budgets.id, id), eq(budgets.organizationId, organizationId)));

      await tx.insert(auditLog).values({
        organizationId,
        userId: actorId,
        entityType: 'budget',
        entityId: id,
        action:
          input.enforcementMode !== undefined || input.pendingRequisitionPolicy !== undefined
            ? 'enforcement_policy_updated'
            : 'updated',
        changes: {
          before: {
            name: locked.name,
            totalAmount: locked.totalAmount,
            currency: locked.currency,
            entityId: locked.entityId,
            enforcementMode: locked.enforcementMode,
            pendingRequisitionPolicy: locked.pendingRequisitionPolicy,
          },
          after: {
            name: input.name ?? locked.name,
            totalAmount:
              input.totalAmount !== undefined ? String(input.totalAmount) : locked.totalAmount,
            currency: input.currency ?? locked.currency,
            entityId: input.entityId !== undefined ? input.entityId : locked.entityId,
            enforcementMode:
              input.enforcementMode !== undefined ? input.enforcementMode : locked.enforcementMode,
            pendingRequisitionPolicy:
              input.pendingRequisitionPolicy !== undefined
                ? input.pendingRequisitionPolicy
                : locked.pendingRequisitionPolicy,
          },
        },
      });
    });
    return this.findOne(id, organizationId);
  }

  /**
   * Resolve and evaluate the effective department-budget policy for a spend decision.
   * Callers only need to act on allow, block, or require_approval.
   */
  async evaluateEnforcement(input: EnforcementInput): Promise<BudgetEnforcementDecision> {
    if (!input.departmentId) return noDepartmentDecision();

    const budget = await this.db.query.budgets.findFirst({
      where: (record, { and, eq }) =>
        and(
          eq(record.organizationId, input.organizationId),
          eq(record.budgetType, 'department'),
          eq(record.scopeId, input.departmentId!),
          eq(record.fiscalYear, input.fiscalYear),
        ),
      orderBy: (record) => departmentBudgetOrder(record),
    });
    if (!budget) return noBudgetDecision();

    const context = await this.loadEnforcementContext(input);
    return this.evaluateBudget(input, budget, this.db, context);
  }

  /** Serialize a budget decision with the caller's state transition. */
  async withEnforcementLock<T>(
    input: EnforcementInput,
    apply: (tx: DbTransaction, decision: BudgetEnforcementDecision) => Promise<T>,
  ): Promise<T> {
    if (!input.departmentId) {
      return this.db.transaction((tx) => apply(tx, noDepartmentDecision()));
    }
    const departmentId = input.departmentId;
    const context = await this.loadEnforcementContext(input);
    return this.db.transaction(async (tx) => {
      const [budget] = await tx
        .select()
        .from(budgets)
        .where(
          and(
            eq(budgets.organizationId, input.organizationId),
            eq(budgets.budgetType, 'department'),
            eq(budgets.scopeId, departmentId),
            eq(budgets.fiscalYear, input.fiscalYear),
          ),
        )
        .orderBy(...departmentBudgetOrder(budgets))
        .for('update');
      if (!budget) return apply(tx, noBudgetDecision());

      const decision = await this.evaluateBudget(input, budget, tx, context);
      return apply(tx, decision);
    });
  }

  private async loadEnforcementContext(input: EnforcementInput): Promise<EnforcementContext> {
    const [settings, baseCurrency, rates, department] = await Promise.all([
      this.settingsService.getAll(input.organizationId),
      this.exchangeRatesService.getOrganizationBaseCurrency(input.organizationId),
      this.exchangeRatesService.list(input.organizationId),
      input.departmentId
        ? this.db.query.departments.findFirst({
            where: (record, { and, eq }) =>
              and(
                eq(record.id, input.departmentId!),
                eq(record.organizationId, input.organizationId),
              ),
          })
        : Promise.resolve(undefined),
    ]);
    const owner = department?.budgetOwnerId
      ? await this.db.query.users.findFirst({
          where: (record, { and, eq }) =>
            and(
              eq(record.id, department.budgetOwnerId!),
              eq(record.organizationId, input.organizationId),
              eq(record.isActive, true),
            ),
        })
      : undefined;
    return {
      settings,
      baseCurrency,
      rates: new Map(
        rates
          .filter((rate) => rate.toCurrency === baseCurrency)
          .map((rate) => [rate.fromCurrency, rate.rate]),
      ),
      ownerUserId: owner?.id ?? null,
    };
  }

  private getContextRate(context: EnforcementContext, currency: string): string {
    if (currency.toUpperCase() === context.baseCurrency) return '1';
    const rate = context.rates.get(currency.toUpperCase());
    if (!rate) {
      throw new BadRequestException(
        `No exchange rate configured for ${currency.toUpperCase()} -> ${context.baseCurrency}`,
      );
    }
    return rate;
  }

  private async evaluateBudget(
    input: EnforcementInput,
    budget: typeof budgets.$inferSelect,
    executor: Db | DbTransaction,
    context: EnforcementContext,
  ): Promise<BudgetEnforcementDecision> {
    if (!input.departmentId) return noDepartmentDecision();

    const mode = isBudgetEnforcementMode(budget.enforcementMode)
      ? budget.enforcementMode
      : isBudgetEnforcementMode(context.settings.budget_enforcement_mode)
        ? context.settings.budget_enforcement_mode
        : 'hard_stop';
    const pendingPolicy = isPendingRequisitionPolicy(budget.pendingRequisitionPolicy)
      ? budget.pendingRequisitionPolicy
      : isPendingRequisitionPolicy(context.settings.budget_pending_requisition_policy)
        ? context.settings.budget_pending_requisition_policy
        : 'approved_only';

    const start = new Date(Date.UTC(input.fiscalYear, 0, 1));
    const end = new Date(Date.UTC(input.fiscalYear + 1, 0, 1));
    const baseConditions = [
      eq(requisitions.organizationId, input.organizationId),
      eq(requisitions.departmentId, input.departmentId),
      gte(requisitions.createdAt, start),
      lt(requisitions.createdAt, end),
    ];
    if (input.excludeRequisitionId) {
      baseConditions.push(ne(requisitions.id, input.excludeRequisitionId));
    }

    const ledgerConditions = [eq(budgetCommitmentEvents.budgetId, budget.id)];
    if (input.excludeRequisitionId) {
      ledgerConditions.push(
        or(
          isNull(budgetCommitmentEvents.requisitionId),
          ne(budgetCommitmentEvents.requisitionId, input.excludeRequisitionId),
          isNotNull(budgetCommitmentEvents.purchaseOrderId),
        )!,
      );
    }
    if (input.excludePurchaseOrderId) {
      ledgerConditions.push(
        or(
          isNull(budgetCommitmentEvents.purchaseOrderId),
          ne(budgetCommitmentEvents.purchaseOrderId, input.excludePurchaseOrderId),
        )!,
      );
    }
    const [ledger] = await executor
      .select({
        amount: sql<string>`coalesce(sum(${budgetCommitmentEvents.baseReservedDelta} + ${budgetCommitmentEvents.baseCommittedDelta}), 0)`,
      })
      .from(budgetCommitmentEvents)
      .where(and(...ledgerConditions));
    const pendingGroups =
      pendingPolicy === 'include_pending'
        ? await executor
            .select({
              currency: requisitions.currency,
              amount: sql<string>`coalesce(sum(${requisitions.totalAmount}), 0)`,
            })
            .from(requisitions)
            .where(
              and(
                ...baseConditions,
                inArray(requisitions.status, ['submitted', 'pending_approval']),
              ),
            )
            .groupBy(requisitions.currency)
        : [];
    const pendingCommitments = pendingGroups.map((group) =>
      convertMoney(group.amount, this.getContextRate(context, group.currency)),
    );
    const committedAmount = addMoney([ledger?.amount ?? '0', ...pendingCommitments]);
    const requestedRate = this.getContextRate(context, input.currency);
    const requestedAmount = convertMoney(input.requestedAmount, requestedRate);

    const baseTotalAmount = !isZeroMoney(budget.baseTotalAmount)
      ? budget.baseTotalAmount
      : convertMoney(budget.totalAmount, budget.exchangeRate || '1');
    const baseSpentAmount = !isZeroMoney(budget.baseSpentAmount)
      ? budget.baseSpentAmount
      : convertMoney(budget.spentAmount, budget.exchangeRate || '1');

    return evaluateBudgetPolicy({
      budget: {
        id: budget.id,
        name: budget.name,
        currency: context.baseCurrency,
        totalAmount: baseTotalAmount,
        spentAmount: baseSpentAmount,
      },
      mode,
      pendingPolicy,
      committedAmount,
      requestedAmount,
      ownerUserId: mode === 'owner_approval' ? context.ownerUserId : null,
    });
  }

  async addPeriod(
    id: string,
    organizationId: string,
    input: { periodStart: string; periodEnd: string; allocatedAmount: number },
  ) {
    await this.findOne(id, organizationId);
    await this.db.insert(budgetPeriods).values({
      budgetId: id,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      amount: String(input.allocatedAmount),
      allocatedAmount: String(input.allocatedAmount),
    });
    return this.findOne(id, organizationId);
  }

  async removePeriod(budgetId: string, periodId: string, organizationId: string) {
    await this.findOne(budgetId, organizationId);
    await this.db
      .delete(budgetPeriods)
      .where(and(eq(budgetPeriods.id, periodId), eq(budgetPeriods.budgetId, budgetId)));
    return this.findOne(budgetId, organizationId);
  }

  // ---------------------------------------------------------------------------
  // Forecasting helpers
  // ---------------------------------------------------------------------------

  /**
   * Simple ordinary-least-squares linear regression.
   * Returns { slope, intercept } for y = slope*x + intercept.
   * x values are 0-based month indices.
   */
  private linearRegression(points: { x: number; y: number }[]): {
    slope: number;
    intercept: number;
  } {
    const n = points.length;
    if (n === 0) return { slope: 0, intercept: 0 };
    if (n === 1) return { slope: 0, intercept: points[0].y };

    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) return { slope: 0, intercept: sumY / n };

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
  }

  /**
   * Compute estimated burn date given current monthly spend rate and
   * remaining budget.  Returns null if rate <= 0 or budget not exhausted.
   */
  private estimateBurnDate(
    remaining: number,
    avgMonthlySpend: number,
    referenceDate: Date,
  ): string | null {
    if (avgMonthlySpend <= 0 || remaining <= 0) return null;
    const monthsUntilBurn = remaining / avgMonthlySpend;
    const burnDate = new Date(referenceDate);
    burnDate.setDate(burnDate.getDate() + Math.round(monthsUntilBurn * 30.44));
    return burnDate.toISOString().slice(0, 10);
  }

  /**
   * GET /budgets/forecast  — per-budget consumption forecast
   */
  async getForecast(organizationId: string, fiscalYear: number) {
    // 1. Load all budgets for this org + fiscal year
    const allBudgets = await this.db.query.budgets.findMany({
      where: (b, { and: a, eq: e }) =>
        a(e(b.organizationId, organizationId), e(b.fiscalYear, fiscalYear)),
    });

    if (allBudgets.length === 0) return [];

    // 2. Monthly PO spend for last 6 months in this fiscal year, per scope
    //    We bucket POs by department (via requisition) or project.
    //    We pull org-wide monthly spend and apply it proportionally per budget
    //    based on spentAmount ratios — a pragmatic approximation given the
    //    indirect budget→PO linkage in the schema.
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const monthsElapsed = Math.max(currentMonth, 1);
    const monthsRemaining = 12 - monthsElapsed;

    // Monthly PO spend for the fiscal year (org-wide, issued POs only)
    const monthlyRows = await this.db.execute(sql`
      SELECT
        EXTRACT(MONTH FROM po.issued_at)::int AS month,
        SUM(po.total_amount)::float8          AS total
      FROM purchase_orders po
      WHERE po.organization_id = ${organizationId}
        AND po.status NOT IN ('draft', 'cancelled')
        AND EXTRACT(YEAR FROM po.issued_at) = ${fiscalYear}
      GROUP BY EXTRACT(MONTH FROM po.issued_at)
      ORDER BY month ASC
    `);

    const monthlySpendMap: Record<number, number> = {};
    for (const row of monthlyRows as unknown as Array<{ month: number; total: number }>) {
      monthlySpendMap[Number(row.month)] = Number(row.total);
    }

    // Build last-6-month data points (months up to current)
    const last6: { x: number; y: number }[] = [];
    for (let i = Math.max(1, currentMonth - 5); i <= currentMonth; i++) {
      last6.push({ x: last6.length, y: monthlySpendMap[i] ?? 0 });
    }

    const { slope, intercept } = this.linearRegression(last6);
    const avgMonthly =
      last6.length >= 2
        ? slope * last6.length + intercept // projected next-month spend
        : last6.reduce((s, p) => s + p.y, 0) / Math.max(last6.length, 1);

    // Total org-wide PO spend YTD
    const orgUtilizedRow = await this.db.execute(sql`
      SELECT COALESCE(SUM(po.total_amount),0)::float8 AS total
      FROM purchase_orders po
      WHERE po.organization_id = ${organizationId}
        AND po.status NOT IN ('draft', 'cancelled')
        AND EXTRACT(YEAR FROM po.issued_at) = ${fiscalYear}
    `);
    const orgUtilizedTotal = Number(
      (orgUtilizedRow as unknown as Array<{ total: number }>)[0]?.total ?? 0,
    );

    // Committed: pending/draft requisitions total (org-wide)
    const committedRow = await this.db.execute(sql`
      SELECT COALESCE(SUM(r.total_amount),0)::float8 AS total
      FROM requisitions r
      WHERE r.organization_id = ${organizationId}
        AND r.status IN ('draft', 'submitted', 'pending_approval')
        AND EXTRACT(YEAR FROM r.created_at) = ${fiscalYear}
    `);
    const orgCommittedTotal = Number(
      (committedRow as unknown as Array<{ total: number }>)[0]?.total ?? 0,
    );

    // Total budget across org (to compute proportional share)
    const orgTotalBudget = allBudgets.reduce((s, b) => s + parseFloat(String(b.totalAmount)), 0);

    const results = allBudgets.map((budget) => {
      const totalAmount = parseFloat(String(budget.totalAmount));
      const budgetShare = orgTotalBudget > 0 ? totalAmount / orgTotalBudget : 0;

      // Per-budget utilization (from tracked spentAmount)
      const utilized = parseFloat(String(budget.spentAmount));

      // Committed proportional to budget share
      const committed = orgCommittedTotal * budgetShare;

      // Project end-of-year spend: YTD actual + remaining months × projected rate
      const projectedMonthlyRate = Math.max(avgMonthly * budgetShare, 0);
      const forecast = utilized + projectedMonthlyRate * monthsRemaining;

      const percentUsed = totalAmount > 0 ? (utilized / totalAmount) * 100 : 0;
      const forecastPct = totalAmount > 0 ? (forecast / totalAmount) * 100 : 0;

      let status: 'on_track' | 'at_risk' | 'over_budget';
      if (forecastPct >= 100) {
        status = 'over_budget';
      } else if (forecastPct >= 80) {
        status = 'at_risk';
      } else {
        status = 'on_track';
      }

      const variance = totalAmount - forecast;

      // Estimate burn date based on projected monthly spend vs remaining
      const remaining = totalAmount - utilized;
      const forecastBurnDate =
        projectedMonthlyRate > 0 && remaining > 0
          ? this.estimateBurnDate(remaining, projectedMonthlyRate, now)
          : null;

      return {
        id: budget.id,
        name: budget.name,
        budgetType: budget.budgetType,
        fiscalYear: budget.fiscalYear,
        totalAmount,
        utilized,
        committed,
        forecast: Math.round(forecast * 100) / 100,
        percentUsed: Math.round(percentUsed * 10) / 10,
        forecastBurnDate,
        variance: Math.round(variance * 100) / 100,
        status,
        currency: budget.currency,
      };
    });

    return results;
  }

  /**
   * GET /budgets/forecast/summary — org-level budget forecast summary
   */
  async getForecastSummary(organizationId: string, fiscalYear: number) {
    const forecasts = await this.getForecast(organizationId, fiscalYear);

    const totalBudgeted = forecasts.reduce((s, f) => s + f.totalAmount, 0);
    const totalUtilized = forecasts.reduce((s, f) => s + f.utilized, 0);
    const totalForecast = forecasts.reduce((s, f) => s + f.forecast, 0);

    const onTrackCount = forecasts.filter((f) => f.status === 'on_track').length;
    const atRiskCount = forecasts.filter((f) => f.status === 'at_risk').length;
    const overBudgetCount = forecasts.filter((f) => f.status === 'over_budget').length;

    const topAtRiskBudgets = forecasts
      .filter((f) => f.status !== 'on_track')
      .sort((a, b) => b.percentUsed - a.percentUsed)
      .slice(0, 5);

    return {
      totalBudgeted: Math.round(totalBudgeted * 100) / 100,
      totalUtilized: Math.round(totalUtilized * 100) / 100,
      totalForecast: Math.round(totalForecast * 100) / 100,
      onTrackCount,
      atRiskCount,
      overBudgetCount,
      topAtRiskBudgets,
    };
  }

  async recordSpend(
    organizationId: string,
    departmentId: string,
    baseAmount: string,
    fiscalYear: number,
    executor: Db | DbTransaction = this.db,
    recordedAt = new Date(),
  ) {
    const budget = await executor.query.budgets.findFirst({
      where: (b, { and, eq }) =>
        and(
          eq(b.organizationId, organizationId),
          eq(b.budgetType, 'department'),
          eq(b.scopeId, departmentId),
          eq(b.fiscalYear, fiscalYear),
        ),
      orderBy: (record) => departmentBudgetOrder(record),
    });

    if (!budget) return { updated: false, message: 'No budget configured' };

    const budgetAmount = convertMoneyFromBase(baseAmount, budget.exchangeRate || '1');

    await executor
      .update(budgets)
      .set({
        spentAmount: sql`${budgets.spentAmount} + ${budgetAmount}`,
        baseSpentAmount: sql`${budgets.baseSpentAmount} + ${baseAmount}`,
        updatedAt: new Date(),
      })
      .where(and(eq(budgets.id, budget.id), eq(budgets.organizationId, organizationId)));

    // Keep the period ledger aligned with the date of the spend being recorded or reversed.
    await executor
      .update(budgetPeriods)
      .set({
        spentAmount: sql`${budgetPeriods.spentAmount} + ${budgetAmount}`,
      })
      .where(
        and(
          eq(budgetPeriods.budgetId, budget.id),
          sql`${budgetPeriods.periodStart} <= ${recordedAt}`,
          sql`${budgetPeriods.periodEnd} >= ${recordedAt}`,
        ),
      );

    return { updated: true, budgetId: budget.id };
  }

  async recordRequisitionApproval(
    executor: DbTransaction,
    organizationId: string,
    requisitionId: string,
  ): Promise<void> {
    const context = await this.getRequisitionCommitmentContext(
      executor,
      organizationId,
      requisitionId,
    );
    if (!context) return;
    await this.lockRequisitionCommitments(executor, organizationId, requisitionId);
    const current = await this.getCommitmentBalance(executor, context.budget.id, requisitionId);
    await this.appendCommitmentEvent(executor, context, {
      eventKey: budgetCommitmentEventKey.requisitionApproved(
        requisitionId,
        context.requisition.updatedAt,
      ),
      eventType: BUDGET_COMMITMENT_EVENT_TYPE.REQUISITION_RESERVED,
      reason: 'Approved requisition reserved budget',
      desired: { ...current, reserved: context.baseAmount, committed: '0' },
    });
  }

  async releaseRequisition(
    executor: DbTransaction,
    organizationId: string,
    requisitionId: string,
    reason: 'cancelled' | 'rejected',
  ): Promise<void> {
    const context = await this.getRequisitionCommitmentContext(
      executor,
      organizationId,
      requisitionId,
    );
    if (!context) return;
    await this.lockRequisitionCommitments(executor, organizationId, requisitionId);
    const current = await this.getCommitmentBalance(executor, context.budget.id, requisitionId);
    await this.appendCommitmentEvent(executor, context, {
      eventKey: budgetCommitmentEventKey.requisitionReleased(
        requisitionId,
        reason,
        context.requisition.updatedAt,
      ),
      eventType: BUDGET_COMMITMENT_EVENT_TYPE.REQUISITION_RELEASED,
      reason: `Requisition ${reason}`,
      desired: { reserved: '0', committed: current.committed, expended: current.expended },
    });
  }

  async commitPurchaseOrder(
    executor: DbTransaction,
    organizationId: string,
    purchaseOrderId: string,
  ): Promise<void> {
    const context = await this.getPurchaseOrderCommitmentContext(
      executor,
      organizationId,
      purchaseOrderId,
    );
    if (!context) return;
    await this.lockRequisitionCommitments(executor, organizationId, context.requisition.id);
    const current = await this.getCommitmentBalance(
      executor,
      context.budget.id,
      context.requisition.id,
    );
    const currentPurchaseOrder = await this.getCommitmentBalance(
      executor,
      context.budget.id,
      context.requisition.id,
      purchaseOrderId,
    );
    await this.appendCommitmentEvent(executor, context, {
      eventKey: budgetCommitmentEventKey.purchaseOrderIssued(
        purchaseOrderId,
        context.purchaseOrder.version,
      ),
      eventType: BUDGET_COMMITMENT_EVENT_TYPE.PURCHASE_ORDER_COMMITTED,
      reason: 'Issued purchase order converted reservation to commitment',
      desired: committedPurchaseOrderBalance(
        current,
        currentPurchaseOrder,
        context.budgetBaseTotalAmount,
      ),
    });
  }

  async reducePurchaseOrderCommitment(
    executor: DbTransaction,
    organizationId: string,
    purchaseOrderId: string,
  ): Promise<void> {
    const context = await this.getPurchaseOrderCommitmentContext(
      executor,
      organizationId,
      purchaseOrderId,
    );
    if (!context) return;
    await this.lockRequisitionCommitments(executor, organizationId, context.requisition.id);
    const current = await this.getCommitmentBalance(
      executor,
      context.budget.id,
      context.requisition.id,
    );
    const currentPurchaseOrder = await this.getCommitmentBalance(
      executor,
      context.budget.id,
      context.requisition.id,
      purchaseOrderId,
    );
    await this.appendCommitmentEvent(executor, context, {
      eventKey: budgetCommitmentEventKey.purchaseOrderChanged(
        purchaseOrderId,
        context.purchaseOrder.version,
      ),
      eventType: BUDGET_COMMITMENT_EVENT_TYPE.PURCHASE_ORDER_REDUCED,
      reason: 'Change order released reduced commitment',
      desired: reducedPurchaseOrderBalance(
        current,
        currentPurchaseOrder,
        context.budgetBaseTotalAmount,
      ),
    });
  }

  async releasePurchaseOrder(
    executor: DbTransaction,
    organizationId: string,
    purchaseOrderId: string,
    reason: 'cancelled' | 'rejected',
  ): Promise<void> {
    const context = await this.getPurchaseOrderCommitmentContext(
      executor,
      organizationId,
      purchaseOrderId,
    );
    if (!context) return;
    await this.lockRequisitionCommitments(executor, organizationId, context.requisition.id);
    const current = await this.getCommitmentBalance(
      executor,
      context.budget.id,
      context.requisition.id,
    );
    const currentPurchaseOrder = await this.getCommitmentBalance(
      executor,
      context.budget.id,
      context.requisition.id,
      purchaseOrderId,
    );
    await this.appendCommitmentEvent(executor, context, {
      eventKey: budgetCommitmentEventKey.purchaseOrderReleased(
        purchaseOrderId,
        reason,
        context.purchaseOrder.updatedAt,
      ),
      eventType: BUDGET_COMMITMENT_EVENT_TYPE.PURCHASE_ORDER_RELEASED,
      reason: `Purchase order ${reason}`,
      desired: releasedPurchaseOrderBalance(
        current,
        currentPurchaseOrder,
        context.budgetBaseTotalAmount,
      ),
    });
  }

  async expenseInvoice(
    executor: DbTransaction,
    organizationId: string,
    invoiceId: string,
    baseExpenseAmount: string,
    baseCommitmentReleaseAmount: string,
    approvedAt = new Date(),
  ): Promise<void> {
    const invoice = await executor.query.invoices.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, invoiceId), eq(record.organizationId, organizationId)),
    });
    if (!invoice?.purchaseOrderId) return;
    const context = await this.getPurchaseOrderCommitmentContext(
      executor,
      organizationId,
      invoice.purchaseOrderId,
    );
    if (!context) return;
    await this.lockRequisitionCommitments(executor, organizationId, context.requisition.id);
    await this.recordSpend(
      organizationId,
      context.requisition.departmentId!,
      baseExpenseAmount,
      context.requisition.createdAt.getUTCFullYear(),
      executor,
      approvedAt,
    );
    const current = await this.getCommitmentBalance(
      executor,
      context.budget.id,
      context.requisition.id,
    );
    const currentPurchaseOrder = await this.getCommitmentBalance(
      executor,
      context.budget.id,
      context.requisition.id,
      invoice.purchaseOrderId,
    );
    const releasedCommitment = subtractMoneyFloorZero(
      currentPurchaseOrder.committed,
      subtractMoneyFloorZero(currentPurchaseOrder.committed, baseCommitmentReleaseAmount),
    );
    await this.appendCommitmentEvent(
      executor,
      { ...context, invoiceId },
      {
        eventKey: budgetCommitmentEventKey.invoiceApproved(invoiceId, approvedAt),
        eventType: BUDGET_COMMITMENT_EVENT_TYPE.INVOICE_EXPENDED,
        reason: 'Approved invoice converted commitment to spend',
        desired: {
          reserved: current.reserved,
          committed: subtractMoneyFloorZero(current.committed, releasedCommitment),
          expended: addMoney([current.expended, baseExpenseAmount]),
        },
      },
    );
  }

  async reopenInvoice(
    executor: DbTransaction,
    organizationId: string,
    invoiceId: string,
    editedAt: Date,
  ): Promise<void> {
    const invoice = await executor.query.invoices.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, invoiceId), eq(record.organizationId, organizationId)),
    });
    if (!invoice?.purchaseOrderId) return;
    const context = await this.getPurchaseOrderCommitmentContext(
      executor,
      organizationId,
      invoice.purchaseOrderId,
    );
    if (!context) return;
    await this.lockRequisitionCommitments(executor, organizationId, context.requisition.id);
    const current = await this.getCommitmentBalance(
      executor,
      context.budget.id,
      context.requisition.id,
    );
    const invoiceBalance = await this.getCommitmentBalance(
      executor,
      context.budget.id,
      context.requisition.id,
      invoice.purchaseOrderId,
      invoiceId,
    );
    if (isZeroMoney(invoiceBalance.expended) && isZeroMoney(invoiceBalance.invoiced)) return;

    await this.recordSpend(
      organizationId,
      context.requisition.departmentId!,
      `-${invoiceBalance.expended}`,
      context.requisition.createdAt.getUTCFullYear(),
      executor,
      invoice.approvedAt ?? editedAt,
    );
    await this.appendCommitmentEvent(
      executor,
      { ...context, invoiceId },
      {
        eventKey: budgetCommitmentEventKey.invoiceReopened(invoiceId, editedAt),
        eventType: BUDGET_COMMITMENT_EVENT_TYPE.INVOICE_REOPENED,
        reason: 'Material invoice edit reopened approval and restored commitment',
        desired: reopenedInvoiceBalance(current, invoiceBalance),
      },
    );
  }

  private async getRequisitionCommitmentContext(
    executor: DbTransaction,
    organizationId: string,
    requisitionId: string,
  ) {
    const requisition = await executor.query.requisitions.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, requisitionId), eq(record.organizationId, organizationId)),
    });
    if (!requisition?.departmentId) return null;
    const budget = await executor.query.budgets.findFirst({
      where: (record, { and, eq }) =>
        and(
          eq(record.organizationId, requisition.organizationId),
          eq(record.budgetType, 'department'),
          eq(record.scopeId, requisition.departmentId!),
          eq(record.fiscalYear, requisition.createdAt.getUTCFullYear()),
        ),
      orderBy: (record) => departmentBudgetOrder(record),
    });
    if (!budget) return null;
    const rate = await this.exchangeRatesService.getRateDecimal(
      requisition.organizationId,
      requisition.currency,
      budget.baseCurrency,
      undefined,
      executor,
    );
    return {
      organizationId: requisition.organizationId,
      budget,
      requisition,
      requisitionId,
      purchaseOrderId: null as string | null,
      invoiceId: null as string | null,
      baseAmount: convertMoney(requisition.totalAmount, rate),
    };
  }

  private async lockRequisitionCommitments(
    executor: DbTransaction,
    organizationId: string,
    requisitionId: string,
  ): Promise<void> {
    await executor
      .select({ id: requisitions.id })
      .from(requisitions)
      .where(
        and(eq(requisitions.id, requisitionId), eq(requisitions.organizationId, organizationId)),
      )
      .for('update');
  }

  private async getPurchaseOrderCommitmentContext(
    executor: DbTransaction,
    organizationId: string,
    purchaseOrderId: string,
  ) {
    const purchaseOrder = await executor.query.purchaseOrders.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.id, purchaseOrderId), eq(record.organizationId, organizationId)),
    });
    if (!purchaseOrder?.requisitionId) return null;
    const requisitionContext = await this.getRequisitionCommitmentContext(
      executor,
      organizationId,
      purchaseOrder.requisitionId,
    );
    if (!requisitionContext) return null;
    const rate = await this.exchangeRatesService.getRateDecimal(
      organizationId,
      purchaseOrder.baseCurrency,
      requisitionContext.budget.baseCurrency,
      undefined,
      executor,
    );
    return {
      ...requisitionContext,
      purchaseOrder,
      purchaseOrderId,
      budgetBaseTotalAmount: convertMoney(purchaseOrder.baseTotalAmount, rate),
    };
  }

  private async getCommitmentBalance(
    executor: Db | DbTransaction,
    budgetId: string,
    requisitionId: string,
    purchaseOrderId?: string,
    invoiceId?: string,
  ): Promise<PurchaseOrderCommitmentBalance> {
    const conditions = [
      eq(budgetCommitmentEvents.budgetId, budgetId),
      eq(budgetCommitmentEvents.requisitionId, requisitionId),
    ];
    if (purchaseOrderId) {
      conditions.push(eq(budgetCommitmentEvents.purchaseOrderId, purchaseOrderId));
    }
    if (invoiceId) {
      conditions.push(eq(budgetCommitmentEvents.invoiceId, invoiceId));
    }
    const [balance] = await executor
      .select({
        reserved: sql<string>`coalesce(sum(${budgetCommitmentEvents.baseReservedDelta}), 0)`,
        committed: sql<string>`coalesce(sum(${budgetCommitmentEvents.baseCommittedDelta}), 0)`,
        expended: sql<string>`coalesce(sum(${budgetCommitmentEvents.baseExpendedDelta}), 0)`,
        invoiced: sql<string>`coalesce(sum(CASE
          WHEN ${budgetCommitmentEvents.invoiceId} IS NOT NULL
          THEN -${budgetCommitmentEvents.baseCommittedDelta}
          ELSE 0
        END), 0)`,
      })
      .from(budgetCommitmentEvents)
      .where(and(...conditions));
    return {
      reserved: balance?.reserved ?? '0',
      committed: balance?.committed ?? '0',
      expended: balance?.expended ?? '0',
      invoiced: balance?.invoiced ?? '0',
    };
  }

  private async appendCommitmentEvent(
    executor: DbTransaction,
    context: {
      organizationId: string;
      budget: { id: string };
      requisitionId: string;
      purchaseOrderId: string | null;
      invoiceId: string | null;
    },
    event: {
      eventKey: string;
      eventType: BudgetCommitmentEventType;
      reason: string;
      desired: CommitmentBalance;
    },
  ): Promise<void> {
    const current = await this.getCommitmentBalance(
      executor,
      context.budget.id,
      context.requisitionId,
    );
    const deltas = commitmentDeltas(current, event.desired);
    if (Object.values(deltas).every(isZeroMoney)) return;
    await executor
      .insert(budgetCommitmentEvents)
      .values({
        organizationId: context.organizationId,
        budgetId: context.budget.id,
        requisitionId: context.requisitionId,
        purchaseOrderId: context.purchaseOrderId,
        invoiceId: context.invoiceId,
        eventKey: event.eventKey,
        eventType: event.eventType,
        baseReservedDelta: deltas.reserved,
        baseCommittedDelta: deltas.committed,
        baseExpendedDelta: deltas.expended,
        reason: event.reason,
      })
      .onConflictDoNothing();
  }
}
