'use client';

import Link from 'next/link';
import { Fragment, useState, useEffect } from 'react';
import { COLORS, SHADOWS, FONT } from '../../lib/theme';
import { api } from '../../lib/api';

interface RecurringPoLine {
  description: string;
  quantity: number;
  unitPrice: number;
  unitOfMeasure: string;
}

interface RecurringPo {
  id: string;
  title: string;
  description?: string;
  frequency: string;
  dayOfMonth?: number;
  nextRunAt: string;
  lastRunAt?: string;
  active: boolean;
  totalAmount: string;
  currency: string;
  lines: RecurringPoLine[];
  glAccount?: string;
  notes?: string;
  runCount: number;
  maxRuns?: number;
  vendor?: { id: string; name: string } | null;
  createdAt: string;
  upcomingRuns?: string[];
  historyCount?: number;
  recentHistory?: Array<{
    id: string;
    number: string;
    status: string;
    totalAmount: string;
    currency: string;
    createdAt: string;
  }>;
}

interface Vendor {
  id: string;
  name: string;
}

const FREQ_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annually',
};

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtCurrency(amount: string | number, currency = 'USD') {
  return Number(amount).toLocaleString('en-US', { style: 'currency', currency });
}

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

const EMPTY_LINE: RecurringPoLine = { description: '', quantity: 1, unitPrice: 0, unitOfMeasure: 'each' };

export default function RecurringPoPage() {
  const [schedules, setSchedules] = useState<RecurringPo[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, RecurringPo>>({});
  const [successMsg, setSuccessMsg] = useState('');

  // Form state
  const [form, setForm] = useState({
    title: '',
    description: '',
    vendorId: '',
    frequency: 'monthly' as 'weekly' | 'monthly' | 'quarterly' | 'annually',
    dayOfMonth: 1,
    totalAmount: 0,
    currency: 'USD',
    glAccount: '',
    notes: '',
    maxRuns: '',
    startDate: '',
  });
  const [lines, setLines] = useState<RecurringPoLine[]>([{ ...EMPTY_LINE }]);

  useEffect(() => {
    loadSchedules();
    api.vendors.list().then((v: any[]) => setVendors(v)).catch(() => {});
  }, []);

  async function loadSchedules() {
    setLoading(true);
    setError('');
    try {
      const data = await api.recurringPo.list();
      setSchedules(data as RecurringPo[]);
    } catch {
      setError('Failed to load recurring PO schedules');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm({
      title: '',
      description: '',
      vendorId: '',
      frequency: 'monthly',
      dayOfMonth: 1,
      totalAmount: 0,
      currency: 'USD',
      glAccount: '',
      notes: '',
      maxRuns: '',
      startDate: '',
    });
    setLines([{ ...EMPTY_LINE }]);
  }

  async function handleCreate() {
    if (!form.title.trim()) { setError('Title is required'); return; }
    if (lines.some((l) => !l.description.trim())) { setError('All line items need a description'); return; }
    setSaving(true);
    setError('');
    try {
      const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
      await api.recurringPo.create({
        title: form.title,
        description: form.description || undefined,
        vendorId: form.vendorId || undefined,
        frequency: form.frequency,
        dayOfMonth: ['monthly', 'quarterly', 'annually'].includes(form.frequency) ? form.dayOfMonth : undefined,
        totalAmount: total,
        currency: form.currency,
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          unitOfMeasure: l.unitOfMeasure,
        })),
        glAccount: form.glAccount || undefined,
        notes: form.notes || undefined,
        maxRuns: form.maxRuns ? Number(form.maxRuns) : undefined,
        startDate: form.startDate || undefined,
      });
      setShowNew(false);
      resetForm();
      loadSchedules();
      showSuccess('Recurring PO schedule created');
    } catch (e: any) {
      setError(e.message || 'Failed to create recurring PO');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(rpo: RecurringPo) {
    try {
      await api.recurringPo.update(rpo.id, { active: !rpo.active });
      loadSchedules();
    } catch (e: any) {
      setError(e.message || 'Failed to update schedule');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this recurring PO schedule?')) return;
    try {
      await api.recurringPo.delete(id);
      loadSchedules();
    } catch (e: any) {
      setError(e.message || 'Failed to delete schedule');
    }
  }

  async function handleRunNow(id: string) {
    if (!confirm('Run this recurring PO now and create a draft purchase order?')) return;
    setRunningId(id);
    setError('');
    try {
      const result = await api.recurringPo.run(id);
      loadSchedules();
      showSuccess(`Draft PO created: ${result.purchaseOrderNumber}`);
    } catch (e: any) {
      setError(e.message || 'Failed to trigger run');
    } finally {
      setRunningId(null);
    }
  }

  async function handleSkipNext(rpo: RecurringPo) {
    if (!confirm(`Skip the next scheduled run on ${fmtDate(rpo.nextRunAt)}?`)) return;
    setError('');
    try {
      const result = await api.recurringPo.skipNext(rpo.id);
      await loadSchedules();
      showSuccess(`Skipped ${fmtDate(result.skippedRunAt)}. Next run is now ${fmtDate(result.nextRunAt)}.`);
      if (expandedId === rpo.id) {
        await loadDetails(rpo.id, true);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to skip next run');
    }
  }

  async function loadDetails(id: string, force = false) {
    if (!force && detailsById[id]) return;
    setDetailLoadingId(id);
    try {
      const detail = await api.recurringPo.get(id);
      setDetailsById((current) => ({ ...current, [id]: detail as RecurringPo }));
    } catch (e: any) {
      setError(e.message || 'Failed to load schedule details');
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function toggleExpanded(id: string) {
    const nextExpanded = expandedId === id ? null : id;
    setExpandedId(nextExpanded);
    if (nextExpanded) {
      await loadDetails(id);
    }
  }

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  }

  function addLine() {
    setLines([...lines, { ...EMPTY_LINE }]);
  }

  function removeLine(i: number) {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, idx) => idx !== i));
  }

  function updateLine(i: number, field: keyof RecurringPoLine, value: string | number) {
    const next = [...lines];
    next[i] = { ...next[i], [field]: value };
    setLines(next);
  }

  const computedTotal = lines.reduce((s, l) => s + (l.quantity || 0) * (l.unitPrice || 0), 0);

  return (
    <div style={{ padding: '1.5rem', background: COLORS.contentBg, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: FONT.xl, fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
            Recurring Purchase Orders
          </h1>
          <p style={{ fontSize: FONT.sm, color: COLORS.textSecondary, margin: '0.25rem 0 0' }}>
            Automate repeat purchases on a regular schedule
          </p>
        </div>
        <button
          onClick={() => { setShowNew(true); setError(''); }}
          style={{
            background: COLORS.accentBlue, color: '#fff', border: 'none',
            borderRadius: 8, padding: '0.5rem 1.25rem', fontSize: FONT.sm,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          + New Recurring PO
        </button>
      </div>

      {/* Alerts */}
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

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: COLORS.textMuted }}>Loading...</div>
      ) : schedules.length === 0 ? (
        <div style={{
          background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 12, padding: '3rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔁</div>
          <div style={{ fontSize: FONT.base, color: COLORS.textSecondary }}>
            No recurring PO schedules yet. Create one to get started.
          </div>
        </div>
      ) : (
        <div style={{
          background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 12, boxShadow: SHADOWS.card, overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                {['Title', 'Vendor', 'Frequency', 'Next Run', 'Last Run', 'Runs', 'Amount', 'Status', 'Actions'].map((h) => (
                  <th key={h} style={{
                    padding: '0.625rem 1rem', textAlign: 'left', fontSize: FONT.xs,
                    fontWeight: 600, color: COLORS.textSecondary, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedules.map((rpo) => {
                const paused = !rpo.active;
                const detail = detailsById[rpo.id];
                const expanded = expandedId === rpo.id;
                const rowStyle: React.CSSProperties = {
                  borderBottom: `1px solid ${COLORS.tableBorder}`,
                  opacity: paused ? 0.55 : 1,
                };
                const cellStyle: React.CSSProperties = {
                  padding: '0.75rem 1rem',
                  fontSize: FONT.sm,
                  color: COLORS.textPrimary,
                  verticalAlign: 'middle',
                };
                return (
                  <Fragment key={rpo.id}>
                    <tr key={rpo.id} style={rowStyle}>
                      <td style={cellStyle}>
                        <div style={{
                          fontWeight: 600,
                          textDecoration: paused ? 'line-through' : 'none',
                          color: paused ? COLORS.textMuted : COLORS.textPrimary,
                        }}>
                          {rpo.title}
                        </div>
                        {rpo.description && (
                          <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, marginTop: 2 }}>{rpo.description}</div>
                        )}
                        {!!rpo.historyCount && (
                          <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, marginTop: 4 }}>
                            {rpo.historyCount} generated PO{rpo.historyCount === 1 ? '' : 's'}
                          </div>
                        )}
                      </td>
                      <td style={cellStyle}>{rpo.vendor?.name ?? <span style={{ color: COLORS.textMuted }}>—</span>}</td>
                      <td style={cellStyle}>
                        <span style={{ fontSize: FONT.xs, fontWeight: 600, background: COLORS.accentBlueLight, color: COLORS.accentBlueDark, padding: '0.2rem 0.5rem', borderRadius: 20 }}>
                          {FREQ_LABELS[rpo.frequency] ?? rpo.frequency}
                        </span>
                      </td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                        {fmtDate(rpo.nextRunAt)}
                        {rpo.upcomingRuns && rpo.upcomingRuns.length > 1 && (
                          <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, marginTop: 4 }}>
                            +{Math.max(rpo.upcomingRuns.length - 1, 0)} more scheduled
                          </div>
                        )}
                      </td>
                      <td style={{ ...cellStyle, color: COLORS.textSecondary }}>{fmtDate(rpo.lastRunAt)}</td>
                      <td style={cellStyle}>
                        {rpo.runCount}{rpo.maxRuns ? `/${rpo.maxRuns}` : ''}
                      </td>
                      <td style={{ ...cellStyle, fontWeight: 600 }}>{fmtCurrency(rpo.totalAmount, rpo.currency)}</td>
                      <td style={cellStyle}>
                        {paused ? (
                          <span style={{ fontSize: FONT.xs, fontWeight: 600, background: COLORS.accentAmberLight, color: COLORS.accentAmberDark, padding: '0.2rem 0.5rem', borderRadius: 20 }}>
                            PAUSED
                          </span>
                        ) : (
                          <span style={{ fontSize: FONT.xs, fontWeight: 600, background: COLORS.accentGreenLight, color: COLORS.accentGreenDark, padding: '0.2rem 0.5rem', borderRadius: 20 }}>
                            ACTIVE
                          </span>
                        )}
                      </td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            disabled={!!runningId || paused}
                            onClick={() => handleRunNow(rpo.id)}
                            title="Run Now — creates a draft PO"
                            style={{
                              background: COLORS.accentBlue, color: '#fff', border: 'none',
                              borderRadius: 5, padding: '0.25rem 0.6rem', fontSize: FONT.xs,
                              fontWeight: 600, cursor: (runningId || paused) ? 'not-allowed' : 'pointer',
                              opacity: (runningId || paused) ? 0.5 : 1,
                            }}
                          >
                            {runningId === rpo.id ? '...' : 'Run'}
                          </button>
                          <button
                            disabled={paused}
                            onClick={() => handleSkipNext(rpo)}
                            style={{
                              background: COLORS.accentBlueLight,
                              color: COLORS.accentBlueDark,
                              border: 'none',
                              borderRadius: 5,
                              padding: '0.25rem 0.6rem',
                              fontSize: FONT.xs,
                              fontWeight: 600,
                              cursor: paused ? 'not-allowed' : 'pointer',
                              opacity: paused ? 0.5 : 1,
                            }}
                          >
                            Skip Next
                          </button>
                          <button
                            onClick={() => handleToggleActive(rpo)}
                            style={{
                              background: paused ? COLORS.accentGreenLight : COLORS.accentAmberLight,
                              color: paused ? COLORS.accentGreenDark : COLORS.accentAmberDark,
                              border: 'none', borderRadius: 5, padding: '0.25rem 0.6rem',
                              fontSize: FONT.xs, fontWeight: 600, cursor: 'pointer',
                            }}
                          >
                            {paused ? 'Resume' : 'Pause'}
                          </button>
                          <button
                            onClick={() => void toggleExpanded(rpo.id)}
                            style={{
                              background: COLORS.cardBg,
                              color: COLORS.textPrimary,
                              border: `1px solid ${COLORS.border}`,
                              borderRadius: 5,
                              padding: '0.25rem 0.6rem',
                              fontSize: FONT.xs,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {expanded ? 'Hide' : 'Details'}
                          </button>
                          <button
                            onClick={() => handleDelete(rpo.id)}
                            title="Delete schedule"
                            style={{
                              background: COLORS.accentRedLight, color: COLORS.accentRedDark,
                              border: 'none', borderRadius: 5, padding: '0.25rem 0.5rem',
                              fontSize: FONT.xs, fontWeight: 600, cursor: 'pointer',
                            }}
                          >
                            Del
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={9} style={{ padding: '1rem', background: COLORS.contentBg }}>
                          {detailLoadingId === rpo.id && !detail ? (
                            <div style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>Loading schedule details...</div>
                          ) : detail ? (
                            <div style={{ display: 'grid', gap: '1rem' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '0.85rem' }}>
                                  <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Next run</div>
                                  <div style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.textPrimary }}>{fmtDate(detail.nextRunAt)}</div>
                                </div>
                                <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '0.85rem' }}>
                                  <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Last run</div>
                                  <div style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.textPrimary }}>{fmtDate(detail.lastRunAt)}</div>
                                </div>
                                <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '0.85rem' }}>
                                  <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>Generated POs</div>
                                  <div style={{ fontSize: FONT.base, fontWeight: 700, color: COLORS.textPrimary }}>{detail.historyCount ?? 0}</div>
                                </div>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '1rem' }}>
                                <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '0.95rem' }}>
                                  <div style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.textPrimary, marginBottom: '0.75rem' }}>
                                    Upcoming runs
                                  </div>
                                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                                    {(detail.upcomingRuns ?? []).length === 0 ? (
                                      <div style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>No future runs scheduled.</div>
                                    ) : (
                                      (detail.upcomingRuns ?? []).map((runAt, index) => (
                                        <div key={runAt} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                                          <span style={{ fontSize: FONT.sm, color: COLORS.textPrimary, fontWeight: 600 }}>{fmtDate(runAt)}</span>
                                          <span style={{ fontSize: FONT.xs, color: COLORS.textMuted }}>
                                            {index === 0 ? 'Next scheduled run' : `Run ${detail.runCount + index + 1}`}
                                          </span>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>

                                <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '0.95rem' }}>
                                  <div style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.textPrimary, marginBottom: '0.75rem' }}>
                                    Generated PO history
                                  </div>
                                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                                    {(detail.recentHistory ?? []).length === 0 ? (
                                      <div style={{ fontSize: FONT.sm, color: COLORS.textMuted }}>No purchase orders have been created from this schedule yet.</div>
                                    ) : (
                                      (detail.recentHistory ?? []).map((po) => (
                                        <div key={po.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '0.65rem 0.75rem' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                                            <Link href={`/purchase-orders/${po.id}`} style={{ color: COLORS.accentBlueDark, textDecoration: 'none', fontWeight: 700, fontSize: FONT.sm }}>
                                              {po.number}
                                            </Link>
                                            <span style={{ fontSize: FONT.xs, color: COLORS.textMuted }}>{fmtDate(po.createdAt)}</span>
                                          </div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                                            <span style={{ fontSize: FONT.xs, color: COLORS.textSecondary, textTransform: 'capitalize' }}>{po.status}</span>
                                            <span style={{ fontSize: FONT.sm, color: COLORS.textPrimary, fontWeight: 600 }}>
                                              {fmtCurrency(po.totalAmount, po.currency)}
                                            </span>
                                          </div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Recurring PO Modal */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            background: '#fff', borderRadius: 14, padding: '1.75rem',
            width: '90%', maxWidth: 720, maxHeight: '92vh', overflowY: 'auto',
            boxShadow: SHADOWS.dropdown,
          }}>
            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: FONT.lg, fontWeight: 700, color: COLORS.textPrimary }}>New Recurring PO</h2>
              <button onClick={() => { setShowNew(false); resetForm(); setError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.textMuted, fontSize: 20 }}>
                &#x2715;
              </button>
            </div>

            {error && (
              <div style={{ background: COLORS.accentRedLight, color: COLORS.accentRedDark, padding: '0.5rem 0.75rem', borderRadius: 6, marginBottom: '1rem', fontSize: FONT.sm }}>
                {error}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              {/* Title */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>Title *</label>
                <input style={inp} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Monthly Office Supplies" />
              </div>

              {/* Description */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>Description</label>
                <textarea style={{ ...inp, height: 60, resize: 'vertical' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional notes..." />
              </div>

              {/* Vendor */}
              <div>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>Vendor</label>
                <select style={inp} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
                  <option value="">— None —</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>

              {/* Currency */}
              <div>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>Currency</label>
                <select style={inp} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  <option>USD</option><option>EUR</option><option>GBP</option><option>CAD</option>
                </select>
              </div>

              {/* Frequency */}
              <div>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>Frequency *</label>
                <select style={inp} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as any })}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                </select>
              </div>

              {/* Day of month (only when applicable) */}
              {['monthly', 'quarterly', 'annually'].includes(form.frequency) && (
                <div>
                  <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>Day of Month (1–28)</label>
                  <input type="number" style={inp} min={1} max={28} value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })} />
                </div>
              )}

              {/* Start date */}
              <div>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>First Run Date</label>
                <input type="date" style={inp} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>

              {/* Max runs */}
              <div>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>Max Runs (blank = unlimited)</label>
                <input type="number" style={inp} min={1} value={form.maxRuns} onChange={(e) => setForm({ ...form, maxRuns: e.target.value })} placeholder="Unlimited" />
              </div>

              {/* GL Account */}
              <div>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>GL Account</label>
                <input style={inp} value={form.glAccount} onChange={(e) => setForm({ ...form, glAccount: e.target.value })} placeholder="e.g. 6200" />
              </div>

              {/* Notes */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary, display: 'block', marginBottom: 4 }}>Notes</label>
                <textarea style={{ ...inp, height: 50, resize: 'vertical' }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Internal notes..." />
              </div>
            </div>

            {/* Line items */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary }}>Line Items *</label>
                <button onClick={addLine} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: FONT.xs, color: COLORS.accentBlue, fontWeight: 600 }}>
                  + Add Line
                </button>
              </div>
              <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 6, overflow: 'hidden' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '3fr 1fr 1fr 1fr 32px',
                  gap: 0,
                  background: COLORS.tableHeaderBg,
                  padding: '0.4rem 0.75rem',
                  borderBottom: `1px solid ${COLORS.border}`,
                }}>
                  {['Description', 'Qty', 'Unit Price', 'UOM', ''].map((h, i) => (
                    <span key={i} style={{ fontSize: FONT.xs, fontWeight: 600, color: COLORS.textSecondary }}>{h}</span>
                  ))}
                </div>
                {lines.map((line, i) => (
                  <div key={i} style={{
                    display: 'grid',
                    gridTemplateColumns: '3fr 1fr 1fr 1fr 32px',
                    gap: '0.4rem',
                    padding: '0.4rem 0.75rem',
                    borderBottom: i < lines.length - 1 ? `1px solid ${COLORS.border}` : 'none',
                    alignItems: 'center',
                  }}>
                    <input style={inp} placeholder="Item description" value={line.description} onChange={(e) => updateLine(i, 'description', e.target.value)} />
                    <input type="number" style={inp} min={0.01} step={0.01} value={line.quantity} onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))} />
                    <input type="number" style={inp} min={0} step={0.01} value={line.unitPrice} onChange={(e) => updateLine(i, 'unitPrice', Number(e.target.value))} />
                    <input style={inp} placeholder="each" value={line.unitOfMeasure} onChange={(e) => updateLine(i, 'unitOfMeasure', e.target.value)} />
                    <button
                      onClick={() => removeLine(i)}
                      disabled={lines.length === 1}
                      style={{ background: 'none', border: 'none', cursor: lines.length > 1 ? 'pointer' : 'not-allowed', color: COLORS.accentRed, fontSize: 16, padding: 0, opacity: lines.length === 1 ? 0.3 : 1 }}
                    >
                      &#x2715;
                    </button>
                  </div>
                ))}
                <div style={{ padding: '0.4rem 0.75rem', background: COLORS.tableHeaderBg, borderTop: `1px solid ${COLORS.border}`, display: 'flex', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: FONT.sm, fontWeight: 700, color: COLORS.textPrimary }}>
                    Total: {fmtCurrency(computedTotal, form.currency)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                onClick={() => { setShowNew(false); resetForm(); setError(''); }}
                style={{ background: 'none', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '0.5rem 1.25rem', fontSize: FONT.sm, cursor: 'pointer', color: COLORS.textSecondary }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                style={{
                  background: COLORS.accentBlue, color: '#fff', border: 'none',
                  borderRadius: 8, padding: '0.5rem 1.25rem', fontSize: FONT.sm,
                  fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Creating...' : 'Create Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
