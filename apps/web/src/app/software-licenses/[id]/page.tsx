'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';
import Breadcrumbs from '../../../components/breadcrumbs';

function fmtCurrency(value: string | number | null | undefined, currency = 'USD') {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.3rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.9rem', color: COLORS.textPrimary }}>{value}</div>
    </div>
  );
}

export default function SoftwareLicenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState('');
  const [license, setLicense] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState('');

  useEffect(() => {
    params.then(({ id: value }) => {
      setId(value);
      api.softwareLicenses.get(value)
        .then((data) => setLicense(data))
        .finally(() => setLoading(false));
    });
  }, []);

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted }}>Loading...</div>;
  if (!license) return <div style={{ padding: '2rem', color: COLORS.accentRedDark }}>License not found.</div>;

  const utilizationPct = license.seatCount ? (Number(license.seatsUsed) / Number(license.seatCount)) * 100 : 0;
  const annualizedValue = Number(license.billingCycle === 'monthly'
    ? Number(license.seatCount) * Number(license.pricePerSeat) * 12
    : Number(license.seatCount) * Number(license.pricePerSeat));

  async function applyAction(action: 'renew' | 'renegotiate' | 'cancel') {
    if (!id) return;
    setActionLoading(action);
    try {
      const updated = await api.softwareLicenses.renewalAction(id, { action, note: actionNote || undefined });
      setLicense(updated);
      setActionNote('');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '820px' }}>
      <Breadcrumbs items={[{ label: 'Software Licenses', href: '/software-licenses' }, { label: license.productName }]} />
      <Link href="/software-licenses" style={{ color: COLORS.textSecondary, fontSize: '0.875rem', textDecoration: 'none' }}>
        &larr; Back to Software Licenses
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', margin: '1rem 0 1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>{license.productName}</h1>
          <div style={{ marginTop: '0.35rem', fontSize: '0.9rem', color: COLORS.textSecondary }}>
            {license.vendor?.name ?? 'Unknown vendor'}
          </div>
        </div>
        <span style={{
          padding: '0.25rem 0.65rem',
          borderRadius: '999px',
          fontSize: '0.78rem',
          fontWeight: 700,
          background: license.status === 'renewal_due' ? COLORS.accentAmberLight : license.status === 'expired' ? COLORS.accentRedLight : COLORS.accentGreenLight,
          color: license.status === 'renewal_due' ? COLORS.accentAmberDark : license.status === 'expired' ? COLORS.accentRedDark : COLORS.accentGreenDark,
          textTransform: 'uppercase',
        }}>
          {license.status.replace('_', ' ')}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', padding: '1.1rem', boxShadow: SHADOWS.card }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: '0.4rem' }}>Seats</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.textPrimary }}>{license.seatsUsed}/{license.seatCount}</div>
          <div style={{ fontSize: '0.82rem', color: COLORS.textSecondary, marginTop: '0.25rem' }}>{utilizationPct.toFixed(1)}% utilized</div>
        </div>
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', padding: '1.1rem', boxShadow: SHADOWS.card }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: '0.4rem' }}>Renewal Date</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: COLORS.textPrimary }}>{fmtDate(license.renewalDate)}</div>
          <div style={{ fontSize: '0.82rem', color: COLORS.textSecondary, marginTop: '0.25rem' }}>{license.autoRenews ? 'Auto-renews' : 'Manual renewal'}</div>
        </div>
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', padding: '1.1rem', boxShadow: SHADOWS.card }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: '0.4rem' }}>Annualized Value</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: COLORS.textPrimary }}>{fmtCurrency(annualizedValue, license.currency)}</div>
          <div style={{ fontSize: '0.82rem', color: COLORS.textSecondary, marginTop: '0.25rem' }}>
            {fmtCurrency(license.pricePerSeat, license.currency)} per seat / {license.billingCycle}
          </div>
        </div>
      </div>

      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card, marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: COLORS.textPrimary, marginBottom: '1rem' }}>License Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem 1.25rem' }}>
          <DetailField label="Vendor" value={license.vendor?.name ?? '—'} />
          <DetailField label="Owner" value={license.owner?.name ?? license.owner?.email ?? '—'} />
          <DetailField label="Billing Cycle" value={license.billingCycle} />
          <DetailField label="Renewal Lead" value={`${license.renewalLeadDays} days`} />
          <DetailField label="Contract" value={license.contract ? `${license.contract.contractNumber} · ${license.contract.title}` : '—'} />
          <DetailField label="Currency" value={license.currency} />
        </div>
        {license.notes && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.3rem' }}>
              Notes
            </div>
            <div style={{ fontSize: '0.9rem', color: COLORS.textSecondary, whiteSpace: 'pre-wrap' }}>{license.notes}</div>
          </div>
        )}
      </div>

      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: COLORS.textPrimary, marginBottom: '1rem' }}>Renewal Timeline</div>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div style={{ border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '0.9rem' }}>
            <div style={{ fontSize: '0.82rem', color: COLORS.textMuted, marginBottom: '0.25rem' }}>Renewal review opens</div>
            <div style={{ fontSize: '0.92rem', fontWeight: 600, color: COLORS.textPrimary }}>
              {license.renewalDate ? fmtDate(new Date(new Date(license.renewalDate).getTime() - Number(license.renewalLeadDays) * 24 * 60 * 60 * 1000).toISOString()) : '—'}
            </div>
          </div>
          <div style={{ border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '0.9rem' }}>
            <div style={{ fontSize: '0.82rem', color: COLORS.textMuted, marginBottom: '0.25rem' }}>Renewal date</div>
            <div style={{ fontSize: '0.92rem', fontWeight: 600, color: COLORS.textPrimary }}>{fmtDate(license.renewalDate)}</div>
          </div>
          <div style={{ border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '0.9rem' }}>
            <div style={{ fontSize: '0.82rem', color: COLORS.textMuted, marginBottom: '0.25rem' }}>Suggested action</div>
            <div style={{ fontSize: '0.92rem', fontWeight: 600, color: COLORS.textPrimary }}>
              {utilizationPct < 70 ? 'Review downsize or renegotiate' : license.autoRenews ? 'Confirm auto-renewal coverage' : 'Prepare manual renewal'}
            </div>
          </div>
        </div>
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${COLORS.tableBorder}` }}>
          <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.45rem' }}>
            Renewal Action
          </div>
          <textarea
            value={actionNote}
            onChange={(event) => setActionNote(event.target.value)}
            placeholder="Optional context for the renewal decision"
            rows={3}
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '0.75rem', borderRadius: '8px', border: `1px solid ${COLORS.inputBorder}`, fontSize: '0.875rem' }}
          />
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.85rem' }}>
            <button type="button" onClick={() => applyAction('renew')} disabled={!!actionLoading} style={{ padding: '0.65rem 0.95rem', borderRadius: '8px', border: 'none', background: COLORS.accentGreen, color: '#fff', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer' }}>
              {actionLoading === 'renew' ? 'Processing...' : 'Renew for Next Term'}
            </button>
            <button type="button" onClick={() => applyAction('renegotiate')} disabled={!!actionLoading} style={{ padding: '0.65rem 0.95rem', borderRadius: '8px', border: 'none', background: COLORS.accentBlue, color: '#fff', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer' }}>
              {actionLoading === 'renegotiate' ? 'Processing...' : 'Start Renegotiation'}
            </button>
            <button type="button" onClick={() => applyAction('cancel')} disabled={!!actionLoading} style={{ padding: '0.65rem 0.95rem', borderRadius: '8px', border: 'none', background: COLORS.accentRed, color: '#fff', fontWeight: 700, cursor: actionLoading ? 'not-allowed' : 'pointer' }}>
              {actionLoading === 'cancel' ? 'Processing...' : 'Prepare Cancellation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
