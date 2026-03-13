'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';
import Breadcrumbs from '../../../components/breadcrumbs';

const STATUS_STYLES: Record<string, { background: string; color: string }> = {
  ok:            { background: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
  low_stock:     { background: COLORS.accentAmberLight, color: COLORS.accentAmberDark },
  out_of_stock:  { background: COLORS.accentRedLight, color: COLORS.accentRedDark },
};

const STATUS_LABELS: Record<string, string> = {
  ok:            'OK',
  low_stock:     'Low Stock',
  out_of_stock:  'Out of Stock',
};

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  receipt:    'Receipt',
  issue:      'Issue',
  adjustment: 'Adjustment',
  return:     'Return',
};

function fmtQty(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: `1px solid ${COLORS.inputBorder}`,
  borderRadius: '6px',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.875rem',
  fontWeight: 500,
  color: COLORS.textSecondary,
  marginBottom: '0.25rem',
};

const thStyle: React.CSSProperties = {
  padding: '0.625rem 1rem',
  textAlign: 'left',
  fontWeight: 600,
  color: COLORS.textSecondary,
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
};

export default function InventoryItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});

  // Adjust modal
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState('');

  useEffect(() => {
    api.inventory.get(id)
      .then((data) => {
        setItem(data);
        setForm({
          name: data.name ?? '',
          description: data.description ?? '',
          unit: data.unit ?? 'each',
          reorderPoint: data.reorderPoint != null ? String(data.reorderPoint) : '',
          reorderQuantity: data.reorderQuantity != null ? String(data.reorderQuantity) : '',
          location: data.location ?? '',
        });
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  function set(key: string, value: string) {
    setForm((f: any) => ({ ...f, [key]: value }));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await api.inventory.update(id, {
        name: form.name,
        description: form.description || undefined,
        unit: form.unit || 'each',
        reorderPoint: form.reorderPoint !== '' ? Number(form.reorderPoint) : null,
        reorderQuantity: form.reorderQuantity !== '' ? Number(form.reorderQuantity) : null,
        location: form.location || null,
      });
      setItem((prev: any) => ({ ...prev, ...updated }));
      setEditing(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAdjust(e: FormEvent) {
    e.preventDefault();
    if (!adjustQty || isNaN(Number(adjustQty))) {
      setAdjustError('Please enter a valid quantity (positive to add, negative to remove).');
      return;
    }
    setAdjusting(true);
    setAdjustError('');
    try {
      const updated = await api.inventory.adjust(id, { quantity: Number(adjustQty), notes: adjustNotes || undefined });
      setItem((prev: any) => ({ ...prev, ...updated, movements: prev.movements }));
      // Reload to get updated movements
      const fresh = await api.inventory.get(id);
      setItem(fresh);
      setShowAdjust(false);
      setAdjustQty('');
      setAdjustNotes('');
    } catch (e: any) {
      setAdjustError(e.message);
    } finally {
      setAdjusting(false);
    }
  }

  if (loading) {
    return <div style={{ padding: '2rem', color: COLORS.textMuted }}>Loading...</div>;
  }
  if (!item && error) {
    return (
      <div style={{ padding: '2rem' }}>
        <Link href="/inventory" style={{ color: COLORS.accentBlue, textDecoration: 'none', fontSize: '0.875rem' }}>&larr; Back to Inventory</Link>
        <div style={{ marginTop: '1rem', color: COLORS.accentRedDark }}>{error}</div>
      </div>
    );
  }
  if (!item) return null;

  const ss = STATUS_STYLES[item.stockStatus] ?? STATUS_STYLES.ok;
  const movements: any[] = item.movements ?? [];

  return (
    <div style={{ padding: '2rem', maxWidth: '960px' }}>
      <Breadcrumbs items={[{ label: 'Inventory', href: '/inventory' }, { label: item.name }]} />
      {/* Breadcrumb */}
      <div style={{ marginBottom: '1.25rem' }}>
        <Link href="/inventory" style={{ fontSize: '0.875rem', color: COLORS.accentBlue, textDecoration: 'none' }}>
          &larr; Back to Inventory
        </Link>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>{item.name}</h1>
            <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem', background: COLORS.accentBlueLight, color: COLORS.accentBlueDark, padding: '0.2rem 0.6rem', borderRadius: '4px', fontWeight: 600 }}>{item.sku}</span>
            <span style={{ ...ss, padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
              {STATUS_LABELS[item.stockStatus] ?? item.stockStatus}
            </span>
          </div>
          {item.description && <p style={{ margin: '0.5rem 0 0', color: COLORS.textSecondary, fontSize: '0.875rem' }}>{item.description}</p>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => { setShowAdjust(true); setAdjustError(''); }}
            style={{ padding: '0.5rem 1rem', background: COLORS.accentAmberLight, color: COLORS.accentAmberDark, border: `1px solid ${COLORS.accentAmber}`, borderRadius: '6px', fontWeight: 500, fontSize: '0.875rem', cursor: 'pointer' }}
          >
            Adjust Stock
          </button>
          <button
            onClick={() => setEditing(!editing)}
            style={{ padding: '0.5rem 1rem', background: editing ? COLORS.hoverBg : COLORS.accentBlue, color: editing ? COLORS.textSecondary : COLORS.white, border: `1px solid ${editing ? COLORS.border : COLORS.accentBlue}`, borderRadius: '6px', fontWeight: 500, fontSize: '0.875rem', cursor: 'pointer' }}
          >
            {editing ? 'Cancel Edit' : 'Edit'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: COLORS.accentRedLight, border: `1px solid #fecaca`, borderRadius: '6px', padding: '0.75rem 1rem', color: COLORS.accentRedDark, fontSize: '0.875rem', marginBottom: '1rem' }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.accentRedDark, fontWeight: 700, marginLeft: '0.5rem' }}>x</button>
        </div>
      )}

      {/* Stock summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'On Hand', value: fmtQty(item.quantityOnHand), unit: item.unit },
          { label: 'Reserved', value: fmtQty(item.quantityReserved), unit: item.unit },
          { label: 'Available', value: fmtQty(item.quantityAvailable), unit: item.unit },
          { label: 'Reorder Point', value: item.reorderPoint != null ? fmtQty(item.reorderPoint) : '—', unit: item.reorderPoint != null ? item.unit : '' },
          { label: 'Reorder Quantity', value: item.reorderQuantity != null ? fmtQty(item.reorderQuantity) : '—', unit: item.reorderQuantity != null ? item.unit : '' },
        ].map((card) => (
          <div key={card.label} style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', padding: '1rem', boxShadow: SHADOWS.card }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.375rem' }}>{card.label}</div>
            <div style={{ fontSize: '1.375rem', fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1 }}>{card.value}</div>
            {card.unit && <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginTop: '0.25rem' }}>{card.unit}</div>}
          </div>
        ))}
      </div>

      {/* Edit form */}
      {editing && (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', padding: '1.5rem', boxShadow: SHADOWS.card, marginBottom: '1.5rem' }}>
          <h2 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600, color: COLORS.textPrimary }}>Edit Item</h2>
          <form onSubmit={handleSave}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Name *</label>
              <input style={inputStyle} value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Description</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '72px' }} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={labelStyle}>Unit</label>
                <input style={inputStyle} value={form.unit} onChange={(e) => set('unit', e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Location</label>
                <input style={inputStyle} value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Warehouse, shelf..." />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={labelStyle}>Reorder Point</label>
                <input style={inputStyle} type="number" min="0" step="0.01" value={form.reorderPoint} onChange={(e) => set('reorderPoint', e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Reorder Quantity</label>
                <input style={inputStyle} type="number" min="0" step="0.01" value={form.reorderQuantity} onChange={(e) => set('reorderQuantity', e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="submit" disabled={saving} style={{ padding: '0.5rem 1.25rem', background: COLORS.accentBlue, color: COLORS.white, border: 'none', borderRadius: '6px', fontWeight: 500, fontSize: '0.875rem', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button type="button" onClick={() => setEditing(false)} style={{ padding: '0.5rem 1rem', border: `1px solid ${COLORS.border}`, borderRadius: '6px', background: 'transparent', color: COLORS.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Movement history */}
      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', boxShadow: SHADOWS.card }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: `1px solid ${COLORS.cardBorder}` }}>
          <h2 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: COLORS.textPrimary }}>Movement History</h2>
        </div>
        {movements.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: COLORS.textMuted, fontSize: '0.875rem' }}>
            No movements recorded yet. Use "Adjust Stock" to record a manual adjustment.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg }}>
                  <th style={thStyle}>Type</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Quantity</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Before</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>After</th>
                  <th style={thStyle}>Reference</th>
                  <th style={thStyle}>Notes</th>
                  <th style={thStyle}>Date</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((mv: any, idx: number) => {
                  const qty = parseFloat(mv.quantity);
                  const isPositive = qty >= 0;
                  return (
                    <tr
                      key={mv.id}
                      style={{ borderBottom: idx < movements.length - 1 ? `1px solid ${COLORS.contentBg}` : undefined }}
                    >
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{
                          background: mv.movementType === 'receipt' ? COLORS.accentGreenLight
                            : mv.movementType === 'adjustment' ? COLORS.accentBlueLight
                            : mv.movementType === 'issue' ? COLORS.accentRedLight
                            : COLORS.accentAmberLight,
                          color: mv.movementType === 'receipt' ? COLORS.accentGreenDark
                            : mv.movementType === 'adjustment' ? COLORS.accentBlueDark
                            : mv.movementType === 'issue' ? COLORS.accentRedDark
                            : COLORS.accentAmberDark,
                          padding: '0.2rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600,
                        }}>
                          {MOVEMENT_TYPE_LABELS[mv.movementType] ?? mv.movementType}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: isPositive ? COLORS.accentGreenDark : COLORS.accentRedDark }}>
                        {isPositive ? '+' : ''}{fmtQty(qty)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: COLORS.textSecondary }}>
                        {fmtQty(parseFloat(mv.quantityBefore))}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: COLORS.textPrimary }}>
                        {fmtQty(parseFloat(mv.quantityAfter))}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textMuted, fontSize: '0.8rem' }}>
                        {mv.referenceType ? (
                          <span style={{ textTransform: 'capitalize' }}>{mv.referenceType.replace(/_/g, ' ')}</span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary, maxWidth: '200px' }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {mv.notes ?? '—'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textMuted, whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                        {fmtDate(mv.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Adjust modal overlay */}
      {showAdjust && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAdjust(false); }}
        >
          <div style={{ background: COLORS.cardBg, borderRadius: '10px', padding: '1.5rem', width: '100%', maxWidth: '420px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.0625rem', fontWeight: 700, color: COLORS.textPrimary }}>Adjust Stock</h2>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: COLORS.textSecondary }}>
              Current: <strong>{fmtQty(item.quantityOnHand)}</strong> {item.unit}. Enter a positive number to add stock, negative to remove.
            </p>
            {adjustError && (
              <div style={{ background: COLORS.accentRedLight, border: `1px solid #fecaca`, borderRadius: '6px', padding: '0.625rem 0.875rem', color: COLORS.accentRedDark, fontSize: '0.875rem', marginBottom: '1rem' }}>
                {adjustError}
              </div>
            )}
            <form onSubmit={handleAdjust}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>Quantity Change *</label>
                <input
                  style={inputStyle}
                  type="number"
                  step="0.0001"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  placeholder="e.g. 50 or -10"
                  autoFocus
                  required
                />
                {adjustQty !== '' && !isNaN(Number(adjustQty)) && (
                  <div style={{ fontSize: '0.8rem', color: COLORS.textMuted, marginTop: '0.375rem' }}>
                    New quantity: <strong>{fmtQty(item.quantityOnHand + Number(adjustQty))}</strong> {item.unit}
                  </div>
                )}
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={labelStyle}>Notes</label>
                <input
                  style={inputStyle}
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  placeholder="Reason for adjustment (optional)"
                />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="submit"
                  disabled={adjusting}
                  style={{ flex: 1, padding: '0.5rem 1rem', background: COLORS.accentBlue, color: COLORS.white, border: 'none', borderRadius: '6px', fontWeight: 500, fontSize: '0.875rem', cursor: adjusting ? 'not-allowed' : 'pointer', opacity: adjusting ? 0.7 : 1 }}
                >
                  {adjusting ? 'Saving...' : 'Apply Adjustment'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdjust(false)}
                  style={{ padding: '0.5rem 1rem', border: `1px solid ${COLORS.border}`, borderRadius: '6px', background: 'transparent', color: COLORS.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
