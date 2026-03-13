'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

interface Vendor { id: string; name: string; }
interface CatalogItem {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unitOfMeasure: string;
  unitPrice: string;
  currency: string;
  isActive: boolean;
  vendor: Vendor | null;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`,
  borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box',
};
const btnPrimary: React.CSSProperties = {
  background: COLORS.textPrimary, color: COLORS.white, border: 'none', padding: '0.5rem 1.25rem',
  borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer',
};
const btnDanger: React.CSSProperties = {
  background: 'transparent', color: COLORS.accentRedDark, border: `1px solid ${COLORS.accentRedDark}`,
  padding: '0.25rem 0.625rem', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer',
};

function formatPrice(price: string, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(parseFloat(price));
}

const EMPTY_FORM = {
  name: '', sku: '', description: '', category: '', unitOfMeasure: 'each',
  unitPrice: '', currency: 'USD', vendorId: '',
};

export default function CatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [priceProposals, setPriceProposals] = useState<any[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [items, vendors, cats, proposals] = await Promise.all([
        searchQ ? api.catalog.search(searchQ) : api.catalog.list({ vendorId: filterVendor || undefined, category: filterCategory || undefined }),
        api.vendors.list(),
        api.catalog.categories(),
        api.catalog.priceProposals('pending'),
      ]);
      setItems(items as CatalogItem[]);
      setVendors(vendors as Vendor[]);
      setCategories(cats);
      setPriceProposals(proposals);
    } catch {
      // silently fail
    }
    setLoading(false);
  }, [filterCategory, filterVendor, searchQ]);

  useEffect(() => { void load(); }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const body = {
      name: form.name, sku: form.sku || undefined, description: form.description || undefined,
      category: form.category || undefined, unitOfMeasure: form.unitOfMeasure,
      unitPrice: parseFloat(form.unitPrice), currency: form.currency,
      vendorId: form.vendorId || undefined,
    };
    try {
      if (editId) await api.catalog.update(editId, body);
      else await api.catalog.create(body);
      setShowForm(false); setEditId(null); setForm(EMPTY_FORM); setFormError(''); await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    }
    setSaving(false);
  }

  function startEdit(item: CatalogItem) {
    setForm({
      name: item.name, sku: item.sku ?? '', description: item.description ?? '',
      category: item.category ?? '', unitOfMeasure: item.unitOfMeasure,
      unitPrice: item.unitPrice, currency: item.currency,
      vendorId: item.vendor?.id ?? '',
    });
    setEditId(item.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this catalog item?')) return;
    await api.catalog.remove(id).catch(() => {});
    await load();
  }

  async function toggleActive(item: CatalogItem) {
    await api.catalog.update(item.id, { isActive: !item.isActive }).catch(() => {});
    await load();
  }

  const label = (text: string) => (
    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>
      {text}
    </label>
  );

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>Catalog</h1>
          <p style={{ margin: '0.25rem 0 0', color: COLORS.textSecondary, fontSize: '0.875rem' }}>Managed product & service catalog for requisitions</p>
        </div>
        <button style={btnPrimary} onClick={() => { setShowForm(!showForm); setEditId(null); setForm(EMPTY_FORM); }}>
          {showForm && !editId ? 'Cancel' : '+ Add Item'}
        </button>
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: SHADOWS.card }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>{editId ? 'Edit Item' : 'New Catalog Item'}</h3>
          <form onSubmit={handleSave}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ gridColumn: '1 / 3' }}>
                {label('Name *')}
                <input style={inputStyle} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Item name" />
              </div>
              <div>
                {label('SKU')}
                <input style={inputStyle} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. OFF-PAPER-A4" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                {label('Description')}
                <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description" />
              </div>
              <div>
                {label('Category')}
                <input style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Office Supplies" list="categories-list" />
                <datalist id="categories-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
              <div>
                {label('Vendor')}
                <select style={inputStyle} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
                  <option value="">— No vendor —</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                {label('Unit of Measure')}
                <input style={inputStyle} value={form.unitOfMeasure} onChange={(e) => setForm({ ...form, unitOfMeasure: e.target.value })} placeholder="each" />
              </div>
              <div>
                {label('Unit Price *')}
                <input style={inputStyle} type="number" required min="0" step="any" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} placeholder="0.00" />
              </div>
              <div>
                {label('Currency')}
                <input style={inputStyle} value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
              </div>
            </div>
            {formError && <div style={{ marginBottom: '0.75rem', background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.5rem 0.75rem', color: COLORS.accentRedDark, fontSize: '0.875rem' }}>{formError}</div>}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="submit" style={btnPrimary} disabled={saving}>{saving ? 'Saving…' : editId ? 'Update Item' : 'Create Item'}</button>
              <button type="button" style={{ ...btnPrimary, background: COLORS.white, color: COLORS.textSecondary, border: `1px solid ${COLORS.inputBorder}` }}
                onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); setFormError(''); }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ ...inputStyle, width: '220px' }} placeholder="Search items…"
          value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
        />
        <select style={{ ...inputStyle, width: '180px' }} value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setSearchQ(''); }}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={{ ...inputStyle, width: '180px' }} value={filterVendor} onChange={(e) => { setFilterVendor(e.target.value); setSearchQ(''); }}>
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        {(filterCategory || filterVendor || searchQ) && (
          <button style={{ ...btnPrimary, background: 'transparent', color: COLORS.textSecondary, border: `1px solid ${COLORS.inputBorder}` }}
            onClick={() => { setFilterCategory(''); setFilterVendor(''); setSearchQ(''); }}>Clear</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.875rem', color: COLORS.textSecondary }}>{items.length} items</span>
      </div>

      {/* Table */}
      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', boxShadow: SHADOWS.card }}>
        {priceProposals.length > 0 && (
          <div style={{ padding: '1rem', borderBottom: `1px solid ${COLORS.tableBorder}`, background: '#fff7ed' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#9a3412', marginBottom: '0.75rem' }}>
              Pending Supplier Price Updates ({priceProposals.length})
            </div>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {priceProposals.slice(0, 6).map((proposal) => (
                <div key={proposal.id} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1.3fr auto', gap: '0.75rem', alignItems: 'center', background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '0.75rem' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>{proposal.item?.name}</div>
                    <div style={{ fontSize: '0.78rem', color: COLORS.textMuted }}>{proposal.vendor?.name}</div>
                  </div>
                  <div style={{ fontSize: '0.875rem', color: COLORS.textSecondary }}>
                    {formatPrice(String(proposal.currentPrice), proposal.item?.currency ?? 'USD')} {'->'} {formatPrice(String(proposal.proposedPrice), proposal.item?.currency ?? 'USD')}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: COLORS.textSecondary }}>
                    Effective: {proposal.effectiveDate ? new Date(proposal.effectiveDate).toLocaleDateString() : 'Immediate'}
                  </div>
                  <input
                    value={reviewNotes[proposal.id] ?? ''}
                    onChange={(e) => setReviewNotes((current) => ({ ...current, [proposal.id]: e.target.value }))}
                    placeholder="Review note"
                    style={{ ...inputStyle, fontSize: '0.8rem' }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={async () => { await api.catalog.reviewPriceProposal(proposal.itemId, proposal.id, { status: 'approved', reviewNote: reviewNotes[proposal.id] }); await load(); }}
                      style={{ ...btnPrimary, background: '#059669', padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={async () => { await api.catalog.reviewPriceProposal(proposal.itemId, proposal.id, { status: 'rejected', reviewNote: reviewNotes[proposal.id] }); await load(); }}
                      style={{ ...btnDanger }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: '4rem 2rem', textAlign: 'center', color: COLORS.textMuted }}>
            <p style={{ fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.5rem' }}>No catalog items</p>
            <p style={{ fontSize: '0.875rem' }}>Add items to the catalog to enable quick selection in requisitions.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg }}>
                  {['Name', 'SKU', 'Category', 'Vendor', 'UOM', 'Unit Price', 'Active', ''].map((h) => (
                    <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.id} style={{ borderBottom: idx < items.length - 1 ? `1px solid ${COLORS.contentBg}` : undefined, opacity: item.isActive ? 1 : 0.5 }}>
                    <td style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>
                      <Link href={`/catalog/${item.id}`} style={{ color: COLORS.accentBlueDark, textDecoration: 'none' }}>{item.name}</Link>
                      {item.description && <div style={{ fontWeight: 400, fontSize: '0.8rem', color: COLORS.textMuted, marginTop: '2px' }}>{item.description}</div>}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontFamily: 'monospace', fontSize: '0.8rem', color: COLORS.textSecondary }}>{item.sku ?? '—'}</td>
                    <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{item.category ?? '—'}</td>
                    <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{item.vendor?.name ?? '—'}</td>
                    <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{item.unitOfMeasure}</td>
                    <td style={{ padding: '0.875rem 1rem', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: COLORS.textPrimary }}>{formatPrice(item.unitPrice, item.currency)}</td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <button onClick={() => toggleActive(item)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: item.isActive ? '#059669' : COLORS.textMuted, fontWeight: 600, fontSize: '0.8rem' }}>
                        {item.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {item.isActive && (
                          <Link
                            href={`/requisitions/new?catalogItemId=${item.id}&description=${encodeURIComponent(item.name)}&unitPrice=${encodeURIComponent(item.unitPrice ?? '0')}&uom=${encodeURIComponent(item.unitOfMeasure ?? 'each')}${item.vendor?.id ? `&vendorId=${item.vendor.id}` : ''}`}
                            style={{ ...btnDanger, color: '#059669', borderColor: '#059669', textDecoration: 'none', display: 'inline-block' }}
                          >
                            + Req
                          </Link>
                        )}
                        <button style={{ ...btnDanger, color: COLORS.accentBlueDark, borderColor: COLORS.accentBlueDark }} onClick={() => startEdit(item)}>Edit</button>
                        <button style={btnDanger} onClick={() => handleDelete(item.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
