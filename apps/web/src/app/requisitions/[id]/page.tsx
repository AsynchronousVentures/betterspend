'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';
import Breadcrumbs from '../../../components/breadcrumbs';

interface RequisitionLine {
  id: string;
  description: string;
  qty: string | number;
  uom: string;
  unitPrice: string | number;
}

interface Requisition {
  id: string;
  number: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  currency: string;
  totalAmount: string | null;
  neededBy: string | null;
  createdAt: string;
  lines: RequisitionLine[];
}

const STATUS_COLORS: Record<string, { background: string; color: string }> = {
  draft: { background: COLORS.hoverBg, color: COLORS.textSecondary },
  pending_approval: { background: COLORS.accentAmberLight, color: COLORS.accentAmberDark },
  approved: { background: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
  rejected: { background: COLORS.accentRedLight, color: COLORS.accentRedDark },
  cancelled: { background: COLORS.hoverBg, color: COLORS.textSecondary },
  converted: { background: '#dbeafe', color: '#1e40af' },
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', pending_approval: 'Pending Approval', approved: 'Approved',
  rejected: 'Rejected', cancelled: 'Cancelled', converted: 'Converted',
};

function formatCurrency(amount: string | number | null, currency = 'USD') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

export default function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState('');
  const [req, setReq] = useState<Requisition | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [poDialogOpen, setPoDialogOpen] = useState(false);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [poVendorId, setPoVendorId] = useState('');
  const [poPaymentTerms, setPoPaymentTerms] = useState('');
  const [poSubmitting, setPoSubmitting] = useState(false);
  const [poError, setPoError] = useState('');
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [templateOrgWide, setTemplateOrgWide] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [templateSuccess, setTemplateSuccess] = useState(false);

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.requisitions.get(pid)
        .then((data) => setReq(data))
        .catch(() => setReq(null))
        .finally(() => setLoading(false));
    });
  }, [params]);

  async function openPoDialog() {
    if (vendors.length === 0) {
      const data = await api.vendors.list().catch(() => []);
      setVendors(data as any[]);
      if ((data as any[]).length > 0) setPoVendorId((data as any[])[0].id);
    }
    setPoDialogOpen(true);
  }

  async function submitCreatePO() {
    if (!poVendorId) { setPoError('Select a vendor.'); return; }
    setPoError('');
    setPoSubmitting(true);
    try {
      const lines = (req!.lines ?? []).map((l) => ({
        description: l.description,
        quantity: Number(l.qty) || 1,
        unitOfMeasure: (l as any).uom || 'each',
        unitPrice: Number(l.unitPrice) || 0,
        requisitionLineId: l.id,
      }));
      const po = await api.purchaseOrders.create({
        vendorId: poVendorId,
        requisitionId: req!.id,
        paymentTerms: poPaymentTerms || undefined,
        currency: req!.currency,
        lines,
      }) as any;
      router.push(`/purchase-orders/${po.id}`);
    } catch (err) {
      setPoError(err instanceof Error ? err.message : 'PO creation failed');
    } finally {
      setPoSubmitting(false);
    }
  }

  async function saveAsTemplate() {
    if (!templateName.trim()) { setTemplateError('Name is required'); return; }
    setTemplateError('');
    setTemplateSaving(true);
    try {
      await api.requisitionTemplates.createFromRequisition(id, {
        name: templateName,
        description: templateDesc || undefined,
        isOrgWide: templateOrgWide,
      });
      setTemplateSuccess(true);
      setSaveTemplateOpen(false);
      setTemplateName('');
      setTemplateDesc('');
      setTemplateOrgWide(false);
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setTemplateSaving(false);
    }
  }

  async function doAction(action: 'submit' | 'cancel') {
    setError('');
    setActionLoading(action);
    try {
      if (action === 'submit') await api.requisitions.submit(id);
      else await api.requisitions.cancel(id);
      const updated = await api.requisitions.get(id);
      setReq(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) return <div style={{ padding: '2rem', color: COLORS.textMuted, fontSize: '0.875rem' }}>Loading…</div>;
  if (!req) return (
    <div style={{ padding: '2rem', color: COLORS.textSecondary }}>
      Requisition not found. <Link href="/requisitions" style={{ color: COLORS.accentBlueDark }}>Back to list</Link>
    </div>
  );

  const lines = req.lines ?? [];
  const statusStyle = STATUS_COLORS[req.status] ?? { background: COLORS.hoverBg, color: COLORS.textSecondary };

  return (
    <div style={{ padding: '2rem', maxWidth: '960px' }}>
      <Breadcrumbs items={[{ label: 'Requisitions', href: '/requisitions' }, { label: req.number }]} />
      <Link href="/requisitions" style={{ color: COLORS.textSecondary, fontSize: '0.875rem', textDecoration: 'none' }}>
        &larr; Back to Requisitions
      </Link>

      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginTop: '1rem', marginBottom: '1.25rem', boxShadow: SHADOWS.card }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>{req.number}</h1>
              <span style={{ ...statusStyle, padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.8rem', fontWeight: 600 }}>
                {STATUS_LABELS[req.status] ?? req.status}
              </span>
            </div>
            <p style={{ margin: '0.375rem 0 0', fontSize: '1rem', color: COLORS.textSecondary }}>{req.title}</p>
            {req.description && <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: COLORS.textSecondary }}>{req.description}</p>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.textPrimary }}>{formatCurrency(req.totalAmount, req.currency)}</div>
            <div style={{ fontSize: '0.8rem', color: COLORS.textSecondary }}>{req.currency}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '2rem', marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: `1px solid ${COLORS.hoverBg}`, flexWrap: 'wrap' }}>
          {[
            { label: 'Priority', value: req.priority.charAt(0).toUpperCase() + req.priority.slice(1) },
            { label: 'Created', value: new Date(req.createdAt).toLocaleDateString() },
            { label: 'Needed By', value: req.neededBy ? new Date(req.neededBy).toLocaleDateString() : '—' },
          ].map((item) => (
            <div key={item.label}>
              <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</div>
              <div style={{ fontSize: '0.875rem', color: COLORS.textSecondary, marginTop: '0.25rem' }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

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
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: COLORS.textSecondary }}>{formatCurrency(line.unitPrice, req.currency)}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600, color: COLORS.textPrimary }}>{formatCurrency(lineTotal, req.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${COLORS.tableBorder}`, background: COLORS.tableHeaderBg }}>
                  <td colSpan={5} style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.875rem' }}>Total</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: COLORS.textPrimary }}>{formatCurrency(req.totalAmount, req.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {req.status === 'draft' && (
          <button onClick={() => doAction('submit')} disabled={actionLoading !== null}
            style={{ background: '#059669', color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.7 : 1 }}>
            {actionLoading === 'submit' ? 'Submitting…' : 'Submit for Approval'}
          </button>
        )}
        {req.status === 'approved' && (
          <button onClick={openPoDialog}
            style={{ background: COLORS.accentBlueDark, color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}>
            Create Purchase Order
          </button>
        )}
        {(req.status === 'draft' || req.status === 'pending_approval') && (
          <button onClick={() => doAction('cancel')} disabled={actionLoading !== null}
            style={{ background: COLORS.white, color: COLORS.accentRedDark, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.7 : 1 }}>
            {actionLoading === 'cancel' ? 'Cancelling…' : 'Cancel Requisition'}
          </button>
        )}
        <button
          onClick={() => { setSaveTemplateOpen(true); setTemplateError(''); setTemplateSuccess(false); }}
          style={{ background: COLORS.white, color: COLORS.textSecondary, border: `1px solid ${COLORS.border}`, borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
        >
          Save as Template
        </button>
      </div>
      {error && <div style={{ marginTop: '0.75rem', background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.625rem 1rem', color: COLORS.accentRedDark, fontSize: '0.875rem' }}>{error}</div>}
      {templateSuccess && <div style={{ marginTop: '0.75rem', background: COLORS.accentGreenLight, border: `1px solid ${COLORS.accentGreen}`, borderRadius: '6px', padding: '0.625rem 1rem', color: COLORS.accentGreenDark, fontSize: '0.875rem' }}>Template saved! <a href="/requisitions/templates" style={{ color: COLORS.accentGreenDark, fontWeight: 600 }}>View templates →</a></div>}

      {/* Save as Template Dialog */}
      {saveTemplateOpen && (
        <div style={{ position: 'fixed', inset: 0, background: SHADOWS.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={(e) => { if (e.target === e.currentTarget) setSaveTemplateOpen(false); }}>
          <div style={{ background: COLORS.white, borderRadius: '10px', padding: '1.75rem', width: '100%', maxWidth: '480px', boxShadow: SHADOWS.dropdown }}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.textPrimary }}>Save as Template</h2>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: COLORS.textSecondary }}>
              Save this requisition as a reusable template to pre-fill future requests.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '0.375rem' }}>Template Name *</label>
                <input value={templateName} onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g. Monthly Office Supplies"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '0.375rem' }}>Description</label>
                <textarea value={templateDesc} onChange={(e) => setTemplateDesc(e.target.value)}
                  rows={2} placeholder="Optional description"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: COLORS.textSecondary, cursor: 'pointer' }}>
                <input type="checkbox" checked={templateOrgWide} onChange={(e) => setTemplateOrgWide(e.target.checked)} />
                Make available to all org members
              </label>
            </div>
            {templateError && <div style={{ marginTop: '0.75rem', background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.5rem 0.75rem', color: COLORS.accentRedDark, fontSize: '0.8rem' }}>{templateError}</div>}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setSaveTemplateOpen(false)}
                style={{ background: COLORS.white, color: COLORS.textSecondary, border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', padding: '0.5rem 1rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={saveAsTemplate} disabled={templateSaving}
                style={{ background: COLORS.textPrimary, color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.5rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: templateSaving ? 'not-allowed' : 'pointer', opacity: templateSaving ? 0.7 : 1 }}>
                {templateSaving ? 'Saving…' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create PO Dialog */}
      {poDialogOpen && (
        <div style={{ position: 'fixed', inset: 0, background: SHADOWS.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={(e) => { if (e.target === e.currentTarget) setPoDialogOpen(false); }}>
          <div style={{ background: COLORS.white, borderRadius: '10px', padding: '1.75rem', width: '100%', maxWidth: '480px', boxShadow: SHADOWS.dropdown }}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700, color: COLORS.textPrimary }}>Create Purchase Order</h2>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: COLORS.textSecondary }}>
              Select a vendor to create a PO from {req.number}. All {req.lines?.length ?? 0} line items will be included.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '0.375rem' }}>Vendor *</label>
                <select value={poVendorId} onChange={(e) => setPoVendorId(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}>
                  <option value="">— Select vendor —</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '0.375rem' }}>Payment Terms</label>
                <input value={poPaymentTerms} onChange={(e) => setPoPaymentTerms(e.target.value)}
                  placeholder="e.g. Net 30"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }} />
              </div>
            </div>
            {poError && <div style={{ marginTop: '0.75rem', background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.5rem 0.75rem', color: COLORS.accentRedDark, fontSize: '0.8rem' }}>{poError}</div>}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setPoDialogOpen(false); setPoError(''); }}
                style={{ background: COLORS.white, color: COLORS.textSecondary, border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', padding: '0.5rem 1rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={submitCreatePO} disabled={poSubmitting || !poVendorId}
                style={{ background: COLORS.accentBlueDark, color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.5rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: poSubmitting || !poVendorId ? 'not-allowed' : 'pointer', opacity: poSubmitting || !poVendorId ? 0.7 : 1 }}>
                {poSubmitting ? 'Creating…' : 'Create PO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
