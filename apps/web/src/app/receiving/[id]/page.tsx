'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';
import Breadcrumbs from '../../../components/breadcrumbs';

interface GRNLine {
  id: string;
  poLineId: string;
  quantityReceived: string;
  quantityRejected: string;
  rejectionReason: string | null;
  storageLocation: string | null;
  poLine: { lineNumber: string; description: string; quantity: string } | null;
}

interface GRN {
  id: string;
  number: string;
  status: string;
  receivedDate: string;
  notes: string | null;
  purchaseOrder: { id: string; number: string; vendor: { name: string } | null } | null;
  lines: GRNLine[];
  createdAt: string;
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: COLORS.textPrimary }}>{value ?? '—'}</div>
    </div>
  );
}

export default function GRNDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState('');
  const [grn, setGrn] = useState<GRN | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.receiving.get(pid)
        .then((data) => setGrn(data))
        .catch(() => setGrn(null))
        .finally(() => setLoading(false));
    });
  }, [params]);

  async function confirmGRN() {
    setError('');
    setConfirming(true);
    try {
      await api.receiving.confirm(id);
      const updated = await api.receiving.get(id);
      setGrn(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirm failed');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) return <div style={{ padding: '2rem', color: COLORS.textMuted, fontSize: '0.875rem' }}>Loading…</div>;
  if (!grn) return (
    <div style={{ padding: '2rem', color: COLORS.textSecondary }}>
      GRN not found. <Link href="/receiving" style={{ color: COLORS.accentBlueDark }}>Back to list</Link>
    </div>
  );

  const totalReceived = grn.lines.reduce((s, l) => s + parseFloat(l.quantityReceived), 0);
  const totalRejected = grn.lines.reduce((s, l) => s + parseFloat(l.quantityRejected), 0);
  const statusColors: Record<string, { background: string; color: string }> = {
    confirmed: { background: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
    draft: { background: COLORS.hoverBg, color: COLORS.textSecondary },
    cancelled: { background: COLORS.accentRedLight, color: COLORS.accentRedDark },
  };
  const statusStyle = statusColors[grn.status] ?? { background: COLORS.hoverBg, color: COLORS.textSecondary };

  return (
    <div style={{ padding: '2rem', maxWidth: '900px' }}>
      <Breadcrumbs items={[{ label: 'Receiving', href: '/receiving' }, { label: grn.number }]} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ fontSize: '0.875rem', color: COLORS.textSecondary, marginBottom: '0.25rem' }}>
            <Link href="/receiving" style={{ color: COLORS.textSecondary, textDecoration: 'none' }}>Goods Receipts</Link> / {grn.number}
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>{grn.number}</h1>
        </div>
        <span style={{ ...statusStyle, padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.8rem', fontWeight: 600 }}>
          {grn.status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
        </span>
      </div>

      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: SHADOWS.card }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: COLORS.textPrimary }}>Receipt Information</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
          <Field label="GRN Number" value={grn.number} />
          <Field label="Purchase Order" value={grn.purchaseOrder?.number ?? null} />
          <Field label="Vendor" value={grn.purchaseOrder?.vendor?.name ?? null} />
          <Field label="Received Date" value={new Date(grn.receivedDate).toLocaleDateString()} />
          <Field label="Total Received" value={String(totalReceived)} />
          <Field label="Total Rejected" value={String(totalRejected)} />
        </div>
        {grn.notes && (
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${COLORS.hoverBg}` }}>
            <Field label="Notes" value={grn.notes} />
          </div>
        )}
      </div>

      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', marginBottom: '1.5rem', boxShadow: SHADOWS.card }}>
        <div style={{ padding: '1rem 1.5rem', borderBottom: `1px solid ${COLORS.tableBorder}` }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: COLORS.textPrimary }}>Received Lines</h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                {['Line', 'Description', 'PO Qty', 'Received', 'Rejected', 'Rejection Reason'].map((h) => (
                  <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.8rem' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grn.lines.map((line, idx) => (
                <tr key={line.id} style={{ borderBottom: idx < grn.lines.length - 1 ? `1px solid ${COLORS.hoverBg}` : undefined }}>
                  <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{line.poLine?.lineNumber ?? '—'}</td>
                  <td style={{ padding: '0.875rem 1rem' }}>{line.poLine?.description ?? '—'}</td>
                  <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{line.poLine?.quantity ?? '—'}</td>
                  <td style={{ padding: '0.875rem 1rem', color: COLORS.accentGreenDark, fontWeight: 600 }}>{line.quantityReceived}</td>
                  <td style={{ padding: '0.875rem 1rem', color: parseFloat(line.quantityRejected) > 0 ? COLORS.accentRedDark : COLORS.textSecondary }}>{line.quantityRejected}</td>
                  <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{line.rejectionReason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(grn.status === 'draft' || grn.status === 'confirmed') && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {grn.status === 'draft' && (
            <button onClick={confirmGRN} disabled={confirming}
              style={{ background: '#059669', color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: confirming ? 'not-allowed' : 'pointer', opacity: confirming ? 0.7 : 1 }}>
              {confirming ? 'Confirming…' : 'Confirm Receipt'}
            </button>
          )}
          <button
            onClick={async () => {
              if (!confirm('Cancel this GRN?')) return;
              setConfirming(true);
              try {
                await api.receiving.cancel(id);
                const updated = await api.receiving.get(id);
                setGrn(updated);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Cancel failed');
              } finally {
                setConfirming(false);
              }
            }}
            disabled={confirming}
            style={{ background: COLORS.white, color: COLORS.accentRedDark, border: `1px solid ${COLORS.accentRedDark}`, borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 500, cursor: confirming ? 'not-allowed' : 'pointer' }}
          >
            Cancel GRN
          </button>
          {error && <div style={{ width: '100%', marginTop: '0.75rem', background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.625rem 1rem', color: COLORS.accentRedDark, fontSize: '0.875rem' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
