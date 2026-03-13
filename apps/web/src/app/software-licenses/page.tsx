'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

const STATUS_STYLES: Record<string, { background: string; color: string }> = {
  active: { background: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
  renewal_due: { background: COLORS.accentAmberLight, color: COLORS.accentAmberDark },
  cancelled: { background: COLORS.contentBg, color: COLORS.textSecondary },
  expired: { background: COLORS.accentRedLight, color: COLORS.accentRedDark },
};

function fmtCurrency(n: string | number | null | undefined, currency = 'USD') {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function SoftwareLicensesPage() {
  const [licenses, setLicenses] = useState<any[]>([]);
  const [renewals, setRenewals] = useState<any[]>([]);
  const [utilization, setUtilization] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [form, setForm] = useState({
    vendorId: '',
    contractId: '',
    productName: '',
    seatCount: '25',
    seatsUsed: '18',
    pricePerSeat: '42',
    currency: 'USD',
    billingCycle: 'annual',
    renewalDate: '',
    autoRenews: true,
    renewalLeadDays: '30',
    ownerUserId: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  function loadData() {
    setLoading(true);
    Promise.all([
      api.softwareLicenses.list({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(vendorFilter ? { vendorId: vendorFilter } : {}),
      }),
      api.softwareLicenses.renewalCalendar(90),
      api.softwareLicenses.utilization(),
      api.vendors.list(),
      api.users.list(),
      api.contracts.list(),
    ])
      .then(([licenseRows, renewalRows, utilizationRows, vendorRows, userRows, contractRows]) => {
        setLicenses(licenseRows);
        setRenewals(renewalRows);
        setUtilization(utilizationRows);
        setVendors(vendorRows);
        setUsers(userRows);
        setContracts(contractRows);
        if (!form.vendorId && vendorRows[0]?.id) {
          setForm((current) => ({ ...current, vendorId: vendorRows[0].id }));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, [statusFilter, vendorFilter]);

  const totalAnnualized = useMemo(
    () =>
      utilization.reduce((sum, row) => {
        const contractValue = Number(row.contractValue ?? 0);
        return sum + (row.billingCycle === 'monthly' ? contractValue * 12 : contractValue);
      }, 0),
    [utilization],
  );

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.softwareLicenses.create({
        vendorId: form.vendorId,
        contractId: form.contractId || undefined,
        productName: form.productName,
        seatCount: parseInt(form.seatCount, 10),
        seatsUsed: parseInt(form.seatsUsed, 10),
        pricePerSeat: form.pricePerSeat,
        currency: form.currency,
        billingCycle: form.billingCycle,
        renewalDate: form.renewalDate ? new Date(form.renewalDate).toISOString() : undefined,
        autoRenews: form.autoRenews,
        renewalLeadDays: parseInt(form.renewalLeadDays, 10),
        ownerUserId: form.ownerUserId || undefined,
        notes: form.notes || undefined,
      });
      setForm((current) => ({
        ...current,
        productName: '',
        notes: '',
      }));
      loadData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const thStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    fontWeight: 600,
    color: COLORS.textSecondary,
    fontSize: '0.78rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>Software Licenses</h1>
          <p style={{ margin: '0.25rem 0 0', color: COLORS.textSecondary, fontSize: '0.875rem' }}>
            Track seat utilization and renewal exposure for SaaS spend.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="renewal_due">Renewal Due</option>
            <option value="cancelled">Cancelled</option>
            <option value="expired">Expired</option>
          </select>
          <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} style={{ padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }}>
            <option value="">All vendors</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div style={{ background: COLORS.accentRedLight, border: '1px solid #fecaca', borderRadius: '6px', padding: '0.75rem 1rem', color: COLORS.accentRedDark, fontSize: '0.875rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Active Licenses</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: COLORS.textPrimary }}>{licenses.length}</div>
          <div style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, marginTop: '0.35rem' }}>{renewals.length} renewal events in the next 90 days</div>
        </div>
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Annualized Spend</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: COLORS.textPrimary }}>{fmtCurrency(totalAnnualized)}</div>
          <div style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, marginTop: '0.35rem' }}>Based on current seat counts and billing cycles</div>
        </div>
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Underutilized Licenses</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: COLORS.textPrimary }}>{utilization.filter((row) => Number(row.utilizationPct ?? 0) < 70).length}</div>
          <div style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, marginTop: '0.35rem' }}>Using less than 70% of purchased seats</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', boxShadow: SHADOWS.card }}>
          <div style={{ padding: '0.875rem 1rem', borderBottom: `1px solid ${COLORS.tableBorder}`, fontWeight: 600, color: COLORS.textPrimary }}>License Inventory</div>
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted }}>Loading...</div>
          ) : licenses.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: COLORS.textMuted }}>No software licenses tracked yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg }}>
                    <th style={thStyle}>Product</th>
                    <th style={thStyle}>Vendor</th>
                    <th style={thStyle}>Seats</th>
                    <th style={thStyle}>Renewal</th>
                    <th style={thStyle}>Status</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {licenses.map((license, idx) => {
                    const style = STATUS_STYLES[license.status] ?? { background: COLORS.contentBg, color: COLORS.textSecondary };
                    return (
                      <tr key={license.id} style={{ borderBottom: idx < licenses.length - 1 ? `1px solid ${COLORS.contentBg}` : undefined }}>
                        <td style={{ padding: '0.875rem 1rem', fontWeight: 600, color: COLORS.textPrimary }}>{license.productName}</td>
                        <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{license.vendor?.name ?? '—'}</td>
                        <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{license.seatsUsed}/{license.seatCount}</td>
                        <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{fmtDate(license.renewalDate)}</td>
                        <td style={{ padding: '0.875rem 1rem' }}>
                          <span style={{ ...style, padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                            {license.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary, textAlign: 'right' }}>
                          {fmtCurrency(Number(license.seatCount) * Number(license.pricePerSeat), license.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <form onSubmit={submitForm} style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: COLORS.textPrimary }}>Add License</h2>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <input value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} placeholder="Product name" required style={{ padding: '0.625rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }} />
            <select value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} required style={{ padding: '0.625rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }}>
              <option value="">Select vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
              ))}
            </select>
            <select value={form.contractId} onChange={(e) => setForm({ ...form, contractId: e.target.value })} style={{ padding: '0.625rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }}>
              <option value="">No linked contract</option>
              {contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>{contract.contractNumber} · {contract.title}</option>
              ))}
            </select>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <input type="number" min="1" value={form.seatCount} onChange={(e) => setForm({ ...form, seatCount: e.target.value })} placeholder="Seats purchased" required style={{ padding: '0.625rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }} />
              <input type="number" min="0" value={form.seatsUsed} onChange={(e) => setForm({ ...form, seatsUsed: e.target.value })} placeholder="Seats used" required style={{ padding: '0.625rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <input value={form.pricePerSeat} onChange={(e) => setForm({ ...form, pricePerSeat: e.target.value })} placeholder="Price / seat" required style={{ padding: '0.625rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }} />
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} style={{ padding: '0.625rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
              <select value={form.billingCycle} onChange={(e) => setForm({ ...form, billingCycle: e.target.value })} style={{ padding: '0.625rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }}>
                <option value="annual">Annual</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <input type="date" value={form.renewalDate} onChange={(e) => setForm({ ...form, renewalDate: e.target.value })} style={{ padding: '0.625rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }} />
              <input type="number" min="1" max="365" value={form.renewalLeadDays} onChange={(e) => setForm({ ...form, renewalLeadDays: e.target.value })} placeholder="Lead days" style={{ padding: '0.625rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }} />
            </div>
            <select value={form.ownerUserId} onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })} style={{ padding: '0.625rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }}>
              <option value="">No owner assigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.name ?? user.email}</option>
              ))}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: COLORS.textPrimary }}>
              <input type="checkbox" checked={form.autoRenews} onChange={(e) => setForm({ ...form, autoRenews: e.target.checked })} />
              Auto-renews
            </label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" rows={4} style={{ padding: '0.625rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', resize: 'vertical' }} />
            <button type="submit" disabled={saving} style={{ padding: '0.7rem 1rem', background: COLORS.accentBlue, color: COLORS.white, border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Saving...' : 'Add Software License'}
            </button>
          </div>
        </form>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', boxShadow: SHADOWS.card }}>
          <div style={{ padding: '0.875rem 1rem', borderBottom: `1px solid ${COLORS.cardBorder}`, fontWeight: 600, color: COLORS.textPrimary }}>Renewal Calendar</div>
          <div style={{ padding: '0.5rem 0' }}>
            {renewals.slice(0, 8).map((renewal) => (
              <div key={renewal.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: `1px solid ${COLORS.contentBg}` }}>
                <div>
                  <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>{renewal.productName}</div>
                  <div style={{ fontSize: '0.8rem', color: COLORS.textSecondary }}>{renewal.vendor?.name ?? '—'}</div>
                </div>
                <div style={{ fontSize: '0.8125rem', color: COLORS.textSecondary }}>{fmtDate(renewal.renewalDate)}</div>
              </div>
            ))}
            {renewals.length === 0 && <div style={{ padding: '1rem', color: COLORS.textMuted }}>No renewals due in the next 90 days.</div>}
          </div>
        </div>

        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', boxShadow: SHADOWS.card }}>
          <div style={{ padding: '0.875rem 1rem', borderBottom: `1px solid ${COLORS.cardBorder}`, fontWeight: 600, color: COLORS.textPrimary }}>Utilization Watchlist</div>
          <div style={{ padding: '0.5rem 0' }}>
            {utilization.slice(0, 8).map((row) => (
              <div key={row.id} style={{ padding: '0.75rem 1rem', borderBottom: `1px solid ${COLORS.contentBg}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>{row.productName}</div>
                  <div style={{ fontSize: '0.8125rem', color: COLORS.textSecondary }}>{Number(row.utilizationPct ?? 0).toFixed(1)}%</div>
                </div>
                <div style={{ height: '8px', background: COLORS.contentBg, borderRadius: '999px', overflow: 'hidden', marginBottom: '0.35rem' }}>
                  <div style={{ width: `${Math.min(Number(row.utilizationPct ?? 0), 100)}%`, height: '100%', background: Number(row.utilizationPct ?? 0) < 70 ? COLORS.accentAmber : COLORS.accentGreen }} />
                </div>
                <div style={{ fontSize: '0.8rem', color: COLORS.textSecondary }}>
                  {row.seatsUsed}/{row.seatCount} seats used · {fmtCurrency(row.contractValue, row.currency)}
                </div>
              </div>
            ))}
            {utilization.length === 0 && <div style={{ padding: '1rem', color: COLORS.textMuted }}>No utilization data yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
