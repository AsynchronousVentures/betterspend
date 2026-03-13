'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';
import Breadcrumbs from '../../../components/breadcrumbs';

interface POLine {
  id: string;
  lineNumber?: number;
  description: string;
  qty: string | number;
  uom: string;
  unitPrice: string | number;
  contractComplianceStatus?: string | null;
  contractComplianceDeltaPercent?: string | null;
  matchedContractId?: string | null;
  contractedUnitPrice?: string | null;
}

interface POVersion {
  id: string;
  version: number;
  changeReason: string | null;
  createdAt: string;
}

interface BlanketRelease {
  id: string;
  releaseNumber: number;
  amount: string;
  description: string | null;
  status: string;
  createdAt: string;
}

interface ReceivingLine {
  poLineId: string;
  lineNumber: string;
  description: string;
  orderedQty: string;
  uom: string;
  receivedQty: string;
  rejectedQty: string;
  outstandingQty: string;
  receivedPct: string;
  grnCount: number;
}

interface PurchaseOrder {
  id: string;
  number: string;
  vendor: { name: string } | null;
  version: number;
  status: string;
  currency: string;
  paymentTerms: string | null;
  notes: string | null;
  totalAmount: string | null;
  issuedAt: string | null;
  createdAt: string;
  poType: string;
  blanketStartDate: string | null;
  blanketEndDate: string | null;
  blanketTotalLimit: string | null;
  blanketReleasedAmount: string | null;
  lines: POLine[];
  versions?: POVersion[];
}

const STATUS_COLORS: Record<string, { background: string; color: string }> = {
  draft: { background: COLORS.hoverBg, color: COLORS.textSecondary },
  approved: { background: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
  issued: { background: '#dbeafe', color: '#1e40af' },
  received: { background: COLORS.accentPurpleLight, color: COLORS.accentPurpleDark },
  invoiced: { background: '#ffedd5', color: '#9a3412' },
  closed: { background: COLORS.hoverBg, color: COLORS.textSecondary },
  cancelled: { background: COLORS.accentRedLight, color: COLORS.accentRedDark },
  partially_received: { background: COLORS.accentAmberLight, color: COLORS.accentAmberDark },
};

const RELEASE_STATUS_COLORS: Record<string, { background: string; color: string }> = {
  approved: { background: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
  cancelled: { background: COLORS.accentRedLight, color: COLORS.accentRedDark },
  draft: { background: COLORS.hoverBg, color: COLORS.textSecondary },
};

function formatCurrency(amount: string | number | null, currency = 'USD') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState('');
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [changeError, setChangeError] = useState('');
  const [changeSubmitting, setChangeSubmitting] = useState(false);
  const [releases, setReleases] = useState<BlanketRelease[]>([]);
  const [receivingLines, setReceivingLines] = useState<ReceivingLine[]>([]);
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [complianceReport, setComplianceReport] = useState<any>(null);
  const [releaseAmount, setReleaseAmount] = useState('');
  const [releaseDesc, setReleaseDesc] = useState('');
  const [releaseError, setReleaseError] = useState('');
  const [releaseSubmitting, setReleaseSubmitting] = useState(false);

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.purchaseOrders.get(pid)
        .then((data) => {
          setPo(data);
          if (data.poType === 'blanket') {
            api.purchaseOrders.releases(pid).then(setReleases).catch(() => {});
          }
          // Always fetch receiving summary for progress tracking
          api.purchaseOrders.receivingSummary(pid).then(setReceivingLines).catch(() => {});
          // Fetch compliance report
          api.purchaseOrders.complianceReport(pid).then(setComplianceReport).catch(() => {});
        })
        .catch(() => setPo(null))
        .finally(() => setLoading(false));
    });
  }, [params]);

  async function issuePO() {
    setActionError('');
    setActionLoading('issue');
    try {
      await api.purchaseOrders.issue(id);
      const updated = await api.purchaseOrders.get(id);
      setPo(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Issue failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function submitChangeOrder() {
    if (!changeReason.trim()) { setChangeError('Change reason is required.'); return; }
    setChangeError('');
    setChangeSubmitting(true);
    try {
      await api.purchaseOrders.changeOrder(id, { changeReason: changeReason.trim() });
      setChangeDialogOpen(false);
      setChangeReason('');
      const updated = await api.purchaseOrders.get(id);
      setPo(updated);
    } catch (err) {
      setChangeError(err instanceof Error ? err.message : 'Change order failed');
    } finally {
      setChangeSubmitting(false);
    }
  }

  async function submitRelease() {
    if (!releaseAmount || parseFloat(releaseAmount) <= 0) { setReleaseError('Enter a valid amount.'); return; }
    setReleaseError('');
    setReleaseSubmitting(true);
    try {
      await api.purchaseOrders.createRelease(id, { amount: parseFloat(releaseAmount), description: releaseDesc || undefined });
      setReleaseDialogOpen(false);
      setReleaseAmount('');
      setReleaseDesc('');
      const [updated, updatedReleases] = await Promise.all([
        api.purchaseOrders.get(id),
        api.purchaseOrders.releases(id),
      ]);
      setPo(updated);
      setReleases(updatedReleases);
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : 'Release creation failed');
    } finally {
      setReleaseSubmitting(false);
    }
  }

  async function cancelRelease(releaseId: string) {
    if (!confirm('Cancel this release?')) return;
    try {
      await api.purchaseOrders.cancelRelease(id, releaseId);
      const [updated, updatedReleases] = await Promise.all([
        api.purchaseOrders.get(id),
        api.purchaseOrders.releases(id),
      ]);
      setPo(updated);
      setReleases(updatedReleases);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Cancel release failed');
    }
  }

  if (loading) return <div style={{ padding: '2rem', color: COLORS.textMuted, fontSize: '0.875rem' }}>Loading…</div>;
  if (!po) return (
    <div style={{ padding: '2rem', color: COLORS.textSecondary }}>
      Purchase order not found. <Link href="/purchase-orders" style={{ color: COLORS.accentBlueDark }}>Back to list</Link>
    </div>
  );

  const lines = po.lines ?? [];
  const versions = po.versions ?? [];
  const statusStyle = STATUS_COLORS[po.status] ?? { background: COLORS.hoverBg, color: COLORS.textSecondary };
  const canIssue = po.status === 'draft' || po.status === 'approved';
  const canChangeOrder = po.status !== 'closed' && po.status !== 'cancelled';
  const canCancel = po.status !== 'closed' && po.status !== 'cancelled' && po.status !== 'received';
  const canReceive = ['approved', 'issued', 'partially_received'].includes(po.status);
  const isBlanket = po.poType === 'blanket';
  const canCreateRelease = isBlanket && ['issued', 'approved', 'partially_received'].includes(po.status);

  const blanketLimit = po.blanketTotalLimit ? parseFloat(po.blanketTotalLimit) : null;
  const blanketReleased = parseFloat(po.blanketReleasedAmount ?? '0');
  const blanketRemaining = blanketLimit !== null ? blanketLimit - blanketReleased : null;
  const blanketPct = blanketLimit && blanketLimit > 0 ? (blanketReleased / blanketLimit) * 100 : 0;

  async function cancelPO() {
    if (!confirm('Cancel this purchase order?')) return;
    setActionError('');
    setActionLoading('cancel');
    try {
      await api.purchaseOrders.cancel(id);
      const updated = await api.purchaseOrders.get(id);
      setPo(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function downloadPDF() {
    try {
      const res = await api.purchaseOrders.pdf(id);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${po?.number ?? 'purchase-order'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'PDF download failed');
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '960px' }}>
      <Breadcrumbs items={[{ label: 'Purchase Orders', href: '/purchase-orders' }, { label: po.number }]} />
      <Link href="/purchase-orders" style={{ color: COLORS.textSecondary, fontSize: '0.875rem', textDecoration: 'none' }}>
        &larr; Back to Purchase Orders
      </Link>

      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginTop: '1rem', marginBottom: '1.25rem', boxShadow: SHADOWS.card }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>{po.number}</h1>
              <span style={{ fontSize: '0.8rem', color: COLORS.textSecondary, fontWeight: 500 }}>V{po.version ?? 1}</span>
              <span style={{ ...statusStyle, padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.8rem', fontWeight: 600 }}>
                {po.status.replace('_', ' ')}
              </span>
              {isBlanket && (
                <span style={{ background: COLORS.accentAmberLight, color: COLORS.accentAmberDark, padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.8rem', fontWeight: 600 }}>
                  Blanket PO
                </span>
              )}
            </div>
            <p style={{ margin: '0.375rem 0 0', fontSize: '0.95rem', color: COLORS.textSecondary }}>{po.vendor?.name ?? 'No vendor assigned'}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.textPrimary }}>{formatCurrency(po.totalAmount, po.currency)}</div>
            <div style={{ fontSize: '0.8rem', color: COLORS.textSecondary }}>{po.currency}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '2rem', marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: `1px solid ${COLORS.hoverBg}`, flexWrap: 'wrap' }}>
          {[
            { label: 'Payment Terms', value: po.paymentTerms ?? '—' },
            { label: 'Created', value: new Date(po.createdAt).toLocaleDateString() },
            { label: 'Issued', value: po.issuedAt ? new Date(po.issuedAt).toLocaleDateString() : '—' },
          ].map((item) => (
            <div key={item.label}>
              <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</div>
              <div style={{ fontSize: '0.875rem', color: COLORS.textSecondary, marginTop: '0.25rem' }}>{item.value}</div>
            </div>
          ))}
        </div>
        {po.notes && (
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${COLORS.hoverBg}` }}>
            <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.375rem' }}>Notes</div>
            <p style={{ margin: 0, fontSize: '0.875rem', color: COLORS.textSecondary }}>{po.notes}</p>
          </div>
        )}
      </div>

      {/* Blanket PO Summary */}
      {isBlanket && (
        <div style={{ background: COLORS.accentAmberLight, border: '1px solid #fde68a', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 600, color: COLORS.accentAmberDark }}>Blanket PO Summary</h2>
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginBottom: blanketLimit ? '1rem' : '0' }}>
            {po.blanketStartDate && (
              <div>
                <div style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600, textTransform: 'uppercase' }}>Start Date</div>
                <div style={{ fontSize: '0.875rem', color: '#78350f', marginTop: '0.25rem' }}>{new Date(po.blanketStartDate).toLocaleDateString()}</div>
              </div>
            )}
            {po.blanketEndDate && (
              <div>
                <div style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600, textTransform: 'uppercase' }}>End Date</div>
                <div style={{ fontSize: '0.875rem', color: '#78350f', marginTop: '0.25rem' }}>{new Date(po.blanketEndDate).toLocaleDateString()}</div>
              </div>
            )}
            {blanketLimit !== null && (
              <>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600, textTransform: 'uppercase' }}>Total Limit</div>
                  <div style={{ fontSize: '0.875rem', color: '#78350f', marginTop: '0.25rem' }}>{formatCurrency(blanketLimit, po.currency)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600, textTransform: 'uppercase' }}>Released</div>
                  <div style={{ fontSize: '0.875rem', color: '#78350f', marginTop: '0.25rem' }}>{formatCurrency(blanketReleased, po.currency)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600, textTransform: 'uppercase' }}>Remaining</div>
                  <div style={{ fontSize: '0.875rem', color: blanketRemaining! < 0 ? COLORS.accentRedDark : '#78350f', marginTop: '0.25rem', fontWeight: 600 }}>
                    {formatCurrency(blanketRemaining, po.currency)}
                  </div>
                </div>
              </>
            )}
          </div>
          {blanketLimit !== null && (
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ height: '8px', background: '#fde68a', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, blanketPct)}%`,
                  background: blanketPct >= 100 ? COLORS.accentRedDark : blanketPct >= 80 ? COLORS.accentAmber : '#059669',
                  borderRadius: '4px',
                  transition: 'width 0.3s',
                }} />
              </div>
              <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.25rem' }}>{blanketPct.toFixed(1)}% utilized</div>
            </div>
          )}
        </div>
      )}

      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', marginBottom: '1.25rem', boxShadow: SHADOWS.card }}>
        <div style={{ padding: '1rem 1.5rem', borderBottom: `1px solid ${COLORS.tableBorder}` }}>
          <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: COLORS.textPrimary }}>Line Items</h2>
        </div>
        {lines.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: COLORS.textMuted, fontSize: '0.875rem' }}>No line items</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                  {['#', 'Description', 'Qty', 'UOM', 'Unit Price', 'Total'].map((col) => (
                    <th key={col} style={{ padding: '0.625rem 1rem', textAlign: col === 'Qty' || col === 'Unit Price' || col === 'Total' ? 'right' : 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => {
                  const lineTotal = (Number(line.qty) || 0) * (Number(line.unitPrice) || 0);
                  return (
                    <tr key={line.id} style={{ borderBottom: idx < lines.length - 1 ? `1px solid ${COLORS.hoverBg}` : undefined }}>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textMuted, width: '2rem' }}>{idx + 1}</td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{line.description}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: COLORS.textSecondary }}>{Number(line.qty)}</td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{line.uom}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: COLORS.textSecondary }}>{formatCurrency(line.unitPrice, po.currency)}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600, color: COLORS.textPrimary }}>{formatCurrency(lineTotal, po.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg }}>
                  <td colSpan={5} style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.875rem' }}>Total</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: COLORS.textPrimary }}>{formatCurrency(po.totalAmount, po.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Contract Compliance Panel */}
      {complianceReport && complianceReport.lines && complianceReport.lines.length > 0 && (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', marginBottom: '1.25rem', boxShadow: SHADOWS.card }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: `1px solid ${COLORS.tableBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: COLORS.textPrimary }}>Contract Compliance</h2>
            <span style={{ fontSize: '0.8rem', color: COLORS.textSecondary }}>
              {complianceReport.summary?.compliantLines ?? 0} of {complianceReport.summary?.totalLines ?? 0} lines compliant
              {(complianceReport.summary?.deviationLines ?? 0) > 0 && (
                <span style={{ marginLeft: '0.5rem', background: COLORS.accentAmberLight, color: COLORS.accentAmberDark, padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                  {complianceReport.summary.deviationLines} deviation{complianceReport.summary.deviationLines > 1 ? 's' : ''}
                </span>
              )}
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                  {['#', 'Description', 'Unit Price', 'Contract Price', 'Delta', 'Status'].map((col) => (
                    <th key={col} style={{ padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {complianceReport.lines.map((cl: any, idx: number) => {
                  const st = cl.contractComplianceStatus ?? 'no_contract';
                  const delta = cl.contractComplianceDeltaPercent ? parseFloat(cl.contractComplianceDeltaPercent) : null;
                  let statusBg: string = COLORS.hoverBg;
                  let statusColor: string = COLORS.textMuted;
                  let statusLabel = 'No contract';
                  if (st === 'compliant') { statusBg = COLORS.accentGreenLight; statusColor = COLORS.accentGreenDark; statusLabel = 'Compliant'; }
                  else if (st === 'deviation') { statusBg = COLORS.accentAmberLight; statusColor = COLORS.accentAmberDark; statusLabel = 'Deviation'; }
                  else if (st === 'exempt') { statusBg = COLORS.accentBlueLight; statusColor = '#1e40af'; statusLabel = 'Exempt'; }
                  return (
                    <tr key={cl.id} style={{ borderBottom: idx < complianceReport.lines.length - 1 ? `1px solid ${COLORS.hoverBg}` : undefined }}>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textMuted, width: '2rem' }}>{cl.lineNumber ?? idx + 1}</td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{cl.description}</td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{cl.unitPrice != null ? formatCurrency(cl.unitPrice, po.currency) : '—'}</td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{cl.contractedUnitPrice != null ? formatCurrency(cl.contractedUnitPrice, po.currency) : '—'}</td>
                      <td style={{ padding: '0.75rem 1rem', color: delta != null && delta > 0 ? COLORS.accentAmberDark : COLORS.textMuted }}>
                        {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ background: statusBg, color: statusColor, padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                          {statusLabel}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Receiving Progress */}
      {receivingLines.length > 0 && (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', marginBottom: '1.25rem', boxShadow: SHADOWS.card }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: `1px solid ${COLORS.tableBorder}` }}>
            <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: COLORS.textPrimary }}>Receiving Progress</h2>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                  {['#', 'Description', 'Ordered', 'Received', 'Rejected', 'Outstanding', 'Progress'].map((col) => (
                    <th key={col} style={{ padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {receivingLines.map((line, idx) => {
                  const pct = Math.min(100, parseFloat(line.receivedPct ?? '0'));
                  const barColor = pct >= 100 ? '#059669' : pct >= 50 ? COLORS.accentBlue : COLORS.accentAmber;
                  return (
                    <tr key={line.poLineId} style={{ borderBottom: idx < receivingLines.length - 1 ? `1px solid ${COLORS.hoverBg}` : undefined }}>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textMuted, width: '2rem' }}>{line.lineNumber}</td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{line.description}</td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{Number(line.orderedQty)} {line.uom}</td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.accentGreenDark, fontWeight: 600 }}>{Number(line.receivedQty)}</td>
                      <td style={{ padding: '0.75rem 1rem', color: parseFloat(line.rejectedQty) > 0 ? COLORS.accentRedDark : COLORS.textMuted }}>{Number(line.rejectedQty)}</td>
                      <td style={{ padding: '0.75rem 1rem', color: parseFloat(line.outstandingQty) > 0 ? COLORS.accentAmberDark : COLORS.textMuted, fontWeight: parseFloat(line.outstandingQty) > 0 ? 600 : 400 }}>
                        {Number(line.outstandingQty)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', minWidth: '120px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ flex: 1, height: '6px', background: COLORS.tableBorder, borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: '3px', transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize: '0.75rem', color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Blanket Releases */}
      {isBlanket && (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', marginBottom: '1.25rem', boxShadow: SHADOWS.card }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: `1px solid ${COLORS.tableBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: COLORS.textPrimary }}>Releases ({releases.length})</h2>
            {canCreateRelease && (
              <button onClick={() => setReleaseDialogOpen(true)}
                style={{ background: COLORS.textPrimary, color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.4rem 0.875rem', fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer' }}>
                + New Release
              </button>
            )}
          </div>
          {releases.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: COLORS.textMuted, fontSize: '0.875rem' }}>No releases yet</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                    {['Release #', 'Amount', 'Description', 'Status', 'Date', ''].map((col) => (
                      <th key={col} style={{ padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {releases.map((r, idx) => {
                    const rStatusStyle = RELEASE_STATUS_COLORS[r.status] ?? { background: COLORS.hoverBg, color: COLORS.textSecondary };
                    return (
                      <tr key={r.id} style={{ borderBottom: idx < releases.length - 1 ? `1px solid ${COLORS.hoverBg}` : undefined }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: COLORS.textSecondary }}>#{r.releaseNumber}</td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: COLORS.textPrimary }}>{formatCurrency(r.amount, po.currency)}</td>
                        <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{r.description ?? '—'}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{ ...rStatusStyle, padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>{r.status}</span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{new Date(r.createdAt).toLocaleDateString()}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          {r.status !== 'cancelled' && (
                            <button onClick={() => cancelRelease(r.id)}
                              style={{ background: 'none', border: '1px solid #fca5a5', color: COLORS.accentRedDark, borderRadius: '4px', padding: '0.2rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer' }}>
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {versions.length > 0 && (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', overflow: 'hidden', marginBottom: '1.25rem', boxShadow: SHADOWS.card }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: `1px solid ${COLORS.tableBorder}` }}>
            <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: COLORS.textPrimary }}>Version History</h2>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                  {['Version', 'Change Reason', 'Date'].map((col) => (
                    <th key={col} style={{ padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {versions.map((v, idx) => (
                  <tr key={v.id} style={{ borderBottom: idx < versions.length - 1 ? `1px solid ${COLORS.hoverBg}` : undefined }}>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: COLORS.textSecondary }}>V{v.version}</td>
                    <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{v.changeReason ?? <span style={{ color: COLORS.inputBorder, fontStyle: 'italic' }}>Initial version</span>}</td>
                    <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{new Date(v.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {canIssue && (
          <button onClick={issuePO} disabled={actionLoading !== null}
            style={{ background: COLORS.accentBlueDark, color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.7 : 1 }}>
            {actionLoading === 'issue' ? 'Issuing…' : 'Issue PO'}
          </button>
        )}
        <button onClick={downloadPDF}
          style={{ background: COLORS.white, color: COLORS.textSecondary, border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>
          Download PDF
        </button>
        {canReceive && (
          <Link href={`/receiving/new?poId=${id}`}
            style={{ background: '#059669', color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
            Create GRN
          </Link>
        )}
        {canChangeOrder && (
          <button onClick={() => setChangeDialogOpen(true)} disabled={actionLoading !== null}
            style={{ background: COLORS.white, color: COLORS.textSecondary, border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>
            Change Order
          </button>
        )}
        {canCancel && (
          <button onClick={cancelPO} disabled={actionLoading !== null}
            style={{ background: COLORS.white, color: COLORS.accentRedDark, border: `1px solid ${COLORS.accentRedDark}`, borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 500, cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.7 : 1 }}>
            {actionLoading === 'cancel' ? 'Cancelling…' : 'Cancel PO'}
          </button>
        )}
      </div>
      {actionError && <div style={{ marginTop: '0.75rem', background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.625rem 1rem', color: COLORS.accentRedDark, fontSize: '0.875rem' }}>{actionError}</div>}

      {/* Change Order Dialog */}
      {changeDialogOpen && (
        <div style={{ position: 'fixed', inset: 0, background: SHADOWS.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={(e) => { if (e.target === e.currentTarget) setChangeDialogOpen(false); }}>
          <div style={{ background: COLORS.white, borderRadius: '10px', padding: '1.75rem', width: '100%', maxWidth: '480px', boxShadow: SHADOWS.dropdown }}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.textPrimary }}>Create Change Order</h2>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: COLORS.textSecondary }}>Describe the reason for this change order. A new version of the PO will be created.</p>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '0.375rem' }}>Change Reason <span style={{ color: COLORS.accentRed }}>*</span></label>
            <textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={4}
              placeholder="e.g. Updated pricing agreed with vendor"
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box', resize: 'vertical' }} />
            {changeError && <div style={{ marginTop: '0.75rem', background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.5rem 0.75rem', color: COLORS.accentRedDark, fontSize: '0.8rem' }}>{changeError}</div>}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setChangeDialogOpen(false); setChangeReason(''); setChangeError(''); }}
                style={{ background: COLORS.white, color: COLORS.textSecondary, border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', padding: '0.5rem 1rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={submitChangeOrder} disabled={changeSubmitting}
                style={{ background: COLORS.textPrimary, color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.5rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: changeSubmitting ? 'not-allowed' : 'pointer', opacity: changeSubmitting ? 0.7 : 1 }}>
                {changeSubmitting ? 'Submitting…' : 'Submit Change Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Release Dialog */}
      {releaseDialogOpen && (
        <div style={{ position: 'fixed', inset: 0, background: SHADOWS.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={(e) => { if (e.target === e.currentTarget) setReleaseDialogOpen(false); }}>
          <div style={{ background: COLORS.white, borderRadius: '10px', padding: '1.75rem', width: '100%', maxWidth: '420px', boxShadow: SHADOWS.dropdown }}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.textPrimary }}>New Blanket Release</h2>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: COLORS.textSecondary }}>
              Release funds against this blanket PO.
              {blanketRemaining !== null && ` Remaining: ${formatCurrency(blanketRemaining, po.currency)}`}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '0.375rem' }}>Amount ({po.currency}) *</label>
                <input type="number" min="0.01" step="0.01" value={releaseAmount} onChange={(e) => setReleaseAmount(e.target.value)}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '0.375rem' }}>Description</label>
                <input value={releaseDesc} onChange={(e) => setReleaseDesc(e.target.value)}
                  placeholder="e.g. Q1 office supplies"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }} />
              </div>
            </div>
            {releaseError && <div style={{ marginTop: '0.75rem', background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.5rem 0.75rem', color: COLORS.accentRedDark, fontSize: '0.8rem' }}>{releaseError}</div>}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setReleaseDialogOpen(false); setReleaseAmount(''); setReleaseDesc(''); setReleaseError(''); }}
                style={{ background: COLORS.white, color: COLORS.textSecondary, border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', padding: '0.5rem 1rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={submitRelease} disabled={releaseSubmitting}
                style={{ background: COLORS.textPrimary, color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.5rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: releaseSubmitting ? 'not-allowed' : 'pointer', opacity: releaseSubmitting ? 0.7 : 1 }}>
                {releaseSubmitting ? 'Creating…' : 'Create Release'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
