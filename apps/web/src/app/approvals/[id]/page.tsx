'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';
import Breadcrumbs from '../../../components/breadcrumbs';

interface ApprovalAction {
  id: string;
  step: number;
  actorId: string;
  action: string;
  comment: string | null;
  createdAt: string;
}

interface ApprovalRequest {
  id: string;
  approvableType: string;
  approvableId: string;
  currentStep: number;
  status: string;
  createdAt: string;
  rule?: { id: string; name: string };
  actions?: ApprovalAction[];
}

const STATUS_COLORS: Record<string, { background: string; color: string }> = {
  pending:   { background: COLORS.accentAmberLight, color: COLORS.accentAmberDark },
  approved:  { background: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
  rejected:  { background: COLORS.accentRedLight, color: COLORS.accentRedDark },
  cancelled: { background: COLORS.hoverBg, color: COLORS.textSecondary },
};

const ACTION_COLORS: Record<string, { background: string; color: string }> = {
  approved:  { background: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
  rejected:  { background: COLORS.accentRedLight, color: COLORS.accentRedDark },
  commented: { background: '#dbeafe', color: '#1e40af' },
  delegated: { background: COLORS.accentPurpleLight, color: COLORS.accentPurpleDark },
};

export default function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState('');
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.approvals.get(pid)
        .then((data) => setApproval(data))
        .catch(() => setApproval(null))
        .finally(() => setLoading(false));
    });
  }, [params]);

  async function doAction(action: 'approve' | 'reject') {
    setError('');
    setActionLoading(action);
    try {
      if (action === 'approve') await api.approvals.approve(id, { comment: comment || undefined });
      else await api.approvals.reject(id, { comment: comment || undefined });
      const updated = await api.approvals.get(id);
      setApproval(updated);
      setComment('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) return <div style={{ padding: '2rem', color: COLORS.textMuted, fontSize: '0.875rem' }}>Loading…</div>;
  if (!approval) return (
    <div style={{ padding: '2rem', color: COLORS.textSecondary }}>
      Approval not found. <Link href="/approvals" style={{ color: COLORS.accentBlueDark }}>Back to queue</Link>
    </div>
  );

  const actions = approval.actions ?? [];
  const statusStyle = STATUS_COLORS[approval.status] ?? { background: COLORS.hoverBg, color: COLORS.textSecondary };

  return (
    <div style={{ padding: '2rem', maxWidth: '960px' }}>
      <Breadcrumbs items={[{ label: 'Approvals', href: '/approvals' }, { label: approval.approvableType.replace(/_/g, ' ') }]} />
      <Link href="/approvals" style={{ color: COLORS.textSecondary, fontSize: '0.875rem', textDecoration: 'none' }}>
        &larr; Back to Approvals Queue
      </Link>

      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginTop: '1rem', marginBottom: '1.25rem', boxShadow: SHADOWS.card }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary, textTransform: 'capitalize' }}>
                {approval.approvableType.replace(/_/g, ' ')}
              </h1>
              <span style={{ ...statusStyle, padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.8rem', fontWeight: 600 }}>
                {approval.status.charAt(0).toUpperCase() + approval.status.slice(1)}
              </span>
            </div>
            {(approval as any).entitySummary ? (
              <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: COLORS.textSecondary }}>
                <Link
                  href={approval.approvableType === 'requisition' ? `/requisitions/${approval.approvableId}` : `/purchase-orders/${approval.approvableId}`}
                  style={{ color: COLORS.accentBlueDark, textDecoration: 'none' }}
                >
                  {(approval as any).entitySummary.number}
                  {(approval as any).entitySummary.title ? ` — ${(approval as any).entitySummary.title}` : ''}
                  {(approval as any).entitySummary.vendorName ? ` — ${(approval as any).entitySummary.vendorName}` : ''}
                </Link>
                {(approval as any).entitySummary.amount != null && (
                  <span style={{ marginLeft: '0.75rem', fontWeight: 600, color: COLORS.textPrimary }}>
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((approval as any).entitySummary.amount)}
                  </span>
                )}
              </p>
            ) : (
              <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: COLORS.textMuted, fontFamily: 'monospace' }}>
                ID: …{approval.approvableId.slice(-8)}
              </p>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '2rem', marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: `1px solid ${COLORS.hoverBg}`, flexWrap: 'wrap' }}>
          {[
            { label: 'Rule', value: approval.rule?.name ?? '—' },
            { label: 'Current Step', value: `Step ${approval.currentStep}` },
            { label: 'Created', value: new Date(approval.createdAt).toLocaleDateString() },
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
          <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: COLORS.textPrimary }}>Action History</h2>
        </div>
        {actions.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: COLORS.textMuted, fontSize: '0.875rem' }}>No actions recorded yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                  {['Step', 'Actor', 'Action', 'Comment', 'Date'].map((col) => (
                    <th key={col} style={{ padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {actions.map((act, idx) => {
                  const actStyle = ACTION_COLORS[act.action] ?? { background: COLORS.hoverBg, color: COLORS.textSecondary };
                  return (
                    <tr key={act.id} style={{ borderBottom: idx < actions.length - 1 ? `1px solid ${COLORS.hoverBg}` : undefined }}>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{act.step}</td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textMuted, fontFamily: 'monospace', fontSize: '0.8rem' }}>…{act.actorId.slice(-8)}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ ...actStyle, padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, textTransform: 'capitalize' }}>{act.action}</span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{act.comment ?? <span style={{ color: COLORS.inputBorder }}>—</span>}</td>
                      <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>{new Date(act.createdAt).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {approval.status === 'pending' && (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', boxShadow: SHADOWS.card }}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 600, color: COLORS.textPrimary }}>Take Action</h2>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.375rem' }}>Comment (optional)</label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
              placeholder="Add a comment for this action…"
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button onClick={() => doAction('approve')} disabled={actionLoading !== null}
              style={{ background: '#059669', color: COLORS.white, border: 'none', borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.7 : 1 }}>
              {actionLoading === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button onClick={() => doAction('reject')} disabled={actionLoading !== null}
              style={{ background: COLORS.white, color: COLORS.accentRedDark, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.625rem 1.25rem', fontSize: '0.875rem', fontWeight: 600, cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.7 : 1 }}>
              {actionLoading === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
          {error && <div style={{ marginTop: '0.75rem', background: COLORS.accentRedLight, border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.625rem 1rem', color: COLORS.accentRedDark, fontSize: '0.875rem' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
