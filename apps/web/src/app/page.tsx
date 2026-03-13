'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { COLORS, SHADOWS } from '../lib/theme';
import { useIsMobile } from '../lib/use-media-query';

function fmt(n: string | number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function formatRelativeTime(value: string | Date | null | undefined, now = Date.now()) {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return '';

  const diffMs = now - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return 'Just now';
  if (diffMs < hour) {
    const minutes = Math.max(1, Math.floor(diffMs / minute));
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (diffMs < day) {
    const hours = Math.max(1, Math.floor(diffMs / hour));
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (diffMs < day * 2) return 'Yesterday';
  if (diffMs < day * 7) {
    const days = Math.max(1, Math.floor(diffMs / day));
    return `${days} days ago`;
  }

  return date.toLocaleDateString();
}

const ACCENT_MAP: Record<string, { border: string; light: string; text: string }> = {
  blue: { border: COLORS.accentBlue, light: COLORS.accentBlueLight, text: COLORS.accentBlueDark },
  green: {
    border: COLORS.accentGreen,
    light: COLORS.accentGreenLight,
    text: COLORS.accentGreenDark,
  },
  amber: {
    border: COLORS.accentAmber,
    light: COLORS.accentAmberLight,
    text: COLORS.accentAmberDark,
  },
  purple: {
    border: COLORS.accentPurple,
    light: COLORS.accentPurpleLight,
    text: COLORS.accentPurpleDark,
  },
};

function KpiCard({
  label,
  value,
  sub,
  href,
  accent = 'blue',
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  accent?: string;
}) {
  const a = ACCENT_MAP[accent] ?? ACCENT_MAP.blue;
  const inner = (
    <div
      style={{
        background: COLORS.cardBg,
        border: `1px solid ${COLORS.cardBorder}`,
        borderLeft: `3px solid ${a.border}`,
        borderRadius: '8px',
        padding: '1.25rem',
        textDecoration: 'none',
        color: 'inherit',
        display: 'block',
        transition: 'box-shadow 0.2s',
        boxShadow: SHADOWS.card,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = SHADOWS.cardHover)}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = SHADOWS.card)}
    >
      <div
        style={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          color: COLORS.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '0.5rem',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '1.625rem',
          fontWeight: 700,
          color: COLORS.textPrimary,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '0.8rem', color: COLORS.textMuted, marginTop: '0.375rem' }}>
          {sub}
        </div>
      )}
      {href && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: a.border, fontWeight: 500 }}>
          View &rarr;
        </div>
      )}
    </div>
  );
  return href ? (
    <Link href={href} style={{ textDecoration: 'none' }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

function ActionItem({
  label,
  count,
  href,
  urgent,
}: {
  label: string;
  count: number;
  href: string;
  urgent?: boolean;
}) {
  if (count === 0) return null;
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1rem',
          borderBottom: `1px solid ${COLORS.contentBg}`,
          cursor: 'pointer',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ fontSize: '0.8125rem', color: COLORS.textSecondary }}>{label}</span>
        <span
          style={{
            background: urgent ? COLORS.accentRedLight : COLORS.accentAmberLight,
            color: urgent ? COLORS.accentRedDark : COLORS.accentAmberDark,
            padding: '0.15rem 0.6rem',
            borderRadius: '9999px',
            fontSize: '0.6875rem',
            fontWeight: 600,
          }}
        >
          {count}
        </span>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const [kpis, setKpis] = useState<any>(null);
  const [pending, setPending] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [expiringContracts, setExpiringContracts] = useState<any[]>([]);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [autoApprovedSummary, setAutoApprovedSummary] = useState<{
    count: number;
    totalAmount: number;
  } | null>(null);
  const [autoApproveThreshold, setAutoApproveThreshold] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const isMobile = useIsMobile();

  useEffect(() => {
    Promise.all([
      api.analytics.kpis(),
      api.analytics.pendingItems(),
      api.analytics.recentActivity(),
      api.contracts.expiring(30).catch(() => []),
      api.inventory.lowStock().catch(() => []),
      api.approvals.autoApprovedSummary().catch(() => null),
      api.settings.getAll().catch(() => ({})),
    ])
      .then(([k, p, a, ec, ls, aas, settings]) => {
        setKpis(k);
        setPending(p);
        setActivity(Array.isArray(a) ? a : []);
        setExpiringContracts(Array.isArray(ec) ? ec : []);
        setLowStockItems(Array.isArray(ls) ? ls : []);
        if (aas) setAutoApprovedSummary(aas);
        const settingsMap = settings as Record<string, string>;
        if (settingsMap && settingsMap.auto_approve_threshold) {
          setAutoApproveThreshold(parseFloat(settingsMap.auto_approve_threshold) || 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setRelativeNow(Date.now()), 30 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const po = kpis?.purchaseOrders;
  const inv = kpis?.invoices;
  const req = kpis?.requisitions;
  const bud = kpis?.budgets;

  const totalActions = pending
    ? (pending.pendingApprovals ?? 0) +
      (pending.invoiceExceptions ?? 0) +
      (pending.overdueInvoices ?? 0) +
      (pending.spendGuardAlerts ?? 0) +
      (pending.upcomingSoftwareRenewals ?? 0)
    : 0;

  return (
    <div style={{ padding: isMobile ? '1.25rem 1rem' : '2rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
          Dashboard
        </h1>
        <p style={{ color: COLORS.textMuted, fontSize: '0.8125rem', marginTop: '0.25rem' }}>
          Welcome to BetterSpend — your P2P control center
        </p>
      </div>

      {/* KPI grid */}
      {loading ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: '0.75rem',
            marginBottom: '1.5rem',
          }}
        >
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              style={{
                background: COLORS.hoverBg,
                border: `1px solid ${COLORS.cardBorder}`,
                borderRadius: '8px',
                padding: '1.25rem',
                height: '100px',
              }}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: '0.75rem',
            marginBottom: '1.5rem',
          }}
        >
          <KpiCard
            label="Active POs"
            value={String(po?.active ?? 0)}
            sub={`${po?.total ?? 0} total · ${fmt(po?.totalValue)} committed`}
            href="/purchase-orders"
            accent="blue"
          />
          <KpiCard
            label="Open Requisitions"
            value={String(req?.total ?? 0)}
            sub="pending approval or in progress"
            href="/requisitions"
            accent="green"
          />
          <KpiCard
            label="Invoices Paid"
            value={fmt(inv?.paid)}
            sub={`${fmt(inv?.pending)} still pending`}
            href="/invoices"
            accent="amber"
          />
          <KpiCard
            label="Annual Budget"
            value={fmt(bud?.totalBudget)}
            sub="all active budgets combined"
            href="/budgets"
            accent="purple"
          />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        {/* Action items */}
        <div
          style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: SHADOWS.card,
          }}
        >
          <div
            style={{
              padding: '0.875rem 1rem',
              borderBottom: `1px solid ${COLORS.cardBorder}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: COLORS.textPrimary,
              }}
            >
              Action Required
            </h2>
            {totalActions > 0 && (
              <span
                style={{
                  background: COLORS.badgeRed,
                  color: '#fff',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '9999px',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                }}
              >
                {totalActions}
              </span>
            )}
          </div>
          {!pending || totalActions === 0 ? (
            <div
              style={{
                padding: '2rem',
                textAlign: 'center',
                color: COLORS.textMuted,
                fontSize: '0.8125rem',
              }}
            >
              {loading ? 'Loading...' : 'All caught up!'}
            </div>
          ) : (
            <div>
              <ActionItem
                label="Pending Approvals"
                count={pending.pendingApprovals ?? 0}
                href="/approvals"
              />
              <ActionItem
                label="Invoice Exceptions"
                count={pending.invoiceExceptions ?? 0}
                href="/invoices"
                urgent
              />
              <ActionItem
                label="Spend Guard Alerts"
                count={pending.spendGuardAlerts ?? 0}
                href="/spend-guard"
                urgent
              />
              <ActionItem
                label="Software Renewals Due"
                count={pending.upcomingSoftwareRenewals ?? 0}
                href="/software-licenses"
              />
              <ActionItem
                label="Requisitions Awaiting Approval"
                count={pending.requisitionsPendingApproval ?? 0}
                href="/requisitions"
              />
              <ActionItem
                label="POs Awaiting First Receipt"
                count={pending.posAwaitingReceipt ?? 0}
                href="/receiving"
              />
              <ActionItem
                label="Overdue Invoices"
                count={pending.overdueInvoices ?? 0}
                href="/invoices"
                urgent
              />
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div
          style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: SHADOWS.card,
          }}
        >
          <div style={{ padding: '0.875rem 1rem', borderBottom: `1px solid ${COLORS.cardBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
            <h2
              style={{
                margin: 0,
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: COLORS.textPrimary,
              }}
            >
              Recent Activity
            </h2>
            <Link
              href="/audit"
              style={{
                fontSize: '0.75rem',
                color: COLORS.accentBlue,
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              View audit log &rarr;
            </Link>
          </div>
          {loading ? (
            <div
              style={{
                padding: '2rem',
                textAlign: 'center',
                color: COLORS.textMuted,
                fontSize: '0.8125rem',
              }}
            >
              Loading...
            </div>
          ) : activity.length === 0 ? (
            <div
              style={{
                padding: '2rem',
                textAlign: 'center',
                color: COLORS.textMuted,
                fontSize: '0.8125rem',
              }}
            >
              No recent activity
            </div>
          ) : (
            <div style={{ overflowY: 'auto', maxHeight: '280px' }}>
              {activity.slice(0, 12).map((item, i) => (
                <div
                  key={item.id ?? i}
                  style={{
                    padding: '0.5rem 1rem',
                    borderBottom: `1px solid ${COLORS.contentBg}`,
                    display: 'flex',
                    gap: '0.625rem',
                    alignItems: 'flex-start',
                  }}
                >
                  <div
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: COLORS.accentBlue,
                      marginTop: '0.4rem',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', color: COLORS.textSecondary }}>
                      <span style={{ fontWeight: 600, color: COLORS.textPrimary }}>
                        {item.userName ?? 'System'}
                      </span>{' '}
                      <span>{item.action}</span>{' '}
                      <span style={{ color: COLORS.textMuted, textTransform: 'capitalize' }}>
                        {String(item.entityType ?? '').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '0.6875rem',
                        color: COLORS.textMuted,
                        marginTop: '0.125rem',
                      }}
                      title={item.createdAt ? new Date(item.createdAt).toISOString() : undefined}
                    >
                      {formatRelativeTime(item.createdAt, relativeNow)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Expiring Contracts */}
      {!loading && expiringContracts.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div
            style={{
              background: COLORS.accentAmberLight,
              border: `1px solid ${COLORS.accentAmber}`,
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '0.875rem 1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: `1px solid ${COLORS.accentAmber}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.875rem' }}>⚠️</span>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: COLORS.accentAmberDark,
                  }}
                >
                  Contracts Expiring Within 30 Days
                </h2>
              </div>
              <Link
                href="/contracts?filter=expiring_soon"
                style={{
                  fontSize: '0.75rem',
                  color: COLORS.accentAmberDark,
                  fontWeight: 500,
                  textDecoration: 'none',
                }}
              >
                View all contracts &rarr;
              </Link>
            </div>
            <div>
              {expiringContracts.slice(0, 5).map((c: any) => {
                const daysLeft = c.endDate
                  ? Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000)
                  : null;
                return (
                  <Link key={c.id} href={`/contracts/${c.id}`} style={{ textDecoration: 'none' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.625rem 1rem',
                        borderBottom: `1px solid rgba(217,119,6,0.15)`,
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = 'rgba(217,119,6,0.08)')
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: '0.8125rem',
                            fontWeight: 500,
                            color: COLORS.textPrimary,
                          }}
                        >
                          {c.contractNumber} — {c.title}
                        </div>
                        <div
                          style={{
                            fontSize: '0.75rem',
                            color: COLORS.textMuted,
                            marginTop: '0.125rem',
                          }}
                        >
                          {c.vendor?.name ?? 'Unknown vendor'}
                        </div>
                      </div>
                      <span
                        style={{
                          background:
                            (daysLeft ?? 99) <= 7 ? COLORS.accentRedLight : COLORS.accentAmberLight,
                          color:
                            (daysLeft ?? 99) <= 7 ? COLORS.accentRedDark : COLORS.accentAmberDark,
                          border: `1px solid ${(daysLeft ?? 99) <= 7 ? COLORS.accentRed : COLORS.accentAmber}`,
                          padding: '0.15rem 0.5rem',
                          borderRadius: '9999px',
                          fontSize: '0.6875rem',
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {daysLeft != null
                          ? daysLeft <= 0
                            ? 'Expired'
                            : `${daysLeft}d left`
                          : 'Check date'}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Low Stock Alert */}
      {!loading && lowStockItems.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div
            style={{
              background: COLORS.accentAmberLight,
              border: `1px solid ${COLORS.accentAmber}`,
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '0.875rem 1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: `1px solid ${COLORS.accentAmber}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: COLORS.accentAmberDark,
                  }}
                >
                  Low Stock Alert — {lowStockItems.length} item
                  {lowStockItems.length !== 1 ? 's' : ''} below reorder point
                </h2>
              </div>
              <Link
                href="/inventory?lowStockOnly=true"
                style={{
                  fontSize: '0.75rem',
                  color: COLORS.accentAmberDark,
                  fontWeight: 500,
                  textDecoration: 'none',
                }}
              >
                Go to inventory &rarr;
              </Link>
            </div>
            <div>
              {lowStockItems.slice(0, 5).map((item: any) => (
                <Link
                  key={item.id}
                  href={`/inventory/${item.id}`}
                  style={{ textDecoration: 'none' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.625rem 1rem',
                      borderBottom: `1px solid rgba(217,119,6,0.15)`,
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'rgba(217,119,6,0.08)')
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: '0.8125rem',
                          fontWeight: 500,
                          color: COLORS.textPrimary,
                        }}
                      >
                        {item.name}
                      </div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: COLORS.textMuted,
                          marginTop: '0.125rem',
                        }}
                      >
                        SKU: {item.sku}
                        {item.location ? ` · ${item.location}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '1rem' }}>
                      <span
                        style={{
                          background:
                            item.stockStatus === 'out_of_stock'
                              ? COLORS.accentRedLight
                              : COLORS.accentAmberLight,
                          color:
                            item.stockStatus === 'out_of_stock'
                              ? COLORS.accentRedDark
                              : COLORS.accentAmberDark,
                          border: `1px solid ${item.stockStatus === 'out_of_stock' ? COLORS.accentRed : COLORS.accentAmber}`,
                          padding: '0.15rem 0.5rem',
                          borderRadius: '9999px',
                          fontSize: '0.6875rem',
                          fontWeight: 600,
                        }}
                      >
                        {item.stockStatus === 'out_of_stock' ? 'Out of Stock' : 'Low Stock'}
                      </span>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: COLORS.textMuted,
                          marginTop: '0.25rem',
                        }}
                      >
                        {item.quantityOnHand} {item.unit} on hand
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Auto-approved this month widget */}
      {!loading && autoApproveThreshold > 0 && autoApprovedSummary !== null && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div
            style={{
              background: COLORS.cardBg,
              border: `1px solid ${COLORS.cardBorder}`,
              borderLeft: `3px solid ${COLORS.accentGreen}`,
              borderRadius: '8px',
              padding: '1rem 1.25rem',
              boxShadow: SHADOWS.card,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  color: COLORS.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '0.25rem',
                }}
              >
                Auto-approved this month
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.375rem', fontWeight: 700, color: COLORS.textPrimary }}>
                  {autoApprovedSummary.count}
                </span>
                <span style={{ fontSize: '0.8125rem', color: COLORS.textSecondary }}>
                  requisition{autoApprovedSummary.count !== 1 ? 's' : ''} &middot;{' '}
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    maximumFractionDigits: 0,
                  }).format(autoApprovedSummary.totalAmount)}{' '}
                  total
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginTop: '0.25rem' }}>
                Fast lane threshold: $
                {autoApproveThreshold.toLocaleString('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
            <div
              style={{
                background: COLORS.accentGreenLight,
                color: COLORS.accentGreenDark,
                padding: '0.375rem 0.875rem',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              Fast Lane Active
            </div>
          </div>
        </div>
      )}

      {/* Quick actions — softer style */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h2
          style={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: COLORS.textSecondary,
            marginBottom: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Quick Actions
        </h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[
            { label: 'New Requisition', href: '/requisitions/new', accent: 'blue' },
            { label: 'New PO', href: '/purchase-orders/new', accent: 'green' },
            { label: 'Receive Goods', href: '/receiving/new', accent: 'amber' },
            { label: 'New Invoice', href: '/invoices/new', accent: 'purple' },
            { label: 'New Vendor', href: '/vendors/new', accent: 'neutral' },
            { label: 'New Budget', href: '/budgets/new', accent: 'neutral' },
          ].map((a) => {
            const ac =
              a.accent === 'neutral'
                ? { bg: COLORS.contentBg, text: COLORS.textSecondary, border: COLORS.border }
                : {
                    bg: (ACCENT_MAP[a.accent] ?? ACCENT_MAP.blue).light,
                    text: (ACCENT_MAP[a.accent] ?? ACCENT_MAP.blue).text,
                    border: 'transparent',
                  };
            return (
              <Link
                key={a.href}
                href={a.href}
                style={{
                  padding: '0.4375rem 0.875rem',
                  background: ac.bg,
                  color: ac.text,
                  border: `1px solid ${ac.border}`,
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                + {a.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Module overview */}
      <div>
        <h2
          style={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: COLORS.textSecondary,
            marginBottom: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Modules
        </h2>
        <div
          style={{
            display: 'grid',
            gap: '0.625rem',
            gridTemplateColumns: isMobile
              ? 'repeat(auto-fill, minmax(150px, 1fr))'
              : 'repeat(auto-fill, minmax(200px, 1fr))',
          }}
        >
          {[
            { title: 'Vendors', href: '/vendors', desc: 'Supplier master records & contracts' },
            { title: 'Catalog', href: '/catalog', desc: 'Pre-approved items for requisitions' },
            {
              title: 'Requisitions',
              href: '/requisitions',
              desc: 'Submit and track purchase requests',
            },
            {
              title: 'Purchase Orders',
              href: '/purchase-orders',
              desc: 'Issue and manage PO lifecycle',
            },
            { title: 'Approvals', href: '/approvals', desc: 'Pending items requiring your action' },
            { title: 'Receiving', href: '/receiving', desc: 'Log goods receipts (GRN)' },
            { title: 'Inventory', href: '/inventory', desc: 'Track stock levels and movements' },
            { title: 'Invoices', href: '/invoices', desc: 'AP and 3-way invoice matching' },
            { title: 'Budgets', href: '/budgets', desc: 'Department & project budgets' },
            { title: 'GL Integration', href: '/gl-mappings', desc: 'QuickBooks / Xero mapping' },
            { title: 'Contracts', href: '/contracts', desc: 'Manage vendor contracts & renewals' },
            { title: 'Analytics', href: '/analytics', desc: 'Spend intelligence & KPIs' },
            {
              title: 'Approval Rules',
              href: '/approval-rules',
              desc: 'Configure auto-routing rules',
            },
            { title: 'Webhooks', href: '/webhooks', desc: 'Outbound event integrations' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'block',
                padding: '0.875rem',
                background: COLORS.cardBg,
                borderRadius: '8px',
                border: `1px solid ${COLORS.cardBorder}`,
                textDecoration: 'none',
                color: 'inherit',
                transition: 'border-color 0.15s, box-shadow 0.15s',
                boxShadow: SHADOWS.card,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = COLORS.accentBlue;
                e.currentTarget.style.boxShadow = SHADOWS.cardHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = COLORS.cardBorder;
                e.currentTarget.style.boxShadow = SHADOWS.card;
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  color: COLORS.textPrimary,
                  fontSize: '0.8125rem',
                  marginBottom: '0.25rem',
                }}
              >
                {item.title}
              </div>
              <div style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>{item.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
