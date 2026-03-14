'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, FolderKanban, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

const BUDGET_TYPE_LABELS: Record<string, string> = {
  department: 'Department',
  project: 'Project',
  gl_account: 'GL Account',
};

function formatCurrency(amount: string | number | null, currency = 'USD') {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ProgressBar({ pct, tone }: { pct: number; tone?: 'success' | 'warning' | 'destructive' }) {
  const clamped = Math.min(pct, 100);
  const colorClass =
    tone === 'destructive' ? 'bg-rose-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full ${colorClass}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

type ForecastEntry = {
  id: string;
  name: string;
  budgetType: string;
  fiscalYear: number;
  totalAmount: number;
  utilized: number;
  committed: number;
  forecast: number;
  percentUsed: number;
  forecastBurnDate: string | null;
  variance: number;
  status: 'on_track' | 'at_risk' | 'over_budget';
  currency: string;
};

type ForecastSummary = {
  totalBudgeted: number;
  totalUtilized: number;
  totalForecast: number;
  onTrackCount: number;
  atRiskCount: number;
  overBudgetCount: number;
  topAtRiskBudgets: ForecastEntry[];
};

async function downloadCsv(type: string) {
  const { api: exportApi } = await import('../../lib/api');
  const res = await exportApi.export.download(type);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `export-${type}-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<any[]>([]);
  const [forecasts, setForecasts] = useState<ForecastEntry[]>([]);
  const [summary, setSummary] = useState<ForecastSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'budgets' | 'forecast'>('budgets');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.budgets.list().then(setBudgets).catch(console.error).finally(() => setLoading(false));
    Promise.all([api.budgets.forecast(), api.budgets.forecastSummary()])
      .then(([forecastRows, summaryRow]) => {
        setForecasts(forecastRows ?? []);
        setSummary(summaryRow ?? null);
      })
      .catch(console.error)
      .finally(() => setForecastLoading(false));
  }, []);

  async function handleExportCsv() {
    setExporting(true);
    try {
      await downloadCsv('budgets');
    } finally {
      setExporting(false);
    }
  }

  const totalUtilizationPct =
    summary && summary.totalBudgeted > 0 ? Math.round((summary.totalUtilized / summary.totalBudgeted) * 100) : 0;
  const forecastPct =
    summary && summary.totalBudgeted > 0 ? Math.round((summary.totalForecast / summary.totalBudgeted) * 100) : 0;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Budgets"
        description="Track department, project, and GL budgets against current utilization and forecasted burn."
        actions={
          <>
            <Button variant="outline" onClick={handleExportCsv} disabled={exporting}>
              <Download className="h-4 w-4" />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </Button>
            <Button asChild>
              <Link href="/budgets/new">
                <Plus className="h-4 w-4" />
                New Budget
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Button variant={activeTab === 'budgets' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('budgets')}>
          Budgets
        </Button>
        <Button variant={activeTab === 'forecast' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('forecast')}>
          Forecast
          {summary && summary.atRiskCount + summary.overBudgetCount > 0 ? (
            <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">
              {summary.atRiskCount + summary.overBudgetCount}
            </span>
          ) : null}
        </Button>
      </div>

      {activeTab === 'budgets' ? (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
                Loading budgets...
              </div>
            ) : budgets.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="rounded-full bg-muted p-4">
                  <FolderKanban className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-base font-semibold text-foreground">No budgets yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">Create your first budget to start tracking spend against plan.</p>
                </div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Fiscal Year</TableHead>
                    <TableHead>Total Budget</TableHead>
                    <TableHead>Spent</TableHead>
                    <TableHead>Remaining</TableHead>
                    <TableHead>% Used</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {budgets.map((budget) => {
                    const total = Number(budget.totalAmount) || 0;
                    const spent = Number(budget.spentAmount) || 0;
                    const remaining = total - spent;
                    const pct = total > 0 ? Math.round((spent / total) * 100) : 0;
                    const currency = budget.currency || 'USD';
                    const tone = pct > 90 ? 'destructive' : pct > 75 ? 'warning' : 'success';
                    return (
                      <TableRow key={budget.id}>
                        <TableCell className="font-semibold">
                          <Link href={`/budgets/${budget.id}`} className="text-primary hover:underline">
                            {budget.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{budget.fiscalYear}</TableCell>
                        <TableCell className="text-muted-foreground">{formatCurrency(budget.totalAmount, currency)}</TableCell>
                        <TableCell className="text-muted-foreground">{formatCurrency(budget.spentAmount, currency)}</TableCell>
                        <TableCell className={pct > 90 ? 'font-medium text-rose-700' : 'font-medium text-foreground'}>
                          {formatCurrency(remaining, currency)}
                        </TableCell>
                        <TableCell className="min-w-[150px]">
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <ProgressBar pct={pct} tone={tone} />
                            </div>
                            <span className={pct > 90 ? 'text-xs font-semibold text-rose-700' : 'text-xs font-semibold text-muted-foreground'}>
                              {pct}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {BUDGET_TYPE_LABELS[budget.budgetType] ?? budget.budgetType}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {forecastLoading ? (
            <Card>
              <CardContent className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
                Loading forecast...
              </CardContent>
            </Card>
          ) : (
            <>
              {summary ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <Card><CardContent className="space-y-2 p-5"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Total Budgeted</div><div className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{formatCurrency(summary.totalBudgeted)}</div><div className="text-sm text-muted-foreground">{new Date().getFullYear()} fiscal year</div></CardContent></Card>
                  <Card><CardContent className="space-y-2 p-5"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Utilized YTD</div><div className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{formatCurrency(summary.totalUtilized)}</div><div className="text-sm text-muted-foreground">{totalUtilizationPct}% of total budget</div></CardContent></Card>
                  <Card><CardContent className="space-y-2 p-5"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Projected Year-End</div><div className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{formatCurrency(summary.totalForecast)}</div><div className="text-sm text-muted-foreground">{forecastPct}% of total budget</div></CardContent></Card>
                  <Card><CardContent className="space-y-2 p-5"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">On Track</div><div className="text-3xl font-semibold tracking-[-0.04em] text-emerald-700">{summary.onTrackCount}</div><div className="text-sm text-muted-foreground">Budgets within target</div></CardContent></Card>
                  <Card><CardContent className="space-y-2 p-5"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">At Risk</div><div className="text-3xl font-semibold tracking-[-0.04em] text-amber-700">{summary.atRiskCount}</div><div className="text-sm text-muted-foreground">80-99% forecast utilization</div></CardContent></Card>
                  <Card><CardContent className="space-y-2 p-5"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Over Budget</div><div className="text-3xl font-semibold tracking-[-0.04em] text-rose-700">{summary.overBudgetCount}</div><div className="text-sm text-muted-foreground">Forecast exceeds budget</div></CardContent></Card>
                </div>
              ) : null}

              {forecasts.length === 0 ? (
                <Card>
                  <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
                    <div className="rounded-full bg-muted p-4">
                      <FolderKanban className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-foreground">No budgets to forecast</p>
                      <p className="mt-1 text-sm text-muted-foreground">Create your first budget to start building burn projections.</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Budget</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Utilized</TableHead>
                          <TableHead>Committed</TableHead>
                          <TableHead>Forecast</TableHead>
                          <TableHead>Progress</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Est. Burn Date</TableHead>
                          <TableHead>Variance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {forecasts.map((forecast) => {
                          const forecastBarPct = forecast.totalAmount > 0 ? Math.min((forecast.forecast / forecast.totalAmount) * 100, 100) : 0;
                          const utilizedBarPct = forecast.totalAmount > 0 ? Math.min((forecast.utilized / forecast.totalAmount) * 100, 100) : 0;
                          const tone =
                            forecast.status === 'over_budget' ? 'destructive' : forecast.status === 'at_risk' ? 'warning' : 'success';
                          return (
                            <TableRow key={forecast.id}>
                              <TableCell className="font-semibold">
                                <Link href={`/budgets/${forecast.id}`} className="text-primary hover:underline">
                                  {forecast.name}
                                </Link>
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {BUDGET_TYPE_LABELS[forecast.budgetType] ?? forecast.budgetType}
                              </TableCell>
                              <TableCell className="text-muted-foreground">{formatCurrency(forecast.totalAmount, forecast.currency)}</TableCell>
                              <TableCell className="text-muted-foreground">{formatCurrency(forecast.utilized, forecast.currency)}</TableCell>
                              <TableCell className="text-muted-foreground">{formatCurrency(forecast.committed, forecast.currency)}</TableCell>
                              <TableCell className={forecast.status === 'over_budget' ? 'font-medium text-rose-700' : 'font-medium text-foreground'}>
                                {formatCurrency(forecast.forecast, forecast.currency)}
                              </TableCell>
                              <TableCell className="min-w-[180px]">
                                <div className="space-y-2">
                                  <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                                    <div className={`absolute inset-y-0 left-0 rounded-full ${tone === 'destructive' ? 'bg-rose-300' : tone === 'warning' ? 'bg-amber-300' : 'bg-emerald-300'}`} style={{ width: `${forecastBarPct}%` }} />
                                    <div className={`absolute inset-y-0 left-0 rounded-full ${tone === 'destructive' ? 'bg-rose-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${utilizedBarPct}%` }} />
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {forecast.percentUsed}% used · {Math.round(forecastBarPct)}% forecast
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <StatusBadge value={forecast.status} label={forecast.status === 'on_track' ? 'On Track' : forecast.status === 'at_risk' ? 'At Risk' : 'Over Budget'} />
                              </TableCell>
                              <TableCell className={forecast.forecastBurnDate ? 'text-amber-700' : 'text-muted-foreground'}>
                                {forecast.forecastBurnDate ? formatDate(forecast.forecastBurnDate) : '—'}
                              </TableCell>
                              <TableCell className={forecast.variance < 0 ? 'font-medium text-rose-700' : 'font-medium text-emerald-700'}>
                                {forecast.variance < 0 ? '-' : '+'}
                                {formatCurrency(Math.abs(forecast.variance), forecast.currency)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <div className="border-t border-border/70 px-4 py-3 text-xs text-muted-foreground">
                      Forecast uses linear regression on the last 6 months of purchase order spend, projected to fiscal year end. Burn date is estimated from the current monthly spend rate.
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
