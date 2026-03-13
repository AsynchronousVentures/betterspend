'use client';

import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.55rem 0.7rem',
  border: `1px solid ${COLORS.inputBorder}`,
  borderRadius: '6px',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
};

const cardStyle: CSSProperties = {
  background: COLORS.cardBg,
  border: `1px solid ${COLORS.tableBorder}`,
  borderRadius: '8px',
  boxShadow: SHADOWS.card,
};

export default function EntitiesPage() {
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    code: '',
    currency: 'USD',
    glAccountPrefix: '',
    taxId: '',
  });

  async function load() {
    setLoading(true);
    try {
      setEntities(await api.entities.list(true));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setEditingId(null);
    setForm({ name: '', code: '', currency: 'USD', glAccountPrefix: '', taxId: '' });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await api.entities.update(editingId, form);
      } else {
        await api.entities.create(form);
      }
      resetForm();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(id: string) {
    try {
      await api.entities.remove(id);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div style={{ padding: '2rem', display: 'grid', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>Entities</h1>
        <p style={{ margin: '0.25rem 0 0', color: COLORS.textSecondary, fontSize: '0.875rem' }}>
          Manage legal entities, subsidiaries, and divisions inside one BetterSpend org.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ ...cardStyle, padding: '1.5rem', display: 'grid', gap: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem' }}>
          <input style={inputStyle} placeholder="Entity name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          <input style={inputStyle} placeholder="Code" value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))} />
          <input style={inputStyle} placeholder="Currency" value={form.currency} onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <input style={inputStyle} placeholder="GL account prefix" value={form.glAccountPrefix} onChange={(e) => setForm((prev) => ({ ...prev, glAccountPrefix: e.target.value }))} />
          <input style={inputStyle} placeholder="Tax ID" value={form.taxId} onChange={(e) => setForm((prev) => ({ ...prev, taxId: e.target.value }))} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {error ? <span style={{ color: COLORS.accentRedDark, fontSize: '0.875rem' }}>{error}</span> : <span />}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                style={{ padding: '0.6rem 1rem', borderRadius: '6px', border: `1px solid ${COLORS.inputBorder}`, background: COLORS.white, color: COLORS.textSecondary, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              style={{ padding: '0.6rem 1rem', borderRadius: '6px', border: 'none', background: COLORS.accentBlue, color: COLORS.white, fontWeight: 600, cursor: 'pointer' }}
            >
              {saving ? 'Saving…' : editingId ? 'Update Entity' : 'Add Entity'}
            </button>
          </div>
        </div>
      </form>

      <div style={cardStyle}>
        {loading ? (
          <div style={{ padding: '2rem', color: COLORS.textMuted }}>Loading…</div>
        ) : entities.length === 0 ? (
          <div style={{ padding: '2rem', color: COLORS.textMuted }}>No entities created yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                {['Name', 'Code', 'Currency', 'GL Prefix', 'Status', ''].map((label) => (
                  <th key={label} style={{ padding: '0.75rem 1rem', textAlign: 'left', color: COLORS.textSecondary, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entities.map((entity, index) => (
                <tr key={entity.id} style={{ borderBottom: index < entities.length - 1 ? `1px solid ${COLORS.contentBg}` : undefined }}>
                  <td style={{ padding: '0.875rem 1rem', fontWeight: 600, color: COLORS.textPrimary }}>{entity.name}</td>
                  <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{entity.code}</td>
                  <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{entity.currency}</td>
                  <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{entity.glAccountPrefix ?? '—'}</td>
                  <td style={{ padding: '0.875rem 1rem', color: entity.isActive ? COLORS.accentGreenDark : COLORS.textMuted }}>
                    {entity.isActive ? 'Active' : 'Archived'}
                  </td>
                  <td style={{ padding: '0.875rem 1rem', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => {
                          setEditingId(entity.id);
                          setForm({
                            name: entity.name ?? '',
                            code: entity.code ?? '',
                            currency: entity.currency ?? 'USD',
                            glAccountPrefix: entity.glAccountPrefix ?? '',
                            taxId: entity.taxId ?? '',
                          });
                        }}
                        style={{ background: 'transparent', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: 'pointer', color: COLORS.textSecondary }}
                      >
                        Edit
                      </button>
                      {entity.isActive && (
                        <button
                          onClick={() => handleArchive(entity.id)}
                          style={{ background: 'transparent', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', padding: '0.4rem 0.8rem', cursor: 'pointer', color: COLORS.textSecondary }}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
