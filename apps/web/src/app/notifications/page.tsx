'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

const NOTIFICATION_PREFS_KEY = 'betterspend:notification-preferences';

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

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(NOTIFICATION_PREFS_KEY);
      setPrefs(stored ? { ...DEFAULT_PREFS, ...JSON.parse(stored) } : DEFAULT_PREFS);
    } catch {
      setPrefs(DEFAULT_PREFS);
    }

    setLoading(true);
    api.notifications
      .list({ limit: 100 })
      .then(setNotifications)
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false));
  }, []);

  const availableTypes = useMemo(
    () => Array.from(new Set(notifications.map((item) => item.type).filter(Boolean))).sort(),
    [notifications],
  );

  const filteredNotifications = useMemo(() => {
    const filtered = notifications
      .filter((item) => prefs.enabledTypes.includes(item.type))
      .filter((item) => (showUnreadOnly ? !item.readAt : true))
      .filter((item) => (typeFilter === 'all' ? true : item.type === typeFilter));

    return filtered.sort((a, b) =>
      sortOrder === 'newest'
        ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [notifications, prefs.enabledTypes, showUnreadOnly, sortOrder, typeFilter]);

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
              Full notification history with read-state and type filtering.
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
            <input type="checkbox" checked={prefs.emailEnabled} readOnly />
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: COLORS.textPrimary }}>Email notifications</div>
              <div style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>Current first-pass UI only. Delivery preference is not yet server-enforced.</div>
            </div>
          </label>
          <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>Digest Frequency</div>
            <div style={{ fontSize: '0.875rem', color: COLORS.textPrimary, marginTop: '0.35rem' }}>{prefs.frequency}</div>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>Enabled Types</div>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {prefs.enabledTypes.map((type) => (
                <span key={type} style={{ padding: '0.2rem 0.5rem', borderRadius: '999px', background: COLORS.contentBg, color: COLORS.textSecondary, fontSize: '0.75rem' }}>
                  {type.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
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
              {filteredNotifications.length} shown
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '2rem', color: COLORS.textMuted }}>Loading notifications...</div>
          ) : filteredNotifications.length === 0 ? (
            <div style={{ padding: '2rem', color: COLORS.textMuted }}>No notifications match the current filters.</div>
          ) : (
            filteredNotifications.map((notification) => {
              const unread = !notification.readAt;
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
                        {notification.entityType && notification.entityId ? (
                          <Link href={notification.entityType === 'purchase_order' ? `/purchase-orders/${notification.entityId}` : notification.entityType === 'invoice' ? `/invoices/${notification.entityId}` : notification.entityType === 'requisition' ? `/requisitions/${notification.entityId}` : '/'} style={{ fontSize: '0.75rem', color: COLORS.accentBlue, textDecoration: 'none', fontWeight: 600 }}>
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
        </div>
      </div>
    </div>
  );
}
