'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { COLORS, SHADOWS, FONT } from '../../lib/theme';

const BUDGET_TYPE_LABELS: Record<string, string> = {
  department: 'Department', project: 'Project', gl_account: 'GL Account',
};

const STATUS_CONFIG = {
  on_track: { label: 'On Track', bg: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
  at_risk: { label: 'At Risk', bg: COLORS.accentAmberLight, color: COLORS.accentAmberDark },
  over_budget: { label: 'Over Budget', bg: COLORS.accentRedLight, color: COLORS.accentRedDark },
} as const;

function formatCurrency(amount: string | number | null, currency = 'USD') {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ProgressBar({ pct, color }: { pct: number; color?: string }) {
  const clamped = Math.min(pct, 100);
  const barColor = color ?? (pct > 90 ? COLORS.accentRed : pct > 75 ? COLORS.accentAmber : COLORS.accentGreen);
  return (
    <div style={{ width: '100%', background: COLORS.tableBorder, borderRadius: 4, height: 8 }}>
      <div style={{ width: `${clamped}%`, background: barColor, height: 8, borderRadius: 4, transition: 'width 0.3s ease' }} />
    </div>
  );
}

function StatusBadge({ status }: { status: 'on_track' | 'at_risk' | 'over_budget' }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.on_track;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: '999px',
      fontSize: FONT.xs,
      fontWeight: 600,
      background: cfg.bg,
      color: cfg.color,
      whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div style={{
      background: COLORS.cardBg,
      border: `1px solid ${COLORS.cardBorder}`,
      borderRadius: 10,
      padding: '1.25rem 1.5rem',
      boxShadow: SHADOWS.card,
      flex: '1 1 160px',
      minWidth: 160,
    }}>
      <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: '0.4rem' }}>{label}</div>
      <div style={{ fontSize: FONT.xl, fontWeight: 700, color: accent ?? COLORS.textPrimary, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: FONT.xs, color: COLORS.textSecondary, marginTop: '0.3rem' }}>{sub}</div>}
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
  const { api } = await import('../../lib/api');
  const res = await api.export.download(type);
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

  async function handleExportCsv() {
    setExporting(true);
    try { await downloadCsv('budgets'); } finally { setExporting(false); }
  }

  useEffect(() => {
    api.budgets.list().then(setBudgets).catch(console.error).finally(() => setLoading(false));
    Promise.all([
      api.budgets.forecast(),
      api.budgets.forecastSummary(),
    ]).then(([fc, sm]) => {
      setForecasts(fc ?? []);
      setSummary(sm ?? null);
    }).catch(console.error).finally(() => setForecastLoading(false));
  }, []);

  const totalUtilizationPct = summary && summary.totalBudgeted > 0
    ? Math.round((summary.totalUtilized / summary.totalBudgeted) * 100)
    : 0;
  const forecastPct = summary && summary.totalBudgeted > 0
    ? Math.round((summary.totalForecast / summary.totalBudgeted) * 100)
    : 0;

  return (
    <div style={{ padding: '2rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>Budgets</h1>
          <p style={{ margin: '0.25rem 0 0', color: COLORS.textSecondary, fontSize: '0.875rem' }}>Track department, project, and GL account budgets</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={handleExportCsv}
            disabled={exporting}
            style={{ padding: '0.5rem 1rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', background: COLORS.cardBg, cursor: exporting ? 'not-allowed' : 'pointer', fontSize: '0.875rem', color: COLORS.textSecondary, fontWeight: 500 }}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <Link href="/budgets/new" style={{ background: COLORS.accentBlue, color: COLORS.white, padding: '0.5rem 1.25rem', borderRadius: '6px', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
            + New Budget
          </Link>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: `1px solid ${COLORS.tableBorder}` }}>
        {(['budgets', 'forecast'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? `2px solid ${COLORS.accentBlue}` : '2px solid transparent',
              padding: '0.6rem 1.1rem',
              fontSize: FONT.base,
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? COLORS.accentBlue : COLORS.textSecondary,
              cursor: 'pointer',
              marginBottom: -1,
              transition: 'color 0.15s',
            }}
          >
            {tab === 'budgets' ? 'Budgets' : 'Forecast'}
            {tab === 'forecast' && summary && (summary.atRiskCount + summary.overBudgetCount) > 0 && (
              <span style={{
                marginLeft: '0.4rem',
                background: summary.overBudgetCount > 0 ? COLORS.accentRed : COLORS.accentAmber,
                color: COLORS.white,
                borderRadius: '999px',
                padding: '1px 7px',
                fontSize: FONT.xs,
                fontWeight: 700,
              }}>
                {summary.atRiskCount + summary.overBudgetCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* BUDGETS TAB                                                          */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === 'budgets' && (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', boxShadow: SHADOWS.card }}>
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted }}>Loading...</div>
          ) : budgets.length === 0 ? (
            <div style={{ padding: '4rem 2rem', textAlign: 'center', color: COLORS.textMuted }}>
              <p style={{ fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.5rem' }}>No budgets yet</p>
              <Link href="/budgets/new" style={{ color: COLORS.accentBlue, textDecoration: 'none', fontSize: '0.875rem' }}>Create your first budget →</Link>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg }}>
                    {['Name', 'Fiscal Year', 'Total Budget', 'Spent', 'Remaining', '% Used', 'Type'].map((col) => (
                      <th key={col} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {budgets.map((budget, idx) => {
                    const total = Number(budget.totalAmount) || 0;
                    const spent = Number(budget.spentAmount) || 0;
                    const remaining = total - spent;
                    const pct = total > 0 ? Math.round((spent / total) * 100) : 0;
                    const currency = budget.currency || 'USD';
                    const isOverBudget = pct > 90;
                    return (
                      <tr key={budget.id} style={{ borderBottom: idx < budgets.length - 1 ? `1px solid ${COLORS.contentBg}` : undefined }}>
                        <td style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>
                          <Link href={`/budgets/${budget.id}`} style={{ color: COLORS.accentBlueDark, textDecoration: 'none' }}>{budget.name}</Link>
                        </td>
                        <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{budget.fiscalYear}</td>
                        <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{formatCurrency(budget.totalAmount, currency)}</td>
                        <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{formatCurrency(budget.spentAmount, currency)}</td>
                        <td style={{ padding: '0.875rem 1rem', fontWeight: 600, color: isOverBudget ? COLORS.accentRedDark : COLORS.textSecondary }}>
                          {formatCurrency(remaining, currency)}
                        </td>
                        <td style={{ padding: '0.875rem 1rem', minWidth: '120px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ flex: 1 }}><ProgressBar pct={pct} /></div>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isOverBudget ? COLORS.accentRedDark : COLORS.textSecondary, minWidth: '2.5rem', textAlign: 'right' }}>
                              {pct}%
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{BUDGET_TYPE_LABELS[budget.budgetType] ?? budget.budgetType}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* FORECAST TAB                                                         */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === 'forecast' && (
        <div>
          {forecastLoading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted }}>Loading forecast...</div>
          ) : (
            <>
              {/* Summary cards */}
              {summary && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.75rem' }}>
                  <SummaryCard
                    label="Total Budgeted"
                    value={formatCurrency(summary.totalBudgeted)}
                    sub={`${new Date().getFullYear()} fiscal year`}
                  />
                  <SummaryCard
                    label="Utilized YTD"
                    value={formatCurrency(summary.totalUtilized)}
                    sub={`${totalUtilizationPct}% of total budget`}
                    accent={totalUtilizationPct > 90 ? COLORS.accentRedDark : COLORS.textPrimary}
                  />
                  <SummaryCard
                    label="Projected Year-End"
                    value={formatCurrency(summary.totalForecast)}
                    sub={`${forecastPct}% of total budget`}
                    accent={forecastPct >= 100 ? COLORS.accentRedDark : forecastPct >= 80 ? COLORS.accentAmberDark : COLORS.textPrimary}
                  />
                  <SummaryCard
                    label="On Track"
                    value={summary.onTrackCount}
                    sub="budgets within target"
                    accent={COLORS.accentGreenDark}
                  />
                  <SummaryCard
                    label="At Risk"
                    value={summary.atRiskCount}
                    sub="80-99% forecast utilization"
                    accent={summary.atRiskCount > 0 ? COLORS.accentAmberDark : COLORS.textPrimary}
                  />
                  <SummaryCard
                    label="Over Budget"
                    value={summary.overBudgetCount}
                    sub="forecast exceeds budget"
                    accent={summary.overBudgetCount > 0 ? COLORS.accentRedDark : COLORS.textPrimary}
                  />
                </div>
              )}

              {/* Per-budget forecast table */}
              {forecasts.length === 0 ? (
                <div style={{ padding: '4rem 2rem', textAlign: 'center', color: COLORS.textMuted, background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: 8 }}>
                  <p style={{ fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.5rem' }}>No budgets to forecast</p>
                  <Link href="/budgets/new" style={{ color: COLORS.accentBlue, textDecoration: 'none', fontSize: '0.875rem' }}>Create your first budget →</Link>
                </div>
              ) : (
                <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', boxShadow: SHADOWS.card }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: FONT.base }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg }}>
                          {['Budget', 'Type', 'Total', 'Utilized', 'Committed', 'Forecast', 'Progress', 'Status', 'Est. Burn Date', 'Variance'].map((col) => (
                            <th key={col} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {forecasts.map((fc, idx) => {
                          const forecastBarPct = fc.totalAmount > 0 ? Math.min((fc.forecast / fc.totalAmount) * 100, 100) : 0;
                          const utilizedBarPct = fc.totalAmount > 0 ? Math.min((fc.utilized / fc.totalAmount) * 100, 100) : 0;
                          const barColor = fc.status === 'over_budget' ? COLORS.accentRed : fc.status === 'at_risk' ? COLORS.accentAmber : COLORS.accentGreen;
                          return (
                            <tr key={fc.id} style={{ borderBottom: idx < forecasts.length - 1 ? `1px solid ${COLORS.contentBg}` : undefined }}>
                              <td style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>
                                <Link href={`/budgets/${fc.id}`} style={{ color: COLORS.accentBlueDark, textDecoration: 'none' }}>{fc.name}</Link>
                              </td>
                              <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>
                                {BUDGET_TYPE_LABELS[fc.budgetType] ?? fc.budgetType}
                              </td>
                              <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>
                                {formatCurrency(fc.totalAmount, fc.currency)}
                              </td>
                              <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>
                                {formatCurrency(fc.utilized, fc.currency)}
                              </td>
                              <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>
                                {formatCurrency(fc.committed, fc.currency)}
                              </td>
                              <td style={{ padding: '0.875rem 1rem', fontWeight: 600, color: fc.status === 'over_budget' ? COLORS.accentRedDark : COLORS.textPrimary, whiteSpace: 'nowrap' }}>
                                {formatCurrency(fc.forecast, fc.currency)}
                              </td>
                              <td style={{ padding: '0.875rem 1rem', minWidth: '160px' }}>
                                {/* Stacked bar: utilized (solid) + forecast overhang (lighter) */}
                                <div style={{ position: 'relative', width: '100%', background: COLORS.tableBorder, borderRadius: 4, height: 10 }}>
                                  {/* Forecast bar (background) */}
                                  <div style={{
                                    position: 'absolute', top: 0, left: 0,
                                    width: `${forecastBarPct}%`,
                                    background: barColor + '40',
                                    height: 10, borderRadius: 4,
                                  }} />
                                  {/* Utilized bar (foreground) */}
                                  <div style={{
                                    position: 'absolute', top: 0, left: 0,
                                    width: `${utilizedBarPct}%`,
                                    background: barColor,
                                    height: 10, borderRadius: 4,
                                  }} />
                                </div>
                                <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, marginTop: '0.25rem' }}>
                                  {fc.percentUsed}% used · {Math.round(forecastBarPct)}% forecast
                                </div>
                              </td>
                              <td style={{ padding: '0.875rem 1rem' }}>
                                <StatusBadge status={fc.status} />
                              </td>
                              <td style={{ padding: '0.875rem 1rem', color: fc.forecastBurnDate ? COLORS.accentAmberDark : COLORS.textMuted, fontSize: FONT.sm, whiteSpace: 'nowrap' }}>
                                {fc.forecastBurnDate ? formatDate(fc.forecastBurnDate) : '—'}
                              </td>
                              <td style={{ padding: '0.875rem 1rem', fontWeight: 600, whiteSpace: 'nowrap', color: fc.variance < 0 ? COLORS.accentRedDark : COLORS.accentGreenDark }}>
                                {fc.variance < 0 ? '-' : '+'}{formatCurrency(Math.abs(fc.variance), fc.currency)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: '0.75rem 1rem', borderTop: `1px solid ${COLORS.tableBorder}`, fontSize: FONT.xs, color: COLORS.textMuted }}>
                    Forecast uses linear regression on the last 6 months of purchase order spend, projected to fiscal year end.
                    Burn date is estimated based on current monthly spend rate.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
