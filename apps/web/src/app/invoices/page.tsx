'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

interface Invoice {
  id: string;
  internalNumber: string;
  invoiceNumber: string;
  status: string;
  matchStatus: string;
  totalAmount: string;
  currency: string;
  invoiceDate: string;
  dueDate: string | null;
  vendor: { name: string } | null;
  purchaseOrder: { number: string } | null;
}

const STATUS_COLORS: Record<string, { background: string; color: string }> = {
  draft: { background: COLORS.contentBg, color: COLORS.textSecondary },
  pending_match: { background: COLORS.accentAmberLight, color: COLORS.accentAmberDark },
  matched: { background: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
  partial_match: { background: COLORS.accentBlueLight, color: '#1e40af' },
  exception: { background: COLORS.accentRedLight, color: COLORS.accentRedDark },
  approved: { background: COLORS.accentPurpleLight, color: COLORS.accentPurpleDark },
  paid: { background: COLORS.contentBg, color: COLORS.textSecondary },
};

const MATCH_COLORS: Record<string, { background: string; color: string }> = {
  unmatched: { background: COLORS.contentBg, color: COLORS.textSecondary },
  full_match: { background: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
  partial_match: { background: COLORS.accentBlueLight, color: '#1e40af' },
  exception: { background: COLORS.accentRedLight, color: COLORS.accentRedDark },
};

function Badge({ label, colors }: { label: string; colors: { background: string; color: string } }) {
  return (
    <span style={{ ...colors, padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
      {label.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
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

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ success: number; failed: number } | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  async function handleExportCsv() {
    setExporting(true);
    try { await downloadCsv('invoices'); } finally { setExporting(false); }
  }

  async function load() {
    setLoading(true);
    api.invoices.list()
      .then((data) => setInvoices(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const filtered = statusFilter ? invoices.filter((i) => i.status === statusFilter) : invoices;

  // Only matched/partial_match invoices can be bulk approved
  const approvableSelected = [...selected].filter((id) => {
    const inv = invoices.find((i) => i.id === id);
    return inv && !['approved', 'paid', 'cancelled'].includes(inv.status) && inv.matchStatus !== 'exception';
  });

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const approvable = filtered.filter((i) => !['approved', 'paid', 'cancelled'].includes(i.status) && i.matchStatus !== 'exception');
    if (approvable.every((i) => selected.has(i.id))) {
      setSelected((prev) => {
        const next = new Set(prev);
        approvable.forEach((i) => next.delete(i.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        approvable.forEach((i) => next.add(i.id));
        return next;
      });
    }
  }

  async function handleBulkApprove() {
    if (approvableSelected.length === 0) return;
    setBulkLoading(true);
    setError('');
    setBulkResult(null);
    try {
      const results = await api.invoices.bulkApprove(approvableSelected);
      const success = results.filter((r: any) => r.success).length;
      const failed = results.filter((r: any) => !r.success).length;
      setBulkResult({ success, failed });
      setSelected(new Set());
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <div style={{ padding: '2rem' }}>
      {error && (
        <div style={{ marginBottom: '1rem', background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.625rem 1rem', color: COLORS.accentRedDark, fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between' }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.accentRedDark, fontWeight: 700 }}>×</button>
        </div>
      )}
      {bulkResult && (
        <div style={{ marginBottom: '1rem', background: COLORS.accentGreenLight, border: '1px solid #a7f3d0', borderRadius: '6px', padding: '0.625rem 1rem', color: COLORS.accentGreenDark, fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between' }}>
          Bulk approve complete: {bulkResult.success} approved{bulkResult.failed > 0 ? `, ${bulkResult.failed} failed` : ''}.
          <button onClick={() => setBulkResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.accentGreenDark, fontWeight: 700 }}>×</button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>Invoices</h1>
          <p style={{ margin: '0.25rem 0 0', color: COLORS.textSecondary, fontSize: '0.875rem' }}>Vendor invoices with 3-way match status</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {selected.size > 0 && (
            <button
              onClick={handleBulkApprove}
              disabled={bulkLoading || approvableSelected.length === 0}
              style={{ padding: '0.4rem 1rem', background: approvableSelected.length > 0 ? '#059669' : COLORS.inputBorder, color: COLORS.white, border: 'none', borderRadius: '6px', cursor: approvableSelected.length > 0 ? 'pointer' : 'not-allowed', fontSize: '0.875rem', fontWeight: 500 }}
            >
              {bulkLoading ? 'Approving…' : `Approve ${approvableSelected.length} Selected`}
            </button>
          )}
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setSelected(new Set()); }}
            style={{ padding: '0.4rem 0.6rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', color: COLORS.textSecondary }}
          >
            <option value="">All Statuses</option>
            <option value="pending_match">Pending Match</option>
            <option value="matched">Matched</option>
            <option value="partial_match">Partial Match</option>
            <option value="exception">Exception</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
          </select>
          <button
            onClick={handleExportCsv}
            disabled={exporting}
            style={{ padding: '0.5rem 1rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', background: COLORS.cardBg, cursor: exporting ? 'not-allowed' : 'pointer', fontSize: '0.875rem', color: COLORS.textSecondary, fontWeight: 500 }}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <Link href="/invoices/new" style={{ background: COLORS.textPrimary, color: COLORS.white, padding: '0.5rem 1.25rem', borderRadius: '6px', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
            + New Invoice
          </Link>
        </div>
      </div>

      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', boxShadow: SHADOWS.card }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted, fontSize: '0.875rem' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '4rem 2rem', textAlign: 'center', color: COLORS.textMuted }}>
            <p style={{ fontSize: '1rem', marginBottom: '0.5rem', color: COLORS.textSecondary, fontWeight: 500 }}>
              {statusFilter ? `No ${statusFilter.replace(/_/g, ' ')} invoices` : 'No invoices yet'}
            </p>
            <p style={{ fontSize: '0.875rem' }}>
              {statusFilter ? 'Try a different filter.' : 'Create an invoice to run 3-way matching against a PO and GRN.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg }}>
                  <th style={{ padding: '0.75rem 1rem', width: '36px' }}>
                    <input type="checkbox"
                      onChange={toggleAll}
                      checked={filtered.filter((i) => !['approved', 'paid', 'cancelled'].includes(i.status) && i.matchStatus !== 'exception').every((i) => selected.has(i.id)) && filtered.some((i) => !['approved', 'paid', 'cancelled'].includes(i.status))}
                    />
                  </th>
                  {['Internal #', 'Vendor Invoice #', 'Vendor', 'PO', 'Invoice Date', 'Due Date', 'Total', 'Match', 'Status'].map((col) => (
                    <th key={col} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv, idx) => {
                  const isOverdue = inv.dueDate && !['approved', 'paid', 'cancelled'].includes(inv.status) && new Date(inv.dueDate) < new Date();
                  const canSelect = !['approved', 'paid', 'cancelled'].includes(inv.status) && inv.matchStatus !== 'exception';
                  return (
                    <tr key={inv.id} style={{ borderBottom: idx < filtered.length - 1 ? `1px solid ${COLORS.contentBg}` : undefined, background: isOverdue ? '#fff7f7' : undefined }}>
                      <td style={{ padding: '0.875rem 1rem' }}>
                        {canSelect && (
                          <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleSelect(inv.id)} />
                        )}
                      </td>
                      <td style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>
                        <Link href={`/invoices/${inv.id}`} style={{ color: COLORS.accentBlueDark, textDecoration: 'none' }}>{inv.internalNumber}</Link>
                      </td>
                      <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{inv.invoiceNumber}</td>
                      <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{inv.vendor?.name ?? '—'}</td>
                      <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{inv.purchaseOrder?.number ?? '—'}</td>
                      <td style={{ padding: '0.875rem 1rem', color: COLORS.textSecondary }}>{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                      <td style={{ padding: '0.875rem 1rem', color: isOverdue ? COLORS.accentRedDark : COLORS.textSecondary, fontWeight: isOverdue ? 600 : 400 }}>
                        {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}
                        {isOverdue && <span style={{ marginLeft: '0.25rem', fontSize: '0.7rem' }}>OVERDUE</span>}
                      </td>
                      <td style={{ padding: '0.875rem 1rem', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(inv.totalAmount, inv.currency)}</td>
                      <td style={{ padding: '0.875rem 1rem' }}>
                        <Badge label={inv.matchStatus} colors={MATCH_COLORS[inv.matchStatus] ?? MATCH_COLORS.unmatched} />
                      </td>
                      <td style={{ padding: '0.875rem 1rem' }}>
                        <Badge label={inv.status} colors={STATUS_COLORS[inv.status] ?? STATUS_COLORS.draft} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
