'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

type NotificationPrefs = {
  emailEnabled: boolean;
  frequency: 'instant' | 'daily' | 'weekly';
  enabledTypes: string[];
};

const DEFAULT_PREFS: NotificationPrefs = {
  emailEnabled: true,
  frequency: 'instant',
  enabledTypes: ['approval_request', 'po_issued', 'invoice_exception', 'invoice_approved', 'spend_guard', 'software_license'],
};

const PAGE_SIZE = 20;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function entityHref(notification: any): string | null {
  if (!notification.entityType || !notification.entityId) return null;
  if (notification.entityType === 'purchase_order') return `/purchase-orders/${notification.entityId}`;
  if (notification.entityType === 'invoice') return `/invoices/${notification.entityId}`;
  if (notification.entityType === 'requisition') return `/requisitions/${notification.entityId}`;
  return null;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    Promise.all([
      api.notifications.getPreferences().catch(() => DEFAULT_PREFS),
      api.notifications.types().catch(() => []),
    ]).then(([storedPrefs, types]) => {
      setPrefs({ ...DEFAULT_PREFS, ...storedPrefs });
      setAvailableTypes(types);
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    api.notifications
      .list({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        type: typeFilter,
        status: showUnreadOnly ? 'unread' : 'all',
        sort: sortOrder,
      })
      .then((data) => {
        setNotifications(data.items);
        setTotal(data.total);
      })
      .catch(() => {
        setNotifications([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [page, showUnreadOnly, sortOrder, typeFilter]);

  useEffect(() => {
    setPage(1);
  }, [showUnreadOnly, sortOrder, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filteredNotifications = useMemo(
    () => notifications.filter((item) => prefs.enabledTypes.includes(item.type)),
    [notifications, prefs.enabledTypes],
  );

  async function persistPreferences(nextPrefs: NotificationPrefs) {
    setPrefs(nextPrefs);
    setSavingPrefs(true);
    try {
      const saved = await api.notifications.updatePreferences(nextPrefs);
      setPrefs({ ...DEFAULT_PREFS, ...saved });
    } finally {
      setSavingPrefs(false);
    }
  }

  async function handleMarkRead(id: string) {
    await api.notifications.markRead(id).catch(() => {});
    setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)));
  }

  async function handleMarkAllRead() {
    await api.notifications.markAllRead().catch(() => {});
    setNotifications((prev) => prev.map((item) => ({ ...item, readAt: new Date().toISOString() })));
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1080px' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/" style={{ color: COLORS.textSecondary, textDecoration: 'none', fontSize: '0.875rem' }}>
          &larr; Back to Dashboard
        </Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>Notifications</h1>
            <p style={{ color: COLORS.textSecondary, fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
              Full notification history with saved delivery preferences and paginated filters.
            </p>
          </div>
          <button
            type="button"
            onClick={handleMarkAllRead}
            style={{
              padding: '0.55rem 0.9rem',
              borderRadius: '8px',
              border: `1px solid ${COLORS.border}`,
              background: COLORS.cardBg,
              color: COLORS.textPrimary,
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Mark all read
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1rem' }}>
        <div
          style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '10px',
            boxShadow: SHADOWS.card,
            padding: '1rem',
            alignSelf: 'start',
          }}
        >
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: COLORS.textPrimary, marginTop: 0 }}>Preferences</h2>
          <label style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start', marginTop: '0.75rem' }}>
            <input
              type="checkbox"
              checked={prefs.emailEnabled}
              onChange={(event) => persistPreferences({ ...prefs, emailEnabled: event.target.checked })}
            />
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: COLORS.textPrimary }}>Email notifications</div>
              <div style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>Stored server-side for this user.</div>
            </div>
          </label>
          <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>Digest Frequency</div>
            <select
              value={prefs.frequency}
              onChange={(event) => persistPreferences({ ...prefs, frequency: event.target.value as NotificationPrefs['frequency'] })}
              style={{ width: '100%', marginTop: '0.35rem', padding: '0.55rem 0.65rem', borderRadius: '8px', border: `1px solid ${COLORS.border}`, fontSize: '0.8125rem' }}
            >
              <option value="instant">Instant</option>
              <option value="daily">Daily digest</option>
              <option value="weekly">Weekly digest</option>
            </select>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>Enabled Types</div>
            <div style={{ display: 'grid', gap: '0.45rem', marginTop: '0.6rem' }}>
              {availableTypes.map((type) => (
                <label key={type} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8125rem', color: COLORS.textPrimary }}>
                  <input
                    type="checkbox"
                    checked={prefs.enabledTypes.includes(type)}
                    onChange={(event) => {
                      const enabledTypes = event.target.checked
                        ? [...prefs.enabledTypes, type]
                        : prefs.enabledTypes.filter((item) => item !== type);
                      persistPreferences({ ...prefs, enabledTypes });
                    }}
                  />
                  {type.replace(/_/g, ' ')}
                </label>
              ))}
            </div>
            {savingPrefs && <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: COLORS.textMuted }}>Saving preferences...</div>}
          </div>
        </div>

        <div
          style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '10px',
            boxShadow: SHADOWS.card,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '0.875rem 1rem', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.8125rem', color: COLORS.textSecondary }}>
              <input type="checkbox" checked={showUnreadOnly} onChange={(event) => setShowUnreadOnly(event.target.checked)} />
              Unread only
            </label>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', border: `1px solid ${COLORS.border}`, fontSize: '0.8125rem' }}>
              <option value="all">All types</option>
              {availableTypes.map((type) => (
                <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as 'newest' | 'oldest')} style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', border: `1px solid ${COLORS.border}`, fontSize: '0.8125rem' }}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            <div style={{ marginLeft: 'auto', fontSize: '0.75rem', color: COLORS.textMuted }}>
              Page {page} of {pageCount}
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '2rem', color: COLORS.textMuted }}>Loading notifications...</div>
          ) : filteredNotifications.length === 0 ? (
            <div style={{ padding: '2rem', color: COLORS.textMuted }}>No notifications match the current filters or enabled types.</div>
          ) : (
            filteredNotifications.map((notification) => {
              const unread = !notification.readAt;
              const href = entityHref(notification);
              return (
                <div key={notification.id} style={{ padding: '0.9rem 1rem', borderBottom: `1px solid ${COLORS.contentBg}`, background: unread ? COLORS.accentBlueLight : COLORS.white }}>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '999px', background: unread ? COLORS.accentBlue : 'transparent', marginTop: '0.35rem', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline' }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: unread ? 600 : 500, color: COLORS.textPrimary }}>{notification.title}</div>
                        <div style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>{timeAgo(notification.createdAt)}</div>
                      </div>
                      {notification.body ? (
                        <div style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, marginTop: '0.25rem', lineHeight: 1.5 }}>{notification.body}</div>
                      ) : null}
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.6875rem', color: COLORS.textMuted, background: COLORS.contentBg, padding: '0.15rem 0.45rem', borderRadius: '999px' }}>
                          {notification.type.replace(/_/g, ' ')}
                        </span>
                        {href ? (
                          <Link href={href} style={{ fontSize: '0.75rem', color: COLORS.accentBlue, textDecoration: 'none', fontWeight: 600 }}>
                            Open record &rarr;
                          </Link>
                        ) : null}
                        {unread ? (
                          <button type="button" onClick={() => handleMarkRead(notification.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.75rem', color: COLORS.accentBlue, fontWeight: 600 }}>
                            Mark read
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          <div style={{ padding: '0.875rem 1rem', borderTop: `1px solid ${COLORS.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>
              {total} total notifications
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                style={{ padding: '0.45rem 0.75rem', borderRadius: '8px', border: `1px solid ${COLORS.border}`, background: page <= 1 ? COLORS.contentBg : COLORS.white, color: COLORS.textPrimary, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={page >= pageCount}
                style={{ padding: '0.45rem 0.75rem', borderRadius: '8px', border: `1px solid ${COLORS.border}`, background: page >= pageCount ? COLORS.contentBg : COLORS.white, color: COLORS.textPrimary, cursor: page >= pageCount ? 'not-allowed' : 'pointer' }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
