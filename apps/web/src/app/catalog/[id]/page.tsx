'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';
import Breadcrumbs from '../../../components/breadcrumbs';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`,
  borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box',
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: COLORS.textPrimary }}>{value ?? '—'}</div>
    </div>
  );
}

function formatPrice(price: string | number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(parseFloat(String(price || 0)));
}

export default function CatalogItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [id, setId] = useState('');
  const [form, setForm] = useState({
    name: '', sku: '', description: '', category: '',
    unitOfMeasure: 'each', unitPrice: '', currency: 'USD',
  });

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.catalog.get(pid)
        .then((data) => {
          setItem(data);
          setForm({
            name: data.name || '', sku: data.sku || '',
            description: data.description || '', category: data.category || '',
            unitOfMeasure: data.unitOfMeasure || 'each',
            unitPrice: String(data.unitPrice || '0'), currency: data.currency || 'USD',
          });
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    });
  }, []);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.catalog.update(id, {
        name: form.name, sku: form.sku || undefined, description: form.description || undefined,
        category: form.category || undefined, unitOfMeasure: form.unitOfMeasure,
        unitPrice: form.unitPrice, currency: form.currency,
      });
      setItem(updated);
      setEditing(false);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    setToggling(true);
    try {
      const updated = await api.catalog.update(id, { isActive: !item.isActive });
      setItem(updated);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setToggling(false);
    }
  }

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted }}>Loading…</div>;
  if (!item) return <div style={{ padding: '2rem', color: COLORS.accentRedDark }}>Item not found. <Link href="/catalog" style={{ color: COLORS.accentBlueDark }}>Back to catalog</Link></div>;

  const price = formatPrice(item.unitPrice || '0', item.currency || 'USD');

  return (
    <div style={{ padding: '2rem', maxWidth: '700px' }}>
      <Breadcrumbs items={[{ label: 'Catalog', href: '/catalog' }, { label: item.name }]} />
      <Link href="/catalog" style={{ color: COLORS.textSecondary, fontSize: '0.875rem', textDecoration: 'none' }}>
        &larr; Back to Catalog
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '1rem 0 1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>{item.name}</h1>
            <span style={{
              padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600,
              background: item.isActive ? COLORS.accentGreenLight : COLORS.hoverBg,
              color: item.isActive ? COLORS.accentGreenDark : COLORS.textSecondary,
            }}>
              {item.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          {item.sku && <div style={{ marginTop: '0.25rem', fontSize: '0.875rem', color: COLORS.textSecondary }}>SKU: {item.sku}</div>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {item.isActive && (
            <Link
              href={`/requisitions/new?catalogItemId=${item.id}&description=${encodeURIComponent(item.name)}&unitPrice=${encodeURIComponent(item.unitPrice ?? '0')}&uom=${encodeURIComponent(item.unitOfMeasure ?? 'each')}${item.vendor?.id ? `&vendorId=${item.vendor.id}` : ''}`}
              style={{ padding: '0.4rem 0.875rem', borderRadius: '6px', background: COLORS.textPrimary, color: COLORS.white, textDecoration: 'none', fontSize: '0.8rem', fontWeight: 500, display: 'inline-block' }}
            >
              + Create Requisition
            </Link>
          )}
          <button
            onClick={toggleActive}
            disabled={toggling}
            style={{ padding: '0.4rem 0.875rem', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
              background: item.isActive ? COLORS.accentRedLight : COLORS.accentGreenLight,
              color: item.isActive ? COLORS.accentRedDark : '#059669' }}
          >
            {toggling ? '…' : item.isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button
            onClick={() => setEditing(!editing)}
            style={{ padding: '0.4rem 0.875rem', borderRadius: '6px', border: `1px solid ${COLORS.inputBorder}`, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500, background: COLORS.white, color: COLORS.textSecondary }}
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </div>

      {editing ? (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: SHADOWS.card }}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Edit Catalog Item</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>Name *</label>
              <input required value={form.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>SKU</label>
              <input value={form.sku} onChange={(e) => set('sku', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>Category</label>
              <input value={form.category} onChange={(e) => set('category', e.target.value)} style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>Description</label>
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2}
                style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>Unit of Measure</label>
              <input value={form.unitOfMeasure} onChange={(e) => set('unitOfMeasure', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>Unit Price</label>
              <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={(e) => set('unitPrice', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>Currency</label>
              <input value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} maxLength={3} style={inputStyle} />
            </div>
          </div>
          <button onClick={handleSave} disabled={saving || !form.name}
            style={{ marginTop: '1rem', background: COLORS.textPrimary, color: COLORS.white, border: 'none', padding: '0.5rem 1.25rem', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 500, fontSize: '0.875rem' }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      ) : (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: SHADOWS.card }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            <Field label="Name" value={item.name} />
            <Field label="SKU" value={item.sku} />
            <Field label="Category" value={item.category} />
            <Field label="Unit of Measure" value={item.unitOfMeasure} />
            <Field label="Unit Price" value={price} />
            <Field label="Currency" value={item.currency} />
            {item.description && <div style={{ gridColumn: '1 / -1' }}><Field label="Description" value={item.description} /></div>}
          </div>
        </div>
      )}

      {item.vendor && (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: '0.75rem' }}>Vendor</div>
          <Link href={`/vendors/${item.vendor.id}`} style={{ color: COLORS.accentBlueDark, fontWeight: 600, textDecoration: 'none', fontSize: '0.9rem' }}>
            {item.vendor.name}
          </Link>
        </div>
      )}

      {!!item.priceProposals?.length && (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card, marginTop: '1.5rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: '0.75rem' }}>
            Supplier Price Proposal History
          </div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {item.priceProposals.map((proposal: any) => (
              <div key={proposal.id} style={{ border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: COLORS.textPrimary }}>
                    {formatPrice(proposal.currentPrice, item.currency || 'USD')} {'->'} {formatPrice(proposal.proposedPrice, item.currency || 'USD')}
                  </div>
                  <span style={{
                    padding: '0.18rem 0.55rem',
                    borderRadius: '999px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    background: proposal.status === 'approved' ? COLORS.accentGreenLight : proposal.status === 'rejected' ? COLORS.accentRedLight : COLORS.accentAmberLight,
                    color: proposal.status === 'approved' ? COLORS.accentGreenDark : proposal.status === 'rejected' ? COLORS.accentRedDark : COLORS.accentAmberDark,
                    textTransform: 'uppercase',
                  }}>
                    {proposal.status}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.82rem', color: COLORS.textSecondary }}>
                  <div>Supplier: {proposal.vendor?.name ?? '—'}</div>
                  <div>Submitted: {proposal.submittedAt ? new Date(proposal.submittedAt).toLocaleDateString() : '—'}</div>
                  <div>Effective: {proposal.effectiveDate ? new Date(proposal.effectiveDate).toLocaleDateString() : 'Immediate'}</div>
                  <div>Reviewed by: {proposal.reviewer?.name ?? 'Pending review'}</div>
                </div>
                {proposal.note && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: COLORS.textSecondary }}>
                    Supplier note: {proposal.note}
                  </div>
                )}
                {proposal.reviewNote && (
                  <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', color: COLORS.textSecondary }}>
                    Review note: {proposal.reviewNote}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
