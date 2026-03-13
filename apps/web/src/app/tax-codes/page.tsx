'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

interface TaxCode {
  id: string;
  name: string;
  code: string;
  ratePercent: string;
  taxType: 'VAT' | 'GST' | 'SALES_TAX' | 'EXEMPT';
  isRecoverable: boolean;
  glAccountCode?: string | null;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: `1px solid ${COLORS.inputBorder}`,
  borderRadius: '6px',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
  background: COLORS.white,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: COLORS.textSecondary,
  marginBottom: '0.375rem',
};

const defaultForm = {
  name: '',
  code: '',
  ratePercent: '0',
  taxType: 'VAT' as TaxCode['taxType'],
  isRecoverable: true,
  glAccountCode: '',
};

export default function TaxCodesPage() {
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [form, setForm] = useState(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const records = await api.taxCodes.list();
    setTaxCodes(Array.isArray(records) ? records : []);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const title = useMemo(() => (editingId ? 'Edit Tax Code' : 'Create Tax Code'), [editingId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        name: form.name,
        code: form.code.toUpperCase(),
        ratePercent: parseFloat(form.ratePercent || '0'),
        taxType: form.taxType,
        isRecoverable: form.isRecoverable,
        glAccountCode: form.glAccountCode || undefined,
      };

      if (editingId) {
        await api.taxCodes.update(editingId, payload);
        setMessage('Tax code updated.');
      } else {
        await api.taxCodes.create(payload);
        setMessage('Tax code created.');
      }

      setForm(defaultForm);
      setEditingId(null);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to save tax code');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setError('');
    setMessage('');
    try {
      await api.taxCodes.remove(id);
      if (editingId === id) {
        setEditingId(null);
        setForm(defaultForm);
      }
      setMessage('Tax code removed.');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to delete tax code');
    }
  }

  return (
    <div style={{ padding: '2rem', display: 'grid', gap: '1.5rem', gridTemplateColumns: 'minmax(320px, 420px) 1fr' }}>
      <section style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: '10px', padding: '1.5rem', boxShadow: SHADOWS.card, height: 'fit-content' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>Tax Codes</h1>
        <p style={{ marginTop: '0.5rem', color: COLORS.textSecondary, fontSize: '0.875rem' }}>
          Define recoverable and non-recoverable tax rates for purchase orders and invoices.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem', marginTop: '1.25rem' }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} required />
          </div>
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <label style={labelStyle}>Code</label>
              <input style={inputStyle} value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))} required />
            </div>
            <div>
              <label style={labelStyle}>Rate %</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.ratePercent} onChange={(e) => setForm((prev) => ({ ...prev, ratePercent: e.target.value }))} required />
            </div>
          </div>
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <label style={labelStyle}>Tax Type</label>
              <select style={inputStyle} value={form.taxType} onChange={(e) => setForm((prev) => ({ ...prev, taxType: e.target.value as TaxCode['taxType'] }))}>
                <option value="VAT">VAT</option>
                <option value="GST">GST</option>
                <option value="SALES_TAX">Sales Tax</option>
                <option value="EXEMPT">Exempt</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>GL Account</label>
              <input style={inputStyle} value={form.glAccountCode} onChange={(e) => setForm((prev) => ({ ...prev, glAccountCode: e.target.value }))} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: COLORS.textPrimary }}>
            <input type="checkbox" checked={form.isRecoverable} onChange={(e) => setForm((prev) => ({ ...prev, isRecoverable: e.target.checked }))} />
            Recoverable for budget consumption
          </label>
          {error ? <div style={{ color: COLORS.accentRedDark, fontSize: '0.875rem' }}>{error}</div> : null}
          {message ? <div style={{ color: COLORS.accentGreenDark, fontSize: '0.875rem' }}>{message}</div> : null}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="submit" disabled={saving} style={{ background: COLORS.accentBlue, color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.7rem 1rem', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Saving...' : title}
            </button>
            {editingId ? (
              <button type="button" onClick={() => { setEditingId(null); setForm(defaultForm); }} style={{ background: 'transparent', color: COLORS.textSecondary, border: `1px solid ${COLORS.border}`, borderRadius: '6px', padding: '0.7rem 1rem', cursor: 'pointer' }}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: '10px', boxShadow: SHADOWS.card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: COLORS.tableHeaderBg }}>
            <tr>
              {['Code', 'Name', 'Rate', 'Type', 'Budget Impact', 'GL', ''].map((header) => (
                <th key={header} style={{ textAlign: 'left', padding: '0.875rem 1rem', color: COLORS.textSecondary, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.04em' }}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {taxCodes.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '1.5rem 1rem', color: COLORS.textSecondary }}>No tax codes yet.</td>
              </tr>
            ) : taxCodes.map((taxCode) => (
              <tr key={taxCode.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                <td style={{ padding: '0.875rem 1rem', fontWeight: 700, color: COLORS.textPrimary }}>{taxCode.code}</td>
                <td style={{ padding: '0.875rem 1rem', color: COLORS.textPrimary }}>{taxCode.name}</td>
                <td style={{ padding: '0.875rem 1rem', color: COLORS.textPrimary }}>{taxCode.ratePercent}%</td>
                <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{taxCode.taxType}</td>
                <td style={{ padding: '0.875rem 1rem', color: taxCode.isRecoverable ? COLORS.accentGreenDark : COLORS.accentAmberDark }}>
                  {taxCode.isRecoverable ? 'Net only' : 'Gross incl. tax'}
                </td>
                <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{taxCode.glAccountCode || '—'}</td>
                <td style={{ padding: '0.875rem 1rem', textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(taxCode.id);
                      setForm({
                        name: taxCode.name,
                        code: taxCode.code,
                        ratePercent: String(taxCode.ratePercent),
                        taxType: taxCode.taxType,
                        isRecoverable: taxCode.isRecoverable,
                        glAccountCode: taxCode.glAccountCode || '',
                      });
                    }}
                    style={{ background: 'transparent', border: 'none', color: COLORS.accentBlueDark, cursor: 'pointer', marginRight: '0.75rem' }}
                  >
                    Edit
                  </button>
                  <button type="button" onClick={() => handleDelete(taxCode.id)} style={{ background: 'transparent', border: 'none', color: COLORS.accentRedDark, cursor: 'pointer' }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
