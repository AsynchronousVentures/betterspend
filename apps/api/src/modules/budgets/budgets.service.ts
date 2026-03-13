import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { budgets, budgetPeriods } from '@betterspend/db';
import { EntitiesService } from '../entities/entities.service';

export interface CreateBudgetInput {
  name: string;
  entityId?: string;
  departmentId?: string;
  projectId?: string;
  glAccount?: string;
  fiscalYear: number;
  totalAmount: number;
  currency?: string;
  periods?: Array<{
    periodType?: string;
    periodStart: string;
    periodEnd: string;
    allocatedAmount: number;
  }>;
}

@Injectable()
export class BudgetsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly entitiesService: EntitiesService,
  ) {}

  async findAll(organizationId: string, entityId?: string) {
    return this.db.query.budgets.findMany({
      where: (b, { and, eq }) => and(
        eq(b.organizationId, organizationId),
        entityId ? eq(b.entityId, entityId) : undefined,
      ),
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

  async create(organizationId: string, input: CreateBudgetInput) {
    await this.entitiesService.assertBelongsToOrg(organizationId, input.entityId);
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
      const [budget] = await tx.insert(budgets).values({
        organizationId,
        entityId: input.entityId ?? null,
        name: input.name,
        budgetType,
        scopeId,
        fiscalYear: input.fiscalYear,
        periodType: 'annual',
        totalAmount: String(input.totalAmount),
        currency: input.currency ?? 'USD',
      }).returning();

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
      where: (b, { and, eq }) => and(
        eq(b.organizationId, organizationId),
        eq(b.budgetType, 'department'),
        eq(b.scopeId, departmentId),
        eq(b.fiscalYear, fiscalYear),
      ),
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
    input: { name?: string; totalAmount?: number; currency?: string; entityId?: string | null },
  ) {
    await this.findOne(id, organizationId);
    await this.entitiesService.assertBelongsToOrg(organizationId, input.entityId);
    await this.db.update(budgets)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.totalAmount !== undefined ? { totalAmount: String(input.totalAmount) } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(budgets.id, id), eq(budgets.organizationId, organizationId)));
    return this.findOne(id, organizationId);
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
    await this.db.delete(budgetPeriods).where(
      and(eq(budgetPeriods.id, periodId), eq(budgetPeriods.budgetId, budgetId)),
    );
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
  private linearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
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
    for (const row of (monthlyRows as unknown) as Array<{ month: number; total: number }>) {
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
        ? slope * last6.length + intercept  // projected next-month spend
        : last6.reduce((s, p) => s + p.y, 0) / Math.max(last6.length, 1);

    // Total org-wide PO spend YTD
    const orgUtilizedRow = await this.db.execute(sql`
      SELECT COALESCE(SUM(po.total_amount),0)::float8 AS total
      FROM purchase_orders po
      WHERE po.organization_id = ${organizationId}
        AND po.status NOT IN ('draft', 'cancelled')
        AND EXTRACT(YEAR FROM po.issued_at) = ${fiscalYear}
    `);
    const orgUtilizedTotal = Number(((orgUtilizedRow as unknown) as Array<{ total: number }>)[0]?.total ?? 0);

    // Committed: pending/draft requisitions total (org-wide)
    const committedRow = await this.db.execute(sql`
      SELECT COALESCE(SUM(r.total_amount),0)::float8 AS total
      FROM requisitions r
      WHERE r.organization_id = ${organizationId}
        AND r.status IN ('draft', 'submitted', 'pending_approval')
        AND EXTRACT(YEAR FROM r.created_at) = ${fiscalYear}
    `);
    const orgCommittedTotal = Number(((committedRow as unknown) as Array<{ total: number }>)[0]?.total ?? 0);

    // Total budget across org (to compute proportional share)
    const orgTotalBudget = allBudgets.reduce(
      (s, b) => s + parseFloat(String(b.totalAmount)),
      0,
    );

    const results = allBudgets.map((budget) => {
      const totalAmount = parseFloat(String(budget.totalAmount));
      const budgetShare = orgTotalBudget > 0 ? totalAmount / orgTotalBudget : 0;

      // Per-budget utilization (from tracked spentAmount)
      const utilized = parseFloat(String(budget.spentAmount));

      // Committed proportional to budget share
      const committed = orgCommittedTotal * budgetShare;

      // Project end-of-year spend: YTD actual + remaining months × projected rate
      const projectedMonthlyRate = Math.max(avgMonthly * budgetShare, 0);
      const forecast =
        utilized + projectedMonthlyRate * monthsRemaining;

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
    amount: number,
    fiscalYear: number,
  ) {
    const budget = await this.db.query.budgets.findFirst({
      where: (b, { and, eq }) => and(
        eq(b.organizationId, organizationId),
        eq(b.budgetType, 'department'),
        eq(b.scopeId, departmentId),
        eq(b.fiscalYear, fiscalYear),
      ),
    });

    if (!budget) return { updated: false, message: 'No budget configured' };

    const today = new Date();

    await this.db.update(budgets)
      .set({
        spentAmount: sql`${budgets.spentAmount} + ${String(amount)}`,
        updatedAt: new Date(),
      })
      .where(and(eq(budgets.id, budget.id), eq(budgets.organizationId, organizationId)));

    // Also update the period that covers today's date
    await this.db.update(budgetPeriods)
      .set({
        spentAmount: sql`${budgetPeriods.spentAmount} + ${String(amount)}`,
      })
      .where(
        and(
          eq(budgetPeriods.budgetId, budget.id),
          sql`${budgetPeriods.periodStart} <= ${today}`,
          sql`${budgetPeriods.periodEnd} >= ${today}`,
        ),
      );

    return { updated: true, budgetId: budget.id };
  }
}
