'use client';

import { useState, useEffect, Suspense, FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

function fmt(amount: number | string | null | undefined, currency = 'USD') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#f1f5f9', text: '#475569' },
  issued: { bg: '#eff6ff', text: '#1d4ed8' },
  partially_received: { bg: '#fffbeb', text: '#92400e' },
  received: { bg: '#ecfdf5', text: '#065f46' },
  cancelled: { bg: '#fef2f2', text: '#991b1b' },
  pending_match: { bg: '#f1f5f9', text: '#475569' },
  matched: { bg: '#ecfdf5', text: '#065f46' },
  partial_match: { bg: '#fffbeb', text: '#92400e' },
  exception: { bg: '#fef2f2', text: '#991b1b' },
  approved: { bg: '#eff6ff', text: '#1d4ed8' },
  paid: { bg: '#ecfdf5', text: '#065f46' },
};

function StatusBadge({ status }: { status: string }) {
  const sc = STATUS_COLORS[status] ?? { bg: '#f1f5f9', text: '#475569' };
  return (
    <span style={{
      padding: '0.15rem 0.5rem',
      borderRadius: '999px',
      fontSize: '0.7rem',
      fontWeight: 600,
      background: sc.bg,
      color: sc.text,
      textTransform: 'capitalize',
      whiteSpace: 'nowrap',
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: COLORS.cardBg,
      border: `1px solid ${COLORS.tableBorder}`,
      borderRadius: '10px',
      padding: '1.25rem 1.5rem',
      boxShadow: SHADOWS.card,
      flex: 1,
      minWidth: '160px',
    }}>
      <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginBottom: '0.35rem', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.textPrimary }}>{value}</div>
    </div>
  );
}

interface InvoiceLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unitPrice: number;
  poLineId?: string;
}

interface SubmitInvoiceModalProps {
  token: string;
  purchaseOrders: any[];
  onClose: () => void;
  onSuccess: () => void;
}

function SubmitInvoiceModal({ token, purchaseOrders, onClose, onSuccess }: SubmitInvoiceModalProps) {
  const [selectedPoId, setSelectedPoId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<InvoiceLine[]>([
    { lineNumber: 1, description: '', quantity: 1, unitPrice: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const issuedPOs = purchaseOrders.filter((po: any) => po.status === 'issued' || po.status === 'partially_received' || po.status === 'received');

  function addLine() {
    setLines((prev) => [...prev, { lineNumber: prev.length + 1, description: '', quantity: 1, unitPrice: 0 }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx).map((l, i) => ({ ...l, lineNumber: i + 1 })));
  }

  function updateLine(idx: number, field: keyof InvoiceLine, value: string | number) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedPoId) { setError('Please select a purchase order.'); return; }
    if (!invoiceNumber.trim()) { setError('Invoice number is required.'); return; }
    if (lines.some((l) => !l.description.trim())) { setError('All line items need a description.'); return; }

    setSubmitting(true);
    setError('');
    try {
      await api.vendorPortal.submitInvoice(token, {
        purchaseOrderId: selectedPoId,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        dueDate: dueDate || undefined,
        lines: lines.map((l) => ({
          lineNumber: l.lineNumber,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
        })),
      });
      onSuccess();
    } catch (e: any) {
      setError(e.message || 'Failed to submit invoice.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: `1px solid ${COLORS.inputBorder}`,
    borderRadius: '6px',
    fontSize: '0.875rem',
    boxSizing: 'border-box',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        background: COLORS.cardBg, borderRadius: '12px',
        width: '100%', maxWidth: '640px',
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        padding: '2rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>Submit Invoice</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: COLORS.textMuted }}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>
                Purchase Order *
              </label>
              <select required value={selectedPoId} onChange={(e) => setSelectedPoId(e.target.value)} style={inputStyle}>
                <option value="">Select a PO...</option>
                {issuedPOs.map((po: any) => (
                  <option key={po.id} value={po.id}>
                    {po.internalNumber} — {fmt(po.totalAmount, po.currency)}
                  </option>
                ))}
              </select>
              {issuedPOs.length === 0 && (
                <p style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginTop: '0.25rem' }}>
                  No issued purchase orders available to invoice against.
                </p>
              )}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>
                Your Invoice Number *
              </label>
              <input required value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} style={inputStyle} placeholder="INV-001" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>
                Invoice Date *
              </label>
              <input required type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>
                Due Date
              </label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: COLORS.textSecondary }}>Line Items *</label>
              <button type="button" onClick={addLine} style={{
                padding: '0.25rem 0.75rem', background: COLORS.accentBlueLight, color: COLORS.accentBlueDark,
                border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
              }}>
                + Add Line
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {lines.map((line, idx) => (
                <div key={idx} style={{
                  display: 'grid', gridTemplateColumns: '1fr 80px 100px 28px',
                  gap: '0.5rem', alignItems: 'center',
                  padding: '0.5rem', background: COLORS.hoverBg, borderRadius: '6px',
                }}>
                  <input
                    required
                    placeholder={`Line ${line.lineNumber} description`}
                    value={line.description}
                    onChange={(e) => updateLine(idx, 'description', e.target.value)}
                    style={{ ...inputStyle, background: COLORS.cardBg }}
                  />
                  <input
                    required
                    type="number"
                    min="0.001"
                    step="any"
                    placeholder="Qty"
                    value={line.quantity}
                    onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                    style={{ ...inputStyle, background: COLORS.cardBg }}
                  />
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Unit Price"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                    style={{ ...inputStyle, background: COLORS.cardBg }}
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    disabled={lines.length === 1}
                    style={{
                      background: 'none', border: 'none', cursor: lines.length === 1 ? 'not-allowed' : 'pointer',
                      color: COLORS.accentRedDark, fontSize: '1rem', padding: '0.25rem',
                    }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'right', marginTop: '0.5rem', fontSize: '0.9rem', fontWeight: 600, color: COLORS.textPrimary }}>
              Total: {fmt(total)}
            </div>
          </div>

          {error && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px',
              padding: '0.75rem', color: '#991b1b', fontSize: '0.875rem', marginBottom: '1rem',
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{
              padding: '0.625rem 1.25rem', background: COLORS.tableBorder, color: COLORS.textSecondary,
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500,
            }}>
              Cancel
            </button>
            <button type="submit" disabled={submitting || issuedPOs.length === 0} style={{
              padding: '0.625rem 1.25rem', background: COLORS.accentBlue, color: COLORS.white,
              border: 'none', borderRadius: '6px', cursor: submitting ? 'not-allowed' : 'pointer', fontWeight: 600,
            }}>
              {submitting ? 'Submitting...' : 'Submit Invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function VendorPortalContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'pos' | 'invoices' | 'catalog'>('overview');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [catalogData, setCatalogData] = useState<{ items: any[]; proposals: any[] } | null>(null);
  const [proposalForm, setProposalForm] = useState({
    itemId: '',
    proposedPrice: '',
    effectiveDate: '',
    note: '',
  });
  const [proposalSaving, setProposalSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api.vendorPortal
      .dashboard(token)
      .then(setData)
      .catch((e) => setError(e.message || 'Failed to load portal data.'))
      .finally(() => setLoading(false));
    api.vendorPortal.catalog(token).then(setCatalogData).catch(() => {});
  }, [token, submitSuccess]);

  if (!token) {
    return (
      <div style={{
        minHeight: '100vh', background: '#f8fafc',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem',
      }}>
        <div style={{
          background: COLORS.cardBg, borderRadius: '12px', padding: '3rem 2.5rem',
          boxShadow: SHADOWS.auth, textAlign: 'center', maxWidth: '480px', width: '100%',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#128274;</div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: COLORS.textPrimary, margin: '0 0 0.75rem' }}>
            Vendor Portal Access Required
          </h1>
          <p style={{ color: COLORS.textSecondary, fontSize: '0.9375rem', margin: 0, lineHeight: 1.6 }}>
            To access the vendor portal, please use the access link sent to you by your buyer.
            Contact your buyer to request a new access link if yours has expired.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.textSecondary }}>
        Loading vendor portal...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh', background: '#f8fafc',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem',
      }}>
        <div style={{
          background: COLORS.cardBg, borderRadius: '12px', padding: '3rem 2.5rem',
          boxShadow: SHADOWS.auth, textAlign: 'center', maxWidth: '480px', width: '100%',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#9888;&#65039;</div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: COLORS.accentRedDark, margin: '0 0 0.75rem' }}>
            Access Denied
          </h1>
          <p style={{ color: COLORS.textSecondary, fontSize: '0.9375rem', margin: 0, lineHeight: 1.6 }}>
            {error}. Please contact your buyer for a new access link.
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { vendor, purchaseOrders, invoices: invoiceList, stats } = data;

  const tabs = [
    { key: 'overview' as const, label: 'Overview' },
    { key: 'pos' as const, label: `Purchase Orders (${purchaseOrders.length})` },
    { key: 'invoices' as const, label: `Invoices (${invoiceList.length})` },
    { key: 'catalog' as const, label: `Catalog & Pricing (${catalogData?.items.length ?? 0})` },
  ];

  async function submitPriceProposal(e: FormEvent) {
    e.preventDefault();
    setProposalSaving(true);
    setError('');
    try {
      await api.vendorPortal.submitPriceProposal(token, {
        itemId: proposalForm.itemId,
        proposedPrice: parseFloat(proposalForm.proposedPrice),
        effectiveDate: proposalForm.effectiveDate ? new Date(proposalForm.effectiveDate).toISOString() : undefined,
        note: proposalForm.note || undefined,
      });
      setProposalForm({ itemId: '', proposedPrice: '', effectiveDate: '', note: '' });
      setCatalogData(await api.vendorPortal.catalog(token));
    } catch (e: any) {
      setError(e.message || 'Failed to submit price proposal.');
    } finally {
      setProposalSaving(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      {/* Header */}
      <div style={{
        background: '#0f172a', color: '#f8fafc',
        padding: '1rem 2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.2rem', fontWeight: 500 }}>VENDOR PORTAL</div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>{vendor.name}</h1>
        </div>
        <button
          onClick={() => setShowInvoiceModal(true)}
          style={{
            padding: '0.625rem 1.25rem',
            background: '#3b82f6', color: '#fff',
            border: 'none', borderRadius: '8px',
            cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
          }}
        >
          Submit Invoice
        </button>
      </div>

      <div style={{ maxWidth: '1024px', margin: '0 auto', padding: '2rem 1.5rem' }}>
        {submitSuccess && (
          <div style={{
            background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px',
            padding: '0.875rem 1.25rem', color: '#065f46', marginBottom: '1.5rem', fontWeight: 500,
          }}>
            Invoice submitted successfully! It will be matched against your purchase order.
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: `1px solid ${COLORS.tableBorder}` }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '0.625rem 1.25rem',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab.key ? `2px solid ${COLORS.accentBlue}` : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? COLORS.accentBlue : COLORS.textSecondary,
                marginBottom: '-1px',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <StatCard label="Total Purchase Orders" value={String(stats.totalPOs)} />
              <StatCard label="Total Invoiced" value={fmt(stats.totalInvoiced)} />
              <StatCard label="Pending Payment" value={fmt(stats.pendingPayment)} />
            </div>

            {/* Vendor info card */}
            <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '10px', padding: '1.5rem', boxShadow: SHADOWS.card }}>
              <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: COLORS.textSecondary, margin: '0 0 1rem' }}>Your Account</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {vendor.taxId && (
                  <div>
                    <div style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>Tax ID</div>
                    <div style={{ fontSize: '0.875rem', color: COLORS.textPrimary }}>{vendor.taxId}</div>
                  </div>
                )}
                {vendor.paymentTerms && (
                  <div>
                    <div style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>Payment Terms</div>
                    <div style={{ fontSize: '0.875rem', color: COLORS.textPrimary }}>{vendor.paymentTerms}</div>
                  </div>
                )}
                {(vendor.contactInfo as any)?.email && (
                  <div>
                    <div style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>Contact Email</div>
                    <div style={{ fontSize: '0.875rem', color: COLORS.textPrimary }}>{(vendor.contactInfo as any).email}</div>
                  </div>
                )}
                {(vendor.contactInfo as any)?.phone && (
                  <div>
                    <div style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>Phone</div>
                    <div style={{ fontSize: '0.875rem', color: COLORS.textPrimary }}>{(vendor.contactInfo as any).phone}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Purchase Orders Tab */}
        {activeTab === 'pos' && (
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '10px', boxShadow: SHADOWS.card, overflow: 'hidden' }}>
            {purchaseOrders.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted }}>No purchase orders found.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                      {['PO Number', 'Status', 'Amount', 'Issued Date'].map((h) => (
                        <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: COLORS.textSecondary }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseOrders.map((po: any) => (
                      <tr key={po.id} style={{ borderBottom: `1px solid ${COLORS.hoverBg}` }}>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textPrimary }}>
                          {po.internalNumber}
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <StatusBadge status={po.status} />
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: COLORS.textSecondary }}>
                          {fmt(po.totalAmount, po.currency)}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: COLORS.textSecondary }}>
                          {fmtDate(po.issuedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Invoices Tab */}
        {activeTab === 'invoices' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowInvoiceModal(true)}
                style={{
                  padding: '0.5rem 1rem', background: COLORS.accentBlue, color: COLORS.white,
                  border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem',
                }}
              >
                Submit New Invoice
              </button>
            </div>
            <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '10px', boxShadow: SHADOWS.card, overflow: 'hidden' }}>
              {invoiceList.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted }}>No invoices submitted yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                        {['Invoice #', 'Your Ref', 'Status', 'Match', 'Amount', 'Date'].map((h) => (
                          <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: COLORS.textSecondary }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceList.map((inv: any) => (
                        <tr key={inv.id} style={{ borderBottom: `1px solid ${COLORS.hoverBg}` }}>
                          <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textPrimary }}>
                            {inv.internalNumber}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: COLORS.textSecondary }}>
                            {inv.invoiceNumber}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <StatusBadge status={inv.status} />
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            {inv.matchStatus ? <StatusBadge status={inv.matchStatus} /> : <span style={{ color: COLORS.textMuted }}>—</span>}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: COLORS.textSecondary }}>
                            {fmt(inv.totalAmount, inv.currency)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: COLORS.textSecondary }}>
                            {fmtDate(inv.invoiceDate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'catalog' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
            <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '10px', boxShadow: SHADOWS.card, overflow: 'hidden' }}>
              <div style={{ padding: '0.875rem 1rem', borderBottom: `1px solid ${COLORS.tableBorder}`, fontWeight: 600, color: COLORS.textPrimary }}>
                Buyer Catalog
              </div>
              {!catalogData || catalogData.items.length === 0 ? (
                <div style={{ padding: '2rem', color: COLORS.textMuted }}>No catalog items are assigned to your company yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                        {['Item', 'SKU', 'Current Price', 'Category'].map((h) => (
                          <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: COLORS.textSecondary }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {catalogData.items.map((item) => (
                        <tr key={item.id} style={{ borderBottom: `1px solid ${COLORS.hoverBg}` }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 500, color: COLORS.textPrimary }}>{item.name}</td>
                          <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{item.sku ?? '—'}</td>
                          <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{fmt(item.unitPrice, item.currency)}</td>
                          <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{item.category ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <form onSubmit={submitPriceProposal} style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '10px', boxShadow: SHADOWS.card, padding: '1rem' }}>
                <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 600, color: COLORS.textPrimary }}>Submit Price Update</h3>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  <select value={proposalForm.itemId} onChange={(e) => setProposalForm((current) => ({ ...current, itemId: e.target.value }))} required style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }}>
                    <option value="">Select catalog item</option>
                    {(catalogData?.items ?? []).map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  <input value={proposalForm.proposedPrice} onChange={(e) => setProposalForm((current) => ({ ...current, proposedPrice: e.target.value }))} required type="number" min="0" step="0.01" placeholder="Proposed unit price" style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }} />
                  <input value={proposalForm.effectiveDate} onChange={(e) => setProposalForm((current) => ({ ...current, effectiveDate: e.target.value }))} type="date" style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }} />
                  <textarea value={proposalForm.note} onChange={(e) => setProposalForm((current) => ({ ...current, note: e.target.value }))} placeholder="Reason for the price update" rows={4} style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box' }} />
                  <button type="submit" disabled={proposalSaving} style={{ padding: '0.625rem 1rem', background: COLORS.accentBlue, color: COLORS.white, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                    {proposalSaving ? 'Submitting...' : 'Submit Proposal'}
                  </button>
                </div>
              </form>

              <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '10px', boxShadow: SHADOWS.card, overflow: 'hidden' }}>
                <div style={{ padding: '0.875rem 1rem', borderBottom: `1px solid ${COLORS.tableBorder}`, fontWeight: 600, color: COLORS.textPrimary }}>
                  Proposal History
                </div>
                {!catalogData || catalogData.proposals.length === 0 ? (
                  <div style={{ padding: '1rem', color: COLORS.textMuted }}>No price proposals submitted yet.</div>
                ) : (
                  <div style={{ padding: '0.5rem 0' }}>
                    {catalogData.proposals.map((proposal) => (
                      <div key={proposal.id} style={{ padding: '0.75rem 1rem', borderBottom: `1px solid ${COLORS.hoverBg}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                          <div>
                            <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>{proposal.item?.name}</div>
                            <div style={{ fontSize: '0.8rem', color: COLORS.textSecondary }}>
                              {fmt(proposal.currentPrice, proposal.item?.currency ?? 'USD')} {'->'} {fmt(proposal.proposedPrice, proposal.item?.currency ?? 'USD')}
                            </div>
                          </div>
                          <StatusBadge status={proposal.status} />
                        </div>
                        {proposal.note && <div style={{ fontSize: '0.8rem', color: COLORS.textMuted, marginTop: '0.35rem' }}>{proposal.note}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showInvoiceModal && (
        <SubmitInvoiceModal
          token={token}
          purchaseOrders={purchaseOrders}
          onClose={() => setShowInvoiceModal(false)}
          onSuccess={() => {
            setShowInvoiceModal(false);
            setSubmitSuccess(true);
            setActiveTab('invoices');
            // Trigger refresh
            setData(null);
            setLoading(true);
            api.vendorPortal
              .dashboard(token)
              .then(setData)
              .catch((e) => setError(e.message))
              .finally(() => setLoading(false));
          }}
        />
      )}
    </div>
  );
}

export default function VendorPortalPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
        Loading...
      </div>
    }>
      <VendorPortalContent />
    </Suspense>
  );
}
