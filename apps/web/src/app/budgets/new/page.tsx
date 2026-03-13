'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';

const CURRENT_YEAR = new Date().getFullYear();

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`,
  borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box', background: COLORS.white, color: COLORS.textPrimary,
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.8rem', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '0.375rem',
};

export default function NewBudgetPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [form, setForm] = useState({
    name: '', fiscalYear: String(CURRENT_YEAR), totalAmount: '', currency: 'USD',
    exchangeRate: '1', budgetType: 'department', departmentId: '', projectId: '', glAccount: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.departments.list(), api.projects.list(), api.exchangeRates.getBaseCurrency()])
      .then(([d, p, org]) => {
        setDepartments(d);
        setProjects(p);
        const currency = org?.baseCurrency || 'USD';
        setBaseCurrency(currency);
        setForm((current) => ({ ...current, currency }));
      })
      .catch(() => {});
  }, []);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const parsedYear = parseInt(form.fiscalYear, 10);
    const parsedAmount = parseFloat(form.totalAmount);
    if (isNaN(parsedAmount) || parsedAmount < 0) { setError('Invalid amount'); return; }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        fiscalYear: parsedYear,
        totalAmount: parsedAmount,
        currency: form.currency.trim().toUpperCase() || 'USD',
        exchangeRate: parseFloat(form.exchangeRate || '1') || 1,
      };
      if (form.budgetType === 'department' && form.departmentId) payload.departmentId = form.departmentId;
      else if (form.budgetType === 'project' && form.projectId) payload.projectId = form.projectId;
      else if (form.budgetType === 'gl_account' && form.glAccount) payload.glAccount = form.glAccount;

      await api.budgets.create(payload);
      router.push('/budgets');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '640px' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/budgets" style={{ color: COLORS.textSecondary, fontSize: '0.875rem', textDecoration: 'none' }}>← Back to Budgets</Link>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.5rem 0 0', color: COLORS.textPrimary }}>New Budget</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginBottom: '1.25rem', boxShadow: SHADOWS.card }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 1.25rem', color: COLORS.textPrimary }}>Budget Details</h2>
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Name *</label>
              <input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Engineering FY2026" style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Fiscal Year *</label>
                <input required type="number" value={form.fiscalYear} onChange={(e) => set('fiscalYear', e.target.value)} min={2000} max={2100} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Total Amount *</label>
                <input required type="number" value={form.totalAmount} onChange={(e) => set('totalAmount', e.target.value)} min={0} step="any" placeholder="0.00" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Currency</label>
                <input value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} maxLength={3} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Exchange Rate to {baseCurrency}</label>
                <input value={form.exchangeRate} onChange={(e) => set('exchangeRate', e.target.value)} type="number" min="0" step="0.000001" style={inputStyle} />
              </div>
            </div>
            <div style={{ fontSize: '0.8rem', color: COLORS.textMuted }}>
              Budget base currency is {baseCurrency}. Use `1` when the budget is already denominated in {baseCurrency}.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Budget Type *</label>
                <select value={form.budgetType} onChange={(e) => set('budgetType', e.target.value)} style={inputStyle}>
                  <option value="department">Department</option>
                  <option value="project">Project</option>
                  <option value="gl_account">GL Account</option>
                </select>
              </div>
            </div>

            {form.budgetType === 'department' && (
              <div>
                <label style={labelStyle}>Department</label>
                <select value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)} style={inputStyle}>
                  <option value="">Select department...</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
                </select>
              </div>
            )}
            {form.budgetType === 'project' && (
              <div>
                <label style={labelStyle}>Project</label>
                <select value={form.projectId} onChange={(e) => set('projectId', e.target.value)} style={inputStyle}>
                  <option value="">Select project...</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                </select>
              </div>
            )}
            {form.budgetType === 'gl_account' && (
              <div>
                <label style={labelStyle}>GL Account Code</label>
                <input value={form.glAccount} onChange={(e) => set('glAccount', e.target.value)} placeholder="e.g. 6000" style={inputStyle} />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{ background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.75rem 1rem', color: COLORS.accentRedDark, fontSize: '0.875rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="submit" disabled={submitting} style={{ background: COLORS.accentBlue, color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.625rem 1.5rem', fontSize: '0.875rem', fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Saving...' : 'Create Budget'}
          </button>
          <Link href="/budgets" style={{ background: COLORS.white, color: COLORS.textSecondary, border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none', display: 'inline-block' }}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
