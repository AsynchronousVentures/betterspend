'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS, FONT } from '../../../lib/theme';

/* ── Types ── */

interface AgingBucket {
  count: number;
  totalAmount: string;
}

interface AgingReport {
  current: AgingBucket;
  days_1_30: AgingBucket;
  days_31_60: AgingBucket;
  days_61_90: AgingBucket;
  days_90_plus: AgingBucket;
}

interface Invoice {
  id: string;
  internalNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  totalAmount: string;
  status: string;
  paidAt?: string;
  earlyPaymentDiscountPercent?: string;
  earlyPaymentDiscountBy?: string;
  paymentTerms?: string;
  vendor?: { name: string };
}

/* ── Helpers ── */

function fmt(amount: string | number): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function daysOverdue(dueDateStr?: string): number {
  if (!dueDateStr) return 0;
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}

function agingColor(days: number): string {
  if (days <= 0) return COLORS.accentGreen;
  if (days <= 30) return COLORS.accentAmber;
  if (days <= 60) return '#f97316';
  return COLORS.accentRed;
}

function statusBadge(status: string): React.CSSProperties {
  const map: Record<string, { bg: string; color: string }> = {
    paid: { bg: COLORS.accentGreenLight, color: COLORS.accentGreenDark },
    approved: { bg: COLORS.accentBlueLight, color: COLORS.accentBlueDark },
    matched: { bg: COLORS.accentPurpleLight, color: COLORS.accentPurpleDark },
    exception: { bg: COLORS.accentRedLight, color: COLORS.accentRedDark },
    pending_match: { bg: COLORS.accentAmberLight, color: COLORS.accentAmberDark },
    draft: { bg: '#f1f5f9', color: '#475569' },
  };
  const s = map[status] ?? map.draft;
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '9999px',
    fontSize: FONT.xs,
    fontWeight: 600,
    background: s.bg,
    color: s.color,
  };
}

/* ── Mark Paid Modal ── */

function MarkPaidModal({
  invoice,
  onClose,
  onSuccess,
}: {
  invoice: Invoice;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [paymentReference, setPaymentReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.invoices.markPaid(invoice.id, { paymentReference: paymentReference || undefined });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to mark as paid');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: SHADOWS.overlay,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: COLORS.cardBg,
          borderRadius: '12px',
          padding: '2rem',
          width: '100%',
          maxWidth: '420px',
          boxShadow: SHADOWS.dropdown,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 0.25rem', fontSize: FONT.lg, color: COLORS.textPrimary }}>
          Mark Invoice as Paid
        </h3>
        <p style={{ margin: '0 0 1.5rem', fontSize: FONT.sm, color: COLORS.textSecondary }}>
          {invoice.internalNumber} — {invoice.vendor?.name} — {fmt(invoice.totalAmount)}
        </p>
        {error && (
          <div
            style={{
              background: COLORS.accentRedLight,
              color: COLORS.accentRedDark,
              padding: '0.75rem 1rem',
              borderRadius: '6px',
              fontSize: FONT.sm,
              marginBottom: '1rem',
            }}
          >
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: FONT.sm, fontWeight: 500, color: COLORS.textPrimary }}>
            Payment Reference (optional)
          </label>
          <input
            type="text"
            value={paymentReference}
            onChange={(e) => setPaymentReference(e.target.value)}
            placeholder="e.g. CHK-12345 or wire ref"
            style={{
              width: '100%',
              padding: '0.625rem 0.75rem',
              border: `1px solid ${COLORS.inputBorder}`,
              borderRadius: '6px',
              fontSize: FONT.sm,
              color: COLORS.textPrimary,
              outline: 'none',
              boxSizing: 'border-box',
              marginBottom: '1.5rem',
            }}
          />
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.5rem 1.25rem',
                border: `1px solid ${COLORS.border}`,
                borderRadius: '6px',
                background: 'transparent',
                fontSize: FONT.sm,
                color: COLORS.textSecondary,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '0.5rem 1.25rem',
                border: 'none',
                borderRadius: '6px',
                background: loading ? '#93c5fd' : COLORS.accentBlue,
                color: '#fff',
                fontSize: FONT.sm,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Saving...' : 'Mark Paid'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main Page ── */

export default function ApAgingPage() {
  const [aging, setAging] = useState<AgingReport | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [earlyPayCount, setEarlyPayCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [markPaidInvoice, setMarkPaidInvoice] = useState<Invoice | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [agingData, allInvoices, earlyPay] = await Promise.all([
        api.invoices.aging(),
        api.invoices.list(),
        api.invoices.earlyPaymentOpportunities(),
      ]);
      setAging(agingData);
      // Show unpaid invoices only (paidAt null and status != 'paid')
      setInvoices(
        (allInvoices as Invoice[]).filter((inv) => !inv.paidAt && inv.status !== 'paid')
      );
      setEarlyPayCount((earlyPay as any[]).length);
    } catch (err: any) {
      setError(err.message || 'Failed to load AP aging data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalOverdue = aging
    ? (
        parseFloat(aging.days_1_30.totalAmount) +
        parseFloat(aging.days_31_60.totalAmount) +
        parseFloat(aging.days_61_90.totalAmount) +
        parseFloat(aging.days_90_plus.totalAmount)
      ).toFixed(2)
    : '0.00';

  const dueIn7Days = invoices.filter((inv) => {
    if (!inv.dueDate) return false;
    const due = new Date(inv.dueDate);
    const today = new Date();
    const in7 = new Date();
    in7.setDate(today.getDate() + 7);
    return due >= today && due <= in7;
  });

  const buckets = aging
    ? [
        { label: 'Current', key: 'current' as const, color: COLORS.accentGreen, bg: COLORS.accentGreenLight },
        { label: '1-30 Days', key: 'days_1_30' as const, color: COLORS.accentAmber, bg: COLORS.accentAmberLight },
        { label: '31-60 Days', key: 'days_31_60' as const, color: '#f97316', bg: '#fff7ed' },
        { label: '61-90 Days', key: 'days_61_90' as const, color: '#ef4444', bg: '#fff1f2' },
        { label: '90+ Days', key: 'days_90_plus' as const, color: '#dc2626', bg: COLORS.accentRedLight },
      ]
    : [];

  if (loading) {
    return (
      <div style={{ padding: '2rem', color: COLORS.textSecondary, fontSize: FONT.sm }}>
        Loading AP aging data...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', color: COLORS.accentRed, fontSize: FONT.sm }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ margin: 0, fontSize: FONT.xxl, fontWeight: 700, color: COLORS.textPrimary }}>
          AP Aging
        </h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: FONT.sm, color: COLORS.textSecondary }}>
          Accounts payable aging report and payment management
        </p>
      </div>

      {/* Stat cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        {[
          {
            label: 'Total Overdue',
            value: fmt(totalOverdue),
            color: COLORS.accentRed,
            bg: COLORS.accentRedLight,
          },
          {
            label: 'Due in 7 Days',
            value: fmt(dueIn7Days.reduce((s, inv) => s + parseFloat(inv.totalAmount || '0'), 0)),
            sub: `${dueIn7Days.length} invoice${dueIn7Days.length !== 1 ? 's' : ''}`,
            color: COLORS.accentAmber,
            bg: COLORS.accentAmberLight,
          },
          {
            label: 'Early Payment Opportunities',
            value: `${earlyPayCount}`,
            sub: 'discounts expiring in 14 days',
            color: COLORS.accentGreen,
            bg: COLORS.accentGreenLight,
          },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: COLORS.cardBg,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: '10px',
              padding: '1.25rem 1.5rem',
              boxShadow: SHADOWS.card,
            }}
          >
            <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              {card.label}
            </div>
            <div style={{ fontSize: FONT.xl, fontWeight: 700, color: card.color }}>
              {card.value}
            </div>
            {card.sub && (
              <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, marginTop: '0.25rem' }}>
                {card.sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Aging Bucket Cards */}
      {aging && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '0.75rem',
            marginBottom: '2rem',
          }}
        >
          {buckets.map((b) => {
            const bucket = aging[b.key];
            return (
              <div
                key={b.key}
                style={{
                  background: b.bg,
                  border: `1px solid ${b.color}30`,
                  borderRadius: '10px',
                  padding: '1rem 1.25rem',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: FONT.xs, fontWeight: 600, color: b.color, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                  {b.label}
                </div>
                <div style={{ fontSize: FONT.lg, fontWeight: 700, color: b.color }}>
                  {fmt(bucket.totalAmount)}
                </div>
                <div style={{ fontSize: FONT.xs, color: b.color, opacity: 0.8, marginTop: '0.25rem' }}>
                  {bucket.count} invoice{bucket.count !== 1 ? 's' : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Invoice Table */}
      <div
        style={{
          background: COLORS.cardBg,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: '10px',
          boxShadow: SHADOWS.card,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${COLORS.border}` }}>
          <h2 style={{ margin: 0, fontSize: FONT.md, fontWeight: 600, color: COLORS.textPrimary }}>
            Unpaid Invoices
          </h2>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: FONT.sm }}>
            <thead>
              <tr style={{ background: COLORS.tableHeaderBg }}>
                {[
                  'Vendor',
                  'Invoice #',
                  'Invoice Date',
                  'Due Date',
                  'Amount',
                  'Days Overdue',
                  'Discount Available',
                  'Status',
                  'Actions',
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '0.75rem 1rem',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: COLORS.textSecondary,
                      fontSize: FONT.xs,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      borderBottom: `1px solid ${COLORS.tableBorder}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      padding: '3rem',
                      textAlign: 'center',
                      color: COLORS.textMuted,
                      fontSize: FONT.sm,
                    }}
                  >
                    No unpaid invoices found.
                  </td>
                </tr>
              )}
              {invoices.map((inv, i) => {
                const overdueDays = daysOverdue(inv.dueDate);
                const isOverdue = overdueDays > 0;
                const hasDiscount =
                  inv.earlyPaymentDiscountPercent && parseFloat(inv.earlyPaymentDiscountPercent) > 0;

                return (
                  <tr
                    key={inv.id}
                    style={{
                      background: i % 2 === 0 ? COLORS.cardBg : COLORS.hoverBg,
                      borderBottom: `1px solid ${COLORS.tableBorder}`,
                    }}
                  >
                    <td style={{ padding: '0.75rem 1rem', color: COLORS.textPrimary, fontWeight: 500 }}>
                      {inv.vendor?.name ?? '—'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary }}>
                      <div style={{ fontWeight: 500, color: COLORS.textPrimary }}>{inv.internalNumber}</div>
                      <div style={{ fontSize: FONT.xs, color: COLORS.textMuted }}>{inv.invoiceNumber}</div>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>
                      {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                      {inv.dueDate ? (
                        <span style={{ color: isOverdue ? COLORS.accentRed : COLORS.textSecondary }}>
                          {new Date(inv.dueDate).toLocaleDateString()}
                        </span>
                      ) : (
                        <span style={{ color: COLORS.textMuted }}>No due date</span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: COLORS.textPrimary, whiteSpace: 'nowrap' }}>
                      {fmt(inv.totalAmount)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      {isOverdue ? (
                        <span
                          style={{
                            fontWeight: 600,
                            color: agingColor(overdueDays),
                            fontSize: FONT.sm,
                          }}
                        >
                          {overdueDays}d overdue
                        </span>
                      ) : inv.dueDate ? (
                        <span style={{ color: COLORS.accentGreen, fontSize: FONT.sm }}>
                          {Math.abs(overdueDays)}d remaining
                        </span>
                      ) : (
                        <span style={{ color: COLORS.textMuted }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      {hasDiscount ? (
                        <div>
                          <span
                            style={{
                              background: COLORS.accentGreenLight,
                              color: COLORS.accentGreenDark,
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              fontSize: FONT.xs,
                              fontWeight: 600,
                            }}
                          >
                            {inv.earlyPaymentDiscountPercent}% off
                          </span>
                          {inv.earlyPaymentDiscountBy && (
                            <div style={{ fontSize: FONT.xs, color: COLORS.textMuted, marginTop: '2px' }}>
                              by {new Date(inv.earlyPaymentDiscountBy).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: COLORS.textMuted }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={statusBadge(inv.status)}>{inv.status.replace(/_/g, ' ')}</span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      {inv.status === 'approved' && (
                        <button
                          onClick={() => setMarkPaidInvoice(inv)}
                          style={{
                            padding: '0.375rem 0.875rem',
                            background: COLORS.accentGreen,
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: FONT.xs,
                            fontWeight: 600,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Mark Paid
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mark Paid Modal */}
      {markPaidInvoice && (
        <MarkPaidModal
          invoice={markPaidInvoice}
          onClose={() => setMarkPaidInvoice(null)}
          onSuccess={() => {
            setMarkPaidInvoice(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}
