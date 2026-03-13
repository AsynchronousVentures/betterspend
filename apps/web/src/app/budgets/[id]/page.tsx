'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';
import Breadcrumbs from '../../../components/breadcrumbs';

function formatCurrency(amount: string | number | null, currency = 'USD') {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(pct, 100);
  const color = pct > 90 ? COLORS.accentRed : pct > 70 ? COLORS.accentAmber : '#22c55e';
  return (
    <div style={{ width: '100%', background: COLORS.tableBorder, borderRadius: 4, height: 10 }}>
      <div style={{ width: `${clamped}%`, background: color, height: 10, borderRadius: 4, transition: 'width 0.3s' }} />
    </div>
  );
}

export default function BudgetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [budget, setBudget] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', totalAmount: '' });
  const [saving, setSaving] = useState(false);
  const [id, setId] = useState('');
  const [addPeriodOpen, setAddPeriodOpen] = useState(false);
  const [periodForm, setPeriodForm] = useState({ periodStart: '', periodEnd: '', allocatedAmount: '' });
  const [periodSaving, setPeriodSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.budgets.get(pid)
        .then((data) => {
          setBudget(data);
          setEditForm({ name: data.name, totalAmount: String(data.totalAmount) });
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.budgets.update(id, {
        name: editForm.name,
        totalAmount: parseFloat(editForm.totalAmount),
      });
      setBudget(updated);
      setEditing(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPeriod() {
    if (!periodForm.periodStart || !periodForm.periodEnd || !periodForm.allocatedAmount) return;
    setPeriodSaving(true);
    try {
      const updated = await api.budgets.addPeriod(id, {
        periodStart: periodForm.periodStart,
        periodEnd: periodForm.periodEnd,
        allocatedAmount: parseFloat(periodForm.allocatedAmount),
      });
      setBudget(updated);
      setAddPeriodOpen(false);
      setPeriodForm({ periodStart: '', periodEnd: '', allocatedAmount: '' });
    } catch (e: any) { setError(e.message); } finally { setPeriodSaving(false); }
  }

  async function handleRemovePeriod(periodId: string) {
    if (!confirm('Remove this period?')) return;
    try {
      const updated = await api.budgets.removePeriod(id, periodId);
      setBudget(updated);
    } catch (e: any) { setError(e.message); }
  }

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted }}>Loading…</div>;
  if (!budget) return <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.accentRed }}>Budget not found.</div>;

  const total = parseFloat(budget.totalAmount ?? '0');
  const spent = parseFloat(budget.spentAmount ?? '0');
  const remaining = total - spent;
  const pct = total > 0 ? (spent / total) * 100 : 0;

  return (
    <div style={{ padding: '2rem', maxWidth: '800px' }}>
      <Breadcrumbs items={[{ label: 'Budgets', href: '/budgets' }, { label: budget.name }]} />
      {error && (
        <div style={{ marginBottom: '1rem', background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.625rem 1rem', color: COLORS.accentRedDark, fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between' }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.accentRedDark, fontWeight: 700 }}>×</button>
        </div>
      )}
      <Link href="/budgets" style={{ color: COLORS.textSecondary, fontSize: '0.875rem', textDecoration: 'none' }}>
        &larr; Back to Budgets
      </Link>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', margin: '1rem 0 1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>{budget.name}</h1>
          <p style={{ margin: '0.25rem 0 0', color: COLORS.textSecondary, fontSize: '0.875rem' }}>
            {budget.budgetType?.replace('_', ' ')} · FY{budget.fiscalYear} · {budget.currency}
          </p>
        </div>
        <button
          onClick={() => setEditing(!editing)}
          style={{ background: editing ? COLORS.hoverBg : COLORS.textPrimary, color: editing ? COLORS.textSecondary : COLORS.white, border: 'none', padding: '0.5rem 1.25rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {editing && (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: SHADOWS.card }}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Edit Budget</h2>
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr 1fr' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>Name</label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>Total Budget Amount</label>
              <input
                type="number" min="0" step="0.01"
                value={editForm.totalAmount}
                onChange={(e) => setEditForm((f) => ({ ...f, totalAmount: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ marginTop: '1rem', background: COLORS.textPrimary, color: COLORS.white, border: 'none', padding: '0.5rem 1.25rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Budget', value: formatCurrency(total, budget.currency), color: COLORS.textPrimary },
          { label: 'Spent', value: formatCurrency(spent, budget.currency), color: pct > 90 ? COLORS.accentRedDark : COLORS.textSecondary },
          { label: 'Remaining', value: formatCurrency(remaining, budget.currency), color: remaining < 0 ? COLORS.accentRedDark : '#059669' },
        ].map((card) => (
          <div key={card.label} style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>{card.label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Utilization bar */}
      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: SHADOWS.card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: COLORS.textSecondary }}>Budget Utilization</span>
          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: pct > 90 ? COLORS.accentRedDark : COLORS.textPrimary }}>{pct.toFixed(1)}%</span>
        </div>
        <ProgressBar pct={pct} />
      </div>

      {/* Budget periods */}
      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', boxShadow: SHADOWS.card }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: `1px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: COLORS.textPrimary }}>Budget Periods ({budget.periods?.length ?? 0})</h2>
          <button onClick={() => setAddPeriodOpen(!addPeriodOpen)}
            style={{ background: COLORS.textPrimary, color: COLORS.white, border: 'none', padding: '0.375rem 0.875rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer' }}>
            {addPeriodOpen ? 'Cancel' : '+ Add Period'}
          </button>
        </div>

        {addPeriodOpen && (
          <div style={{ padding: '1.25rem', borderBottom: `1px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', alignItems: 'end' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>Period Start</label>
                <input type="date" value={periodForm.periodStart} onChange={(e) => setPeriodForm((f) => ({ ...f, periodStart: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem 0.6rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>Period End</label>
                <input type="date" value={periodForm.periodEnd} onChange={(e) => setPeriodForm((f) => ({ ...f, periodEnd: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem 0.6rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>Allocated Amount</label>
                <input type="number" min="0" step="0.01" value={periodForm.allocatedAmount} onChange={(e) => setPeriodForm((f) => ({ ...f, allocatedAmount: e.target.value }))}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '0.4rem 0.6rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }} />
              </div>
            </div>
            <button onClick={handleAddPeriod} disabled={periodSaving}
              style={{ marginTop: '0.75rem', background: '#059669', color: COLORS.white, border: 'none', padding: '0.4rem 1rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 500, cursor: periodSaving ? 'not-allowed' : 'pointer', opacity: periodSaving ? 0.7 : 1 }}>
              {periodSaving ? 'Adding…' : 'Add Period'}
            </button>
          </div>
        )}

        {budget.periods && budget.periods.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg }}>
                  {['Period Start', 'Period End', 'Allocated', 'Spent', 'Remaining', 'Utilization', ''].map((h) => (
                    <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.8rem' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {budget.periods.map((period: any, idx: number) => {
                  const alloc = parseFloat(period.allocatedAmount ?? period.amount ?? '0');
                  const periodSpent = parseFloat(period.spentAmount ?? '0');
                  const periodPct = alloc > 0 ? (periodSpent / alloc) * 100 : 0;
                  return (
                    <tr key={period.id} style={{ borderBottom: idx < budget.periods.length - 1 ? `1px solid ${COLORS.hoverBg}` : undefined }}>
                      <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{new Date(period.periodStart).toLocaleDateString()}</td>
                      <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{new Date(period.periodEnd).toLocaleDateString()}</td>
                      <td style={{ padding: '0.875rem 1rem', color: COLORS.textPrimary, fontWeight: 600 }}>{formatCurrency(alloc, budget.currency)}</td>
                      <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{formatCurrency(periodSpent, budget.currency)}</td>
                      <td style={{ padding: '0.875rem 1rem', color: alloc - periodSpent < 0 ? COLORS.accentRedDark : '#059669' }}>{formatCurrency(alloc - periodSpent, budget.currency)}</td>
                      <td style={{ padding: '0.875rem 1rem', minWidth: '120px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ flex: 1, background: COLORS.tableBorder, borderRadius: 4, height: 6 }}>
                            <div style={{ width: `${Math.min(periodPct, 100)}%`, background: periodPct > 90 ? COLORS.accentRed : '#22c55e', height: 6, borderRadius: 4 }} />
                          </div>
                          <span style={{ fontSize: '0.75rem', color: COLORS.textSecondary, minWidth: '36px' }}>{periodPct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '0.875rem 1rem' }}>
                        <button onClick={() => handleRemovePeriod(period.id)}
                          style={{ background: 'none', border: '1px solid #fca5a5', color: COLORS.accentRedDark, borderRadius: '4px', padding: '0.2rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer' }}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center', color: COLORS.textMuted, fontSize: '0.875rem' }}>
            No budget periods. Add one above.
          </div>
        )}
      </div>
    </div>
  );
}
