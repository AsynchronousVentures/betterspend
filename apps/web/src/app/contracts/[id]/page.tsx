'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';
import { DocumentUploader } from '../../../components/document-uploader';
import Breadcrumbs from '../../../components/breadcrumbs';

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  msa:                'MSA',
  sow:                'SOW',
  nda:                'NDA',
  sla:                'SLA',
  purchase_agreement: 'Purchase Agreement',
  framework:          'Framework Agreement',
  other:              'Other',
};

const STATUS_STYLES: Record<string, { background: string; color: string }> = {
  draft:            { background: '#f1f5f9', color: COLORS.textSecondary },
  pending_approval: { background: COLORS.accentAmberLight, color: COLORS.accentAmberDark },
  active:           { background: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
  expiring_soon:    { background: '#fff7ed', color: '#9a3412' },
  expired:          { background: COLORS.accentRedLight, color: COLORS.accentRedDark },
  terminated:       { background: '#f8fafc', color: '#475569' },
};

const STATUS_LABELS: Record<string, string> = {
  draft:            'Draft',
  pending_approval: 'Pending Approval',
  active:           'Active',
  expiring_soon:    'Expiring Soon',
  expired:          'Expired',
  terminated:       'Terminated',
};

const fmt = (n: string | number | null | undefined, currency = 'USD') => {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(n));
};

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId]                     = useState('');
  const [contract, setContract]         = useState<any>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Terminate modal state
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [terminateReason, setTerminateReason]       = useState('');
  const [terminating, setTerminating]               = useState(false);

  useEffect(() => {
    params.then(({ id: resolvedId }) => {
      setId(resolvedId);
    });
  }, [params]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.contracts.get(id)
      .then(setContract)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleActivate() {
    setActionLoading(true);
    setError('');
    try {
      const updated = await api.contracts.activate(id);
      setContract(updated);
    } catch (e: any) {
      setError(e.message || 'Failed to activate contract');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTerminate(e: FormEvent) {
    e.preventDefault();
    setTerminating(true);
    setError('');
    try {
      const updated = await api.contracts.terminate(id, terminateReason);
      setContract(updated);
      setShowTerminateModal(false);
      setTerminateReason('');
    } catch (e: any) {
      setError(e.message || 'Failed to terminate contract');
    } finally {
      setTerminating(false);
    }
  }

  const cardStyle: React.CSSProperties = {
    background: COLORS.cardBg,
    border: `1px solid ${COLORS.tableBorder}`,
    borderRadius: '8px',
    padding: '1.25rem',
    boxShadow: SHADOWS.card,
    marginBottom: '1rem',
  };

  const thStyle: React.CSSProperties = {
    padding: '0.5rem 0.75rem',
    textAlign: 'left',
    fontWeight: 600,
    color: COLORS.textSecondary,
    fontSize: '0.78rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  if (loading) return <div style={{ padding: '2rem', color: COLORS.textSecondary }}>Loading...</div>;
  if (error && !contract) return (
    <div style={{ padding: '2rem' }}>
      <Link href="/contracts" style={{ color: COLORS.accentBlue, textDecoration: 'none', fontSize: '0.875rem' }}>← Contracts</Link>
      <div style={{ marginTop: '1rem', color: COLORS.accentRedDark }}>{error}</div>
    </div>
  );
  if (!contract) return null;

  const sc = STATUS_STYLES[contract.status] ?? { background: '#f1f5f9', color: COLORS.textSecondary };
  const canActivate  = ['draft', 'pending_approval'].includes(contract.status);
  const canTerminate = ['active', 'expiring_soon'].includes(contract.status);

  const lines      = contract.lines ?? contract.contractLines ?? [];
  const amendments = contract.amendments ?? [];

  return (
    <div style={{ padding: '2rem', maxWidth: '900px' }}>
      <Breadcrumbs items={[{ label: 'Contracts', href: '/contracts' }, { label: contract.title }]} />
      {/* Breadcrumb */}
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/contracts" style={{ color: COLORS.accentBlue, textDecoration: 'none', fontSize: '0.875rem' }}>← Contracts</Link>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: COLORS.accentRedLight, border: `1px solid #fecaca`, borderRadius: '6px', padding: '0.75rem 1rem', color: COLORS.accentRedDark, fontSize: '0.875rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.accentRedDark, fontWeight: 700, fontSize: '1rem', lineHeight: 1, padding: 0 }}>×</button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '0.875rem', color: COLORS.textSecondary, fontWeight: 500 }}>
              {contract.contractNumber || 'CTR-DRAFT'}
            </span>
            <span style={{ ...sc, padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
              {STATUS_LABELS[contract.status] ?? contract.status}
            </span>
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>{contract.title}</h1>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexShrink: 0 }}>
          {canActivate && (
            <button
              onClick={handleActivate}
              disabled={actionLoading}
              style={{ padding: '0.5rem 1rem', background: COLORS.accentGreen, color: COLORS.white, border: 'none', borderRadius: '6px', cursor: actionLoading ? 'not-allowed' : 'pointer', fontWeight: 500, fontSize: '0.875rem', opacity: actionLoading ? 0.7 : 1 }}
            >
              {actionLoading ? 'Activating...' : 'Activate'}
            </button>
          )}
          {canTerminate && (
            <button
              onClick={() => setShowTerminateModal(true)}
              disabled={actionLoading}
              style={{ padding: '0.5rem 1rem', background: COLORS.accentRedLight, color: COLORS.accentRedDark, border: `1px solid #fecaca`, borderRadius: '6px', cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem' }}
            >
              Terminate
            </button>
          )}
        </div>
      </div>

      {/* Overview card */}
      <div style={cardStyle}>
        <h2 style={{ fontWeight: 600, fontSize: '0.9rem', color: COLORS.textSecondary, margin: '0 0 1rem' }}>Overview</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
          <Field label="Vendor"        value={contract.vendor?.name ?? '—'} />
          <Field label="Type"          value={CONTRACT_TYPE_LABELS[contract.type] ?? contract.type ?? '—'} />
          <Field label="Payment Terms" value={contract.paymentTerms ?? '—'} />
          <Field label="Start Date"    value={fmtDate(contract.startDate)} />
          <Field label="End Date"      value={fmtDate(contract.endDate)} />
          <Field label="Total Value"   value={contract.totalValue != null ? fmt(contract.totalValue, contract.currency ?? 'USD') : '—'} />
          <Field
            label="Auto-Renew"
            value={contract.autoRenew
              ? `Yes${contract.renewalNoticeDays ? ` (${contract.renewalNoticeDays} days notice)` : ''}`
              : 'No'}
          />
          <Field label="Currency"      value={contract.currency ?? 'USD'} />
        </div>
        {contract.terms && (
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${COLORS.tableBorder}` }}>
            <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginBottom: '0.375rem' }}>Terms & Conditions</div>
            <div style={{ fontSize: '0.875rem', color: COLORS.textPrimary, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{contract.terms}</div>
          </div>
        )}
        {contract.internalNotes && (
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${COLORS.tableBorder}` }}>
            <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginBottom: '0.375rem' }}>Internal Notes</div>
            <div style={{ fontSize: '0.875rem', color: COLORS.textSecondary, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{contract.internalNotes}</div>
          </div>
        )}
      </div>

      {/* Contract Lines */}
      <div style={cardStyle}>
        <h2 style={{ fontWeight: 600, fontSize: '0.9rem', color: COLORS.textSecondary, margin: '0 0 1rem' }}>
          Contract Lines {lines.length > 0 ? `(${lines.length})` : ''}
        </h2>
        {lines.length === 0 ? (
          <p style={{ fontSize: '0.875rem', color: COLORS.textMuted, margin: 0 }}>No contract lines defined</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                  <th style={thStyle}>Description</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Qty</th>
                  <th style={thStyle}>UOM</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Unit Price</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line: any, idx: number) => {
                  const total = line.quantity != null && line.unitPrice != null
                    ? Number(line.quantity) * Number(line.unitPrice)
                    : null;
                  return (
                    <tr key={line.id ?? idx} style={{ borderBottom: idx < lines.length - 1 ? `1px solid ${COLORS.contentBg}` : undefined }}>
                      <td style={{ padding: '0.625rem 0.75rem', color: COLORS.textPrimary }}>{line.description ?? '—'}</td>
                      <td style={{ padding: '0.625rem 0.75rem', color: COLORS.textSecondary, textAlign: 'right' }}>{line.quantity ?? '—'}</td>
                      <td style={{ padding: '0.625rem 0.75rem', color: COLORS.textSecondary }}>{line.unitOfMeasure ?? line.uom ?? '—'}</td>
                      <td style={{ padding: '0.625rem 0.75rem', color: COLORS.textSecondary, textAlign: 'right' }}>
                        {line.unitPrice != null ? fmt(line.unitPrice, contract.currency ?? 'USD') : '—'}
                      </td>
                      <td style={{ padding: '0.625rem 0.75rem', color: COLORS.textPrimary, fontWeight: 500, textAlign: 'right' }}>
                        {total != null ? fmt(total, contract.currency ?? 'USD') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Amendments */}
      <div style={cardStyle}>
        <h2 style={{ fontWeight: 600, fontSize: '0.9rem', color: COLORS.textSecondary, margin: '0 0 1rem' }}>
          Amendments {amendments.length > 0 ? `(${amendments.length})` : ''}
        </h2>
        {amendments.length === 0 ? (
          <p style={{ fontSize: '0.875rem', color: COLORS.textMuted, margin: 0 }}>No amendments recorded</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {amendments.map((amendment: any, idx: number) => (
              <div
                key={amendment.id ?? idx}
                style={{ padding: '0.875rem', background: COLORS.contentBg, borderRadius: '6px', borderLeft: `3px solid ${COLORS.accentAmber}` }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: COLORS.textSecondary }}>
                    Amendment #{amendment.amendmentNumber ?? idx + 1}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: COLORS.textMuted }}>
                    {fmtDate(amendment.effectiveDate ?? amendment.createdAt)}
                  </span>
                </div>
                {amendment.description && (
                  <p style={{ fontSize: '0.875rem', color: COLORS.textPrimary, margin: 0, lineHeight: 1.5 }}>{amendment.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Documents */}
      {id && (
        <DocumentUploader entityType="contract" entityId={id} label="Documents" />
      )}

      {/* Terminate Modal */}
      {showTerminateModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowTerminateModal(false); }}
        >
          <div style={{ background: COLORS.cardBg, borderRadius: '10px', padding: '1.75rem', width: '440px', boxShadow: SHADOWS.dropdown }}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.125rem', fontWeight: 700, color: COLORS.textPrimary }}>Terminate Contract</h2>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: COLORS.textSecondary }}>
              This action will mark the contract as terminated. Please provide a reason.
            </p>
            <form onSubmit={handleTerminate}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' }}>
                  Reason *
                </label>
                <textarea
                  required
                  rows={4}
                  value={terminateReason}
                  onChange={(e) => setTerminateReason(e.target.value)}
                  placeholder="Enter reason for termination..."
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => { setShowTerminateModal(false); setTerminateReason(''); }}
                  style={{ padding: '0.5rem 1rem', background: COLORS.tableBorder, color: COLORS.textSecondary, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={terminating || !terminateReason.trim()}
                  style={{ padding: '0.5rem 1.25rem', background: COLORS.accentRed, color: COLORS.white, border: 'none', borderRadius: '6px', cursor: terminating || !terminateReason.trim() ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: terminating || !terminateReason.trim() ? 0.6 : 1 }}
                >
                  {terminating ? 'Terminating...' : 'Terminate Contract'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginBottom: '0.2rem' }}>{label}</div>
      <div style={{ fontSize: '0.875rem', color: COLORS.textPrimary, fontWeight: 400 }}>{value}</div>
    </div>
  );
}
