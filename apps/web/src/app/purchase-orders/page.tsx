'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

interface PurchaseOrder {
  id: string;
  number: string;
  vendor: { name: string } | null;
  version: number;
  status: string;
  currency: string;
  totalAmount: string | null;
  issuedAt: string | null;
  createdAt: string;
  poType: string;
}

const STATUS_COLORS: Record<string, { background: string; color: string }> = {
  draft: { background: COLORS.contentBg, color: COLORS.textSecondary },
  approved: { background: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
  issued: { background: COLORS.accentBlueLight, color: '#1e40af' },
  received: { background: COLORS.accentPurpleLight, color: COLORS.accentPurpleDark },
  invoiced: { background: '#ffedd5', color: '#9a3412' },
  closed: { background: COLORS.contentBg, color: COLORS.textSecondary },
  cancelled: { background: COLORS.accentRedLight, color: COLORS.accentRedDark },
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', approved: 'Approved', issued: 'Issued',
  received: 'Received', invoiced: 'Invoiced', closed: 'Closed', cancelled: 'Cancelled',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_COLORS[status] ?? { background: COLORS.contentBg, color: COLORS.textSecondary };
  return (
    <span style={{ ...style, padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, display: 'inline-block', whiteSpace: 'nowrap' }}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function formatCurrency(amount: string | number | null, currency = 'USD') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

async function downloadCsv(type: string) {
  const { api } = await import('../../lib/api');
  const res = await api.export.download(type);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `export-${type}-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [exporting, setExporting] = useState(false);

  async function handleExportCsv() {
    setExporting(true);
    try { await downloadCsv('purchase-orders'); } finally { setExporting(false); }
  }

  useEffect(() => {
    api.purchaseOrders.list()
      .then((data) => setOrders(Array.isArray(data) ? data : (data as any).data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = statusFilter ? orders.filter((o) => o.status === statusFilter) : orders;

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>Purchase Orders</h1>
          <p style={{ margin: '0.25rem 0 0', color: COLORS.textSecondary, fontSize: '0.875rem' }}>Track the full PO lifecycle</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '0.4rem 0.6rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', color: COLORS.textSecondary }}
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button
            onClick={handleExportCsv}
            disabled={exporting}
            style={{ padding: '0.5rem 1rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', background: COLORS.cardBg, cursor: exporting ? 'not-allowed' : 'pointer', fontSize: '0.875rem', color: COLORS.textSecondary, fontWeight: 500 }}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <Link href="/purchase-orders/new" style={{ background: COLORS.textPrimary, color: COLORS.white, padding: '0.5rem 1.25rem', borderRadius: '6px', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
            + New PO
          </Link>
        </div>
      </div>

      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', boxShadow: SHADOWS.card }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted, fontSize: '0.875rem' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '4rem 2rem', textAlign: 'center', color: COLORS.textMuted }}>
            <p style={{ fontSize: '1rem', marginBottom: '0.5rem', color: COLORS.textSecondary, fontWeight: 500 }}>
              {statusFilter ? `No ${STATUS_LABELS[statusFilter] ?? statusFilter} purchase orders` : 'No purchase orders yet'}
            </p>
            <p style={{ fontSize: '0.875rem' }}>{statusFilter ? 'Try a different filter.' : 'Create your first PO to get started.'}</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg }}>
                  {['Number', 'Vendor', 'Version', 'Status', 'Total', 'Issued Date'].map((col) => (
                    <th key={col} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((po, idx) => (
                  <tr key={po.id} style={{ borderBottom: idx < filtered.length - 1 ? `1px solid ${COLORS.contentBg}` : undefined }}>
                    <td style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>
                      <Link href={`/purchase-orders/${po.id}`} style={{ color: COLORS.accentBlueDark, textDecoration: 'none' }}>{po.number}</Link>
                      {po.poType === 'blanket' && (
                        <span style={{ marginLeft: '0.5rem', background: '#fef9c3', color: COLORS.accentAmberDark, padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>BLANKET</span>
                      )}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{po.vendor?.name ?? '—'}</td>
                    <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>V{po.version ?? 1}</td>
                    <td style={{ padding: '0.875rem 1rem' }}><StatusBadge status={po.status} /></td>
                    <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(po.totalAmount, po.currency)}</td>
                    <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{po.issuedAt ? new Date(po.issuedAt).toLocaleDateString() : '—'}</td>
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
