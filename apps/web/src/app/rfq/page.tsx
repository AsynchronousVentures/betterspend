'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { COLORS, SHADOWS, FONT } from '../../lib/theme';
import { api } from '../../lib/api';

interface RfqSummary {
  id: string;
  number: string;
  title: string;
  status: string;
  dueDate?: string;
  currency: string;
  createdAt: string;
  requester?: { name: string; email: string };
  awardedVendor?: { id: string; name: string };
  invitationCount: number;
  responseCount: number;
}

interface Vendor {
  id: string;
  name: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: COLORS.accentAmberLight, text: COLORS.accentAmberDark },
  open: { bg: COLORS.accentBlueLight, text: COLORS.accentBlueDark },
  closed: { bg: '#f1f5f9', text: COLORS.textSecondary },
  awarded: { bg: COLORS.accentGreenLight, text: COLORS.accentGreenDark },
  cancelled: { bg: COLORS.accentRedLight, text: COLORS.accentRedDark },
};

function formatMoney(amount: string | number, currency = 'USD') {
  return Number(amount).toLocaleString('en-US', { style: 'currency', currency });
}

export default function RfqPage() {
  const [rfqs, setRfqs] = useState<RfqSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'responses'>('overview');
  const [responseSort, setResponseSort] = useState<'price' | 'supplier' | 'delivery'>('price');
  const [rejectDrafts, setRejectDrafts] = useState<Record<string, string>>({});
  const [awardingId, setAwardingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: '',
    description: '',
    dueDate: '',
    notes: '',
    currency: 'USD',
  });
  const [lines, setLines] = useState([{ description: '', quantity: 1, unitOfMeasure: 'each', targetPrice: '' }]);
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    loadRfqs();
    api.vendors.list().then((v: any[]) => setVendors(v)).catch(() => {});
  }, []);

  async function loadRfqs() {
    setLoading(true);
    try {
      const data = await (api as any).rfq.list();
      setRfqs(data);
    } catch {
      setError('Failed to load RFQs');
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: string) {
    setSelected(id);
    setDetailLoading(true);
    setDetailTab('overview');
    try {
      const data = await (api as any).rfq.get(id);
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function showSuccess(message: string) {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(''), 4500);
  }

  async function handleCreate() {
    if (!form.title || lines.some((line) => !line.description || !line.quantity)) {
      setError('Title and at least one line item are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await (api as any).rfq.create({
        ...form,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitOfMeasure: line.unitOfMeasure,
          targetPrice: line.targetPrice ? Number(line.targetPrice) : undefined,
        })),
        vendorIds: selectedVendors,
      });
      setShowNew(false);
      setForm({ title: '', description: '', dueDate: '', notes: '', currency: 'USD' });
      setLines([{ description: '', quantity: 1, unitOfMeasure: 'each', targetPrice: '' }]);
      setSelectedVendors([]);
      loadRfqs();
      showSuccess('RFQ created');
    } catch {
      setError('Failed to create RFQ');
    } finally {
      setSaving(false);
    }
  }

  async function handleOpen(id: string) {
    try {
      await (api as any).rfq.open(id);
      loadRfqs();
      if (selected === id) loadDetail(id);
    } catch {
      setError('Failed to open RFQ');
    }
  }

  async function handleClose(id: string) {
    try {
      await (api as any).rfq.close(id);
      loadRfqs();
      if (selected === id) loadDetail(id);
    } catch {
      setError('Failed to close RFQ');
    }
  }

  async function handleAward(responseId: string) {
    if (!detail) return;
    if (!confirm('Award this response and create a draft purchase order from it?')) return;
    setAwardingId(responseId);
    setError('');
    try {
      const result = await (api as any).rfq.award(detail.id, responseId);
      setDetail(result.rfq);
      loadRfqs();
      showSuccess(`Awarded response and created draft PO ${result.purchaseOrderNumber}.`);
    } catch (e: any) {
      setError(e.message || 'Failed to award response');
    } finally {
      setAwardingId(null);
    }
  }

  async function handleReject(responseId: string) {
    if (!detail) return;
    const reason = rejectDrafts[responseId]?.trim();
    if (!reason) {
      setError('A rejection reason is required');
      return;
    }
    setRejectingId(responseId);
    setError('');
    try {
      const result = await (api as any).rfq.reject(detail.id, responseId, reason);
      setDetail(result);
      loadRfqs();
      setRejectDrafts((current) => ({ ...current, [responseId]: '' }));
      showSuccess('Response rejected');
    } catch (e: any) {
      setError(e.message || 'Failed to reject response');
    } finally {
      setRejectingId(null);
    }
  }

  const addLine = () =>
    setLines([...lines, { description: '', quantity: 1, unitOfMeasure: 'each', targetPrice: '' }]);
  const removeLine = (index: number) => setLines(lines.filter((_, idx) => idx !== index));

  const inp: React.CSSProperties = {
    width: '100%',
    border: `1px solid ${COLORS.inputBorder}`,
    borderRadius: 6,
    padding: '0.4rem 0.6rem',
    fontSize: FONT.sm,
    background: '#fff',
    color: COLORS.textPrimary,
    boxSizing: 'border-box',
  };

  const sortedResponses = detail?.responses
    ? [...detail.responses].sort((a: any, b: any) => {
        if (responseSort === 'supplier') return (a.vendor?.name ?? '').localeCompare(b.vendor?.name ?? '');
        if (responseSort === 'delivery') {
          const aLead = Math.min(...(a.lines ?? []).map((line: any) => line.leadTimeDays ?? Number.MAX_SAFE_INTEGER));
          const bLead = Math.min(...(b.lines ?? []).map((line: any) => line.leadTimeDays ?? Number.MAX_SAFE_INTEGER));
          return aLead - bLead;
        }
        return Number(a.totalAmount) - Number(b.totalAmount);
      })
    : [];

  return (
    <div style={{ padding: '1.5rem', background: COLORS.contentBg, minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: FONT.xl, fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>RFQ / e-Sourcing</h1>
          <p style={{ fontSize: FONT.sm, color: COLORS.textSecondary, margin: '0.25rem 0 0' }}>
            Request for Quotation — invite vendors to bid competitively
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          style={{
            background: COLORS.accentBlue, color: '#fff', border: 'none',
            borderRadius: 8, padding: '0.5rem 1.25rem', fontSize: FONT.sm,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          + New RFQ
        </button>
      </div>

      {error && (
        <div style={{ background: COLORS.accentRedLight, color: COLORS.accentRedDark, padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: FONT.sm }}>
          {error}
        </div>
      )}
      {successMsg && (
        <div style={{ background: COLORS.accentGreenLight, color: COLORS.accentGreenDark, padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: FONT.sm }}>
          {successMsg}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: COLORS.textMuted }}>Loading...</div>
          ) : rfqs.length === 0 ? (
            <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 12, padding: '3rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📋</div>
              <div style={{ fontSize: FONT.base, color: COLORS.textSecondary }}>No RFQs yet. Create one to start sourcing.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {rfqs.map((rfq) => {
                const sc = STATUS_COLORS[rfq.status] ?? STATUS_COLORS.draft;
                const isSelected = selected === rfq.id;
                return (
                  <div
                    key={rfq.id}
                    onClick={() => loadDetail(rfq.id)}
                    style={{
                      background: COLORS.cardBg,
                      border: `1px solid ${isSelected ? COLORS.accentBlue : COLORS.cardBorder}`,
                      borderRadius: 10,
                      padding: '1rem 1.25rem',
                      cursor: 'pointer',
                      boxShadow: isSelected ? `0 0 0 2px ${COLORS.accentBlueLight}` : SHADOWS.card,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textMuted, fontFamily: 'monospace' }}>
                        {rfq.number}
                      </span>
                      <span style={{ fontSize: FONT.xs, fontWeight: 600, background: sc.bg, color: sc.text, padding: '0.15rem 0.5rem', borderRadius: 20 }}>
                        {rfq.status.toUpperCase()}
                      </span>
                      {rfq.dueDate && (
                        <span style={{ fontSize: FONT.xs, color: COLORS.textMuted, marginLeft: 'auto' }}>
                          Due: {new Date(rfq.dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: FONT.base, fontWeight: 600, color: COLORS.textPrimary, marginBottom: '0.25rem' }}>
                      {rfq.title}
                    </div>
                    <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: FONT.xs, color: COLORS.textSecondary }}>
                        {rfq.invitationCount} vendors invited
                      </span>
                      <span style={{ fontSize: FONT.xs, color: COLORS.textSecondary }}>
                        {rfq.responseCount} responses
                      </span>
                      {rfq.awardedVendor && (
                        <span style={{ fontSize: FONT.xs, color: COLORS.accentGreen, fontWeight: 600 }}>
                          Awarded: {rfq.awardedVendor.name}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {selected && (
          <div style={{
            width: 460,
            flexShrink: 0,
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 12,
            padding: '1.25rem',
            boxShadow: SHADOWS.card,
            maxHeight: '80vh',
            overflowY: 'auto',
          }}>
            {detailLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: COLORS.textMuted }}>Loading...</div>
            ) : detail ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                  <div>
                    <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, fontFamily: 'monospace', marginBottom: '0.25rem' }}>{detail.number}</div>
                    <div style={{ fontSize: FONT.lg, fontWeight: 700, color: COLORS.textPrimary }}>{detail.title}</div>
                  </div>
                  <button onClick={() => { setSelected(null); setDetail(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.textMuted, fontSize: 18 }}>✕</button>
                </div>

                {detail.description && (
                  <p style={{ fontSize: FONT.sm, color: COLORS.textSecondary, marginBottom: '1rem' }}>{detail.description}</p>
                )}

                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  {detail.status === 'draft' && (
                    <button onClick={() => handleOpen(detail.id)} style={{ background: COLORS.accentBlue, color: '#fff', border: 'none', borderRadius: 6, padding: '0.35rem 0.75rem', fontSize: FONT.xs, fontWeight: 600, cursor: 'pointer' }}>
                      Open for Bids
                    </button>
                  )}
                  {detail.status === 'open' && (
                    <button onClick={() => handleClose(detail.id)} style={{ background: COLORS.accentAmberLight, color: COLORS.accentAmberDark, border: 'none', borderRadius: 6, padding: '0.35rem 0.75rem', fontSize: FONT.xs, fontWeight: 600, cursor: 'pointer' }}>
                      Close RFQ
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  {[
                    { key: 'overview', label: 'Overview' },
                    { key: 'responses', label: `Responses (${detail.responses?.length ?? 0})` },
                  ].map((tab) => {
                    const active = detailTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setDetailTab(tab.key as 'overview' | 'responses')}
                        style={{
                          background: active ? COLORS.accentBlue : COLORS.contentBg,
                          color: active ? '#fff' : COLORS.textSecondary,
                          border: `1px solid ${active ? COLORS.accentBlue : COLORS.border}`,
                          borderRadius: 20,
                          padding: '0.35rem 0.75rem',
                          fontSize: FONT.xs,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {detailTab === 'overview' && (
                  <>
                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{ fontSize: FONT.xs, fontWeight: 700, color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                        Line Items ({detail.lines?.length ?? 0})
                      </div>
                      {detail.lines?.map((line: any, index: number) => (
                        <div key={line.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: `1px solid ${COLORS.border}`, fontSize: FONT.sm }}>
                          <span style={{ color: COLORS.textPrimary }}>{index + 1}. {line.description}</span>
                          <span style={{ color: COLORS.textSecondary }}>{line.quantity} {line.unitOfMeasure}</span>
                        </div>
                      ))}
                    </div>

                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{ fontSize: FONT.xs, fontWeight: 700, color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                        Invited Vendors ({detail.invitations?.length ?? 0})
                      </div>
                      {detail.invitations?.map((invitation: any) => (
                        <div key={invitation.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', fontSize: FONT.sm }}>
                          <span style={{ color: COLORS.textPrimary }}>{invitation.vendor?.name ?? '—'}</span>
                          <span style={{ color: invitation.respondedAt ? COLORS.accentGreen : COLORS.textMuted, fontSize: FONT.xs }}>
                            {invitation.respondedAt ? 'Responded' : 'Pending'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {detailTab === 'responses' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <div style={{ fontSize: FONT.xs, fontWeight: 700, color: COLORS.textMuted, textTransform: 'uppercase' }}>
                        Evaluate Responses ({sortedResponses.length})
                      </div>
                      <select
                        value={responseSort}
                        onChange={(event) => setResponseSort(event.target.value as 'price' | 'supplier' | 'delivery')}
                        style={{ ...inp, width: 150, padding: '0.3rem 0.5rem', fontSize: FONT.xs }}
                      >
                        <option value="price">Sort by price</option>
                        <option value="supplier">Sort by supplier</option>
                        <option value="delivery">Sort by delivery</option>
                      </select>
                    </div>

                    {sortedResponses.length === 0 ? (
                      <div style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>No responses received yet.</div>
                    ) : (
                      sortedResponses.map((response: any, index: number) => {
                        const bestPrice = Math.min(...sortedResponses.map((item: any) => Number(item.totalAmount)));
                        const responseLead = Math.min(...(response.lines ?? []).map((line: any) => line.leadTimeDays ?? Number.MAX_SAFE_INTEGER));
                        const bestLead = Math.min(...sortedResponses.map((item: any) => Math.min(...(item.lines ?? []).map((line: any) => line.leadTimeDays ?? Number.MAX_SAFE_INTEGER))));
                        const priceScore = bestPrice > 0 ? Math.max(0, 100 - (((Number(response.totalAmount) - bestPrice) / bestPrice) * 100)) : 100;
                        const deliveryScore = Number.isFinite(responseLead) && Number.isFinite(bestLead) ? Math.max(0, 100 - Math.max(responseLead - bestLead, 0) * 5) : 60;
                        const rejectValue = rejectDrafts[response.id] ?? '';

                        return (
                          <div key={response.id} style={{
                            background: response.awarded ? COLORS.accentGreenLight : COLORS.contentBg,
                            border: `1px solid ${response.awarded ? COLORS.accentGreen : COLORS.border}`,
                            borderRadius: 8,
                            padding: '0.85rem',
                            marginBottom: '0.75rem',
                          }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.9fr 0.9fr', gap: '0.75rem', marginBottom: '0.5rem' }}>
                              <div>
                                <div style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.textPrimary }}>{response.vendor?.name}</div>
                                <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, marginTop: 2 }}>
                                  Rank #{index + 1} by {responseSort}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, textTransform: 'uppercase', fontWeight: 700 }}>Quoted price</div>
                                <div style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.textPrimary }}>
                                  {formatMoney(response.totalAmount, detail.currency ?? 'USD')}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, textTransform: 'uppercase', fontWeight: 700 }}>Lead time</div>
                                <div style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.textPrimary }}>
                                  {Number.isFinite(responseLead) ? `${responseLead} days` : 'Not provided'}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                              <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '0.55rem 0.65rem' }}>
                                <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, textTransform: 'uppercase', fontWeight: 700 }}>Price score</div>
                                <div style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.textPrimary }}>{Math.round(priceScore)}</div>
                              </div>
                              <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '0.55rem 0.65rem' }}>
                                <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, textTransform: 'uppercase', fontWeight: 700 }}>Delivery score</div>
                                <div style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.textPrimary }}>{Math.round(deliveryScore)}</div>
                              </div>
                              <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '0.55rem 0.65rem' }}>
                                <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, textTransform: 'uppercase', fontWeight: 700 }}>Status</div>
                                <div style={{ fontSize: FONT.sm, fontWeight: 700, color: response.awarded ? COLORS.accentGreenDark : COLORS.textPrimary }}>
                                  {response.awarded ? 'Awarded' : response.status}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'grid', gap: '0.4rem', marginBottom: '0.75rem' }}>
                              {(response.lines ?? []).map((line: any) => (
                                <div key={line.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: FONT.xs, borderBottom: `1px solid ${COLORS.border}`, paddingBottom: '0.35rem' }}>
                                  <span style={{ color: COLORS.textPrimary }}>
                                    {line.rfqLine?.description} ({line.rfqLine?.quantity} {line.rfqLine?.unitOfMeasure})
                                  </span>
                                  <span style={{ color: COLORS.textSecondary }}>
                                    {formatMoney(line.unitPrice, detail.currency ?? 'USD')} / {line.rfqLine?.unitOfMeasure ?? 'ea'}
                                  </span>
                                </div>
                              ))}
                            </div>

                            <div style={{ display: 'grid', gap: '0.5rem' }}>
                              <input
                                value={rejectValue}
                                onChange={(event) => setRejectDrafts((current) => ({ ...current, [response.id]: event.target.value }))}
                                placeholder="Reject reason"
                                style={{ ...inp, fontSize: FONT.xs }}
                              />
                              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                {!response.awarded && detail.status !== 'awarded' && (
                                  <button
                                    onClick={() => handleAward(response.id)}
                                    disabled={!!awardingId || response.status === 'rejected'}
                                    style={{ background: COLORS.accentBlue, color: '#fff', border: 'none', borderRadius: 5, padding: '0.3rem 0.7rem', fontSize: FONT.xs, fontWeight: 600, cursor: awardingId ? 'not-allowed' : 'pointer', opacity: awardingId ? 0.6 : 1 }}
                                  >
                                    {awardingId === response.id ? 'Awarding...' : 'Award'}
                                  </button>
                                )}
                                {!response.awarded && response.status !== 'rejected' && detail.status !== 'awarded' && (
                                  <button
                                    onClick={() => handleReject(response.id)}
                                    disabled={rejectingId === response.id}
                                    style={{ background: COLORS.accentRedLight, color: COLORS.accentRedDark, border: 'none', borderRadius: 5, padding: '0.3rem 0.7rem', fontSize: FONT.xs, fontWeight: 600, cursor: 'pointer', opacity: rejectingId === response.id ? 0.6 : 1 }}
                                  >
                                    {rejectingId === response.id ? 'Rejecting...' : 'Reject'}
                                  </button>
                                )}
                                {response.awarded && (
                                  <Link href="/purchase-orders" style={{ fontSize: FONT.xs, color: COLORS.accentBlueDark, fontWeight: 600, textDecoration: 'none', paddingTop: '0.35rem' }}>
                                    Review purchase orders
                                  </Link>
                                )}
                              </div>
                            </div>

                            {response.notes && (
                              <div style={{ marginTop: '0.5rem', fontSize: FONT.xs, color: COLORS.textMuted }}>
                                {response.notes}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>

      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            background: '#fff',
            borderRadius: 14,
            padding: '1.75rem',
            width: '90%',
            maxWidth: 680,
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: SHADOWS.dropdown,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: FONT.lg, fontWeight: 700, color: COLORS.textPrimary }}>New RFQ</h2>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.textMuted, fontSize: 20 }}>✕</button>
            </div>

            {error && <div style={{ background: COLORS.accentRedLight, color: COLORS.accentRedDark, padding: '0.5rem 0.75rem', borderRadius: 6, marginBottom: '1rem', fontSize: FONT.sm }}>{error}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>Title *</label>
                <input style={inp} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Q2 Office Supplies" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>Description</label>
                <textarea style={{ ...inp, height: 70, resize: 'vertical' }} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Scope and requirements..." />
              </div>
              <div>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>Response Due Date</label>
                <input type="date" style={inp} value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>Currency</label>
                <select style={inp} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>
                  <option>USD</option><option>EUR</option><option>GBP</option><option>CAD</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary }}>Line Items *</label>
                <button onClick={addLine} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: FONT.xs, color: COLORS.accentBlue, fontWeight: 600 }}>+ Add Line</button>
              </div>
              {lines.map((line, index) => (
                <div key={index} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr auto', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                  <input style={inp} placeholder="Description" value={line.description} onChange={(event) => { const next = [...lines]; next[index] = { ...next[index], description: event.target.value }; setLines(next); }} />
                  <input type="number" style={inp} placeholder="Qty" value={line.quantity} min={0.01} step={0.01} onChange={(event) => { const next = [...lines]; next[index] = { ...next[index], quantity: Number(event.target.value) }; setLines(next); }} />
                  <input style={inp} placeholder="UOM" value={line.unitOfMeasure} onChange={(event) => { const next = [...lines]; next[index] = { ...next[index], unitOfMeasure: event.target.value }; setLines(next); }} />
                  <input type="number" style={inp} placeholder="Target $" value={line.targetPrice} onChange={(event) => { const next = [...lines]; next[index] = { ...next[index], targetPrice: event.target.value }; setLines(next); }} />
                  <button onClick={() => removeLine(index)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.accentRed, fontSize: 16, padding: '0 4px' }} disabled={lines.length === 1}>✕</button>
                </div>
              ))}
            </div>

            {vendors.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 6 }}>Invite Vendors</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', maxHeight: 120, overflowY: 'auto', padding: '0.5rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: 6 }}>
                  {vendors.map((vendor) => {
                    const isSelected = selectedVendors.includes(vendor.id);
                    return (
                      <button
                        key={vendor.id}
                        onClick={() => setSelectedVendors(isSelected ? selectedVendors.filter((id) => id !== vendor.id) : [...selectedVendors, vendor.id])}
                        style={{
                          background: isSelected ? COLORS.accentBlue : COLORS.contentBg,
                          color: isSelected ? '#fff' : COLORS.textSecondary,
                          border: `1px solid ${isSelected ? COLORS.accentBlue : COLORS.border}`,
                          borderRadius: 20,
                          padding: '0.2rem 0.65rem',
                          fontSize: FONT.xs,
                          cursor: 'pointer',
                          fontWeight: isSelected ? 600 : 400,
                        }}
                      >
                        {vendor.name}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, marginTop: 4 }}>{selectedVendors.length} selected</div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '0.5rem 1.25rem', fontSize: FONT.sm, cursor: 'pointer', color: COLORS.textSecondary }}>Cancel</button>
              <button
                onClick={handleCreate}
                disabled={saving}
                style={{ background: COLORS.accentBlue, color: '#fff', border: 'none', borderRadius: 8, padding: '0.5rem 1.25rem', fontSize: FONT.sm, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Creating...' : 'Create RFQ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
