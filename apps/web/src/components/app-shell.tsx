'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import SidebarNav from './sidebar-nav';
import { api } from '../lib/api';
import { COLORS, SHADOWS } from '../lib/theme';
import { useIsMobile, useMediaQuery } from '../lib/use-media-query';
import { useBranding } from '../lib/branding';

/* ── Offline Indicator ── */

function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    const go = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', go);
    window.addEventListener('offline', go);
    return () => {
      window.removeEventListener('online', go);
      window.removeEventListener('offline', go);
    };
  }, []);
  if (!isOffline) return null;
  return (
    <div style={{
      background: '#f59e0b',
      color: '#000',
      textAlign: 'center',
      padding: '0.25rem',
      fontSize: '0.75rem',
      fontWeight: 600,
    }}>
      You are offline — some features may be unavailable
    </div>
  );
}

const AUTH_PATHS = ['/login', '/signup', '/punchout', '/forgot-password', '/reset-password', '/vendor-portal'];
const ENTITY_STORAGE_KEY = 'betterspend:selected-entity-id';
const SHORTCUTS_DISABLED_KEY = 'betterspend:shortcuts-disabled';
const SIDEBAR_COLLAPSED_KEY = 'betterspend:sidebar-collapsed';
const RECENT_SEARCHES_KEY = 'betterspend:recent-searches';
const NOTIFICATION_LAST_VIEWED_KEY = 'betterspend:notification-last-viewed-at';
const TYPE_LABELS: Record<string, string> = {
  requisition: 'Req',
  purchase_order: 'PO',
  invoice: 'Inv',
  vendor: 'Vendor',
  catalog_item: 'Catalog',
};

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  requisition: { bg: COLORS.accentBlueLight, text: COLORS.accentBlueDark },
  purchase_order: { bg: COLORS.accentGreenLight, text: COLORS.accentGreenDark },
  invoice: { bg: COLORS.accentAmberLight, text: COLORS.accentAmberDark },
  vendor: { bg: COLORS.accentPurpleLight, text: COLORS.accentPurpleDark },
  catalog_item: { bg: '#f0f9ff', text: '#0369a1' },
};

type NotificationPreferences = {
  emailEnabled: boolean;
  frequency: 'instant' | 'daily' | 'weekly';
  enabledTypes: string[];
};

/* ── Hamburger Icon ── */

function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 5h14M3 10h14M3 15h14" stroke={COLORS.textSecondary} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ── Close Icon ── */

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M5 5l10 10M15 5L5 15" stroke={COLORS.sidebarText} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path
        d={collapsed ? 'M7 5l5 5-5 5' : 'M13 5l-5 5 5 5'}
        stroke={COLORS.sidebarText}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Global Search ── */

function GlobalSearch({ isMobile }: { isMobile: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(RECENT_SEARCHES_KEY);
      setRecentSearches(stored ? JSON.parse(stored) : []);
    } catch {
      setRecentSearches([]);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setResults([]);
      setTotalResults(0);
      setActiveIndex(-1);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      api.search.query(query)
        .then((data: any) => {
          const all: any[] = [
            ...data.requisitions,
            ...data.purchaseOrders,
            ...data.invoices,
            ...data.vendors,
            ...data.catalogItems,
          ];
          setTotalResults(all.length);
          setResults(all.slice(0, 10));
          setActiveIndex(all.length > 0 ? 0 : -1);
          setOpen(true);
        })
        .catch(() => {
          setResults([]);
          setTotalResults(0);
          setActiveIndex(-1);
        })
        .finally(() => setLoading(false));
    }, 300);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function navigate(href: string) {
    setOpen(false);
    const normalizedQuery = query.trim();
    if (normalizedQuery) {
      const nextRecentSearches = [normalizedQuery, ...recentSearches.filter((item) => item !== normalizedQuery)].slice(0, 5);
      setRecentSearches(nextRecentSearches);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(nextRecentSearches));
      }
    }
    setActiveIndex(-1);
    router.push(href);
  }

  function applyRecentSearch(searchValue: string) {
    setQuery(searchValue);
    setOpen(true);
    inputRef.current?.focus();
  }

  function clearRecentSearches() {
    setRecentSearches([]);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(RECENT_SEARCHES_KEY);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      if (query) {
        setQuery('');
        setResults([]);
        setTotalResults(0);
      }
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
      return;
    }

    if (!open || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
      return;
    }

    if (e.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      e.preventDefault();
      navigate(results[activeIndex]._href);
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: isMobile ? '100%' : '360px' }}>
      <input
        data-global-search="true"
        aria-label="Global search"
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.length >= 2 || recentSearches.length > 0) setOpen(true);
        }}
        onFocus={() => {
          if (results.length > 0 || recentSearches.length > 0) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search requisitions, POs, invoices..."
        style={{
          width: '100%',
          padding: '0.5rem 0.75rem',
          border: `1px solid ${COLORS.border}`,
          borderRadius: '8px',
          fontSize: '0.8125rem',
          background: COLORS.contentBg,
          color: COLORS.textPrimary,
          outline: 'none',
          boxSizing: 'border-box',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
        onFocusCapture={(e) => {
          (e.currentTarget as HTMLInputElement).style.borderColor = COLORS.accentBlue;
          (e.currentTarget as HTMLInputElement).style.boxShadow = SHADOWS.focusRing;
        }}
        onBlurCapture={(e) => {
          (e.currentTarget as HTMLInputElement).style.borderColor = COLORS.border;
          (e.currentTarget as HTMLInputElement).style.boxShadow = 'none';
        }}
      />
      {loading && (
        <div style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: COLORS.textMuted, fontSize: '0.75rem' }}>...</div>
      )}
      {open && (results.length > 0 || (query.length < 2 && recentSearches.length > 0)) && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          right: 0,
          background: COLORS.white,
          border: `1px solid ${COLORS.border}`,
          borderRadius: '10px',
          boxShadow: SHADOWS.dropdown,
          zIndex: 100,
          overflow: 'hidden',
        }}>
          {query.length < 2 && recentSearches.length > 0 ? (
            <>
              <div style={{ padding: '0.625rem 0.875rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${COLORS.contentBg}` }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: COLORS.textSecondary }}>Recent Searches</span>
                <button
                  type="button"
                  onClick={clearRecentSearches}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: COLORS.accentBlue, padding: 0 }}
                >
                  Clear
                </button>
              </div>
              {recentSearches.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => applyRecentSearch(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    padding: '0.625rem 0.875rem',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    borderBottom: `1px solid ${COLORS.contentBg}`,
                    fontSize: '0.8125rem',
                    color: COLORS.textPrimary,
                  }}
                >
                  {item}
                </button>
              ))}
            </>
          ) : null}
          {results.map((r, index) => {
            const tc = TYPE_COLORS[r._type] ?? { bg: COLORS.contentBg, text: COLORS.textSecondary };
            return (
              <button
                key={`${r._type}-${r.id}`}
                onClick={() => navigate(r._href)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  width: '100%',
                  padding: '0.625rem 0.875rem',
                  background: activeIndex === index ? COLORS.hoverBg : 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderBottom: `1px solid ${COLORS.contentBg}`,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span style={{
                  background: tc.bg,
                  color: tc.text,
                  padding: '0.125rem 0.4rem',
                  borderRadius: '4px',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  minWidth: '40px',
                  textAlign: 'center',
                }}>
                  {TYPE_LABELS[r._type] ?? r._type}
                </span>
                <span style={{
                  fontSize: '0.8125rem',
                  color: COLORS.textPrimary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {r._label}
                </span>
                {r.status && (
                  <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: COLORS.textMuted, flexShrink: 0 }}>{r.status}</span>
                )}
              </button>
            );
          })}
          {query.length >= 2 && totalResults > 0 && (
            <div style={{ padding: '0.625rem 0.875rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: COLORS.contentBg }}>
              <span style={{ fontSize: '0.75rem', color: COLORS.textSecondary }}>
                Showing {Math.min(results.length, 10)} of {totalResults} results
              </span>
              {totalResults > 10 ? (
                <button
                  type="button"
                  onClick={() => navigate(`/search?q=${encodeURIComponent(query.trim())}`)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '0.75rem', color: COLORS.accentBlue, fontWeight: 600 }}
                >
                  See all results
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Bell Icon ── */

function BellIcon({ hasUnread }: { hasUnread: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M10 2a6 6 0 0 0-6 6v2.5l-1.5 2V14h15v-1.5L16 10.5V8a6 6 0 0 0-6-6z"
        stroke={hasUnread ? COLORS.accentBlue : COLORS.textSecondary}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 14a2 2 0 0 0 4 0"
        stroke={hasUnread ? COLORS.accentBlue : COLORS.textSecondary}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

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

function EntitySwitcher() {
  const [entities, setEntities] = useState<any[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const compactEntitySwitcher = useMediaQuery('(max-width: 479px)');

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(ENTITY_STORAGE_KEY) ?? '' : '';
    setSelectedEntityId(stored);
    api.entities.list().then(setEntities).catch(() => {});
  }, []);

  if (entities.length === 0) return null;

  return (
    <label
      title="Choose the active entity scope"
      style={{ display: 'flex', alignItems: 'center', gap: compactEntitySwitcher ? 0 : '0.5rem', fontSize: '0.75rem', color: COLORS.textSecondary }}
    >
      {!compactEntitySwitcher ? <span style={{ whiteSpace: 'nowrap' }}>Entity</span> : null}
      <select
        aria-label="Select active entity"
        value={selectedEntityId}
        onChange={(e) => {
          const nextValue = e.target.value;
          setSelectedEntityId(nextValue);
          if (typeof window !== 'undefined') {
            if (nextValue) window.localStorage.setItem(ENTITY_STORAGE_KEY, nextValue);
            else window.localStorage.removeItem(ENTITY_STORAGE_KEY);
            window.location.reload();
          }
        }}
        style={{
          minWidth: compactEntitySwitcher ? '120px' : '180px',
          padding: '0.45rem 0.65rem',
          border: `1px solid ${COLORS.border}`,
          borderRadius: '8px',
          fontSize: '0.8125rem',
          background: COLORS.contentBg,
          color: COLORS.textPrimary,
        }}
      >
        <option value="">All entities</option>
        {entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name} ({entity.code})
          </option>
        ))}
      </select>
    </label>
  );
}

const ENTITY_ROUTES: Record<string, string> = {
  requisition: '/requisitions',
  purchase_order: '/purchase-orders',
  invoice: '/invoices',
};

/* ── Notification Bell ── */

function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [hasNewSinceLastView, setHasNewSinceLastView] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    emailEnabled: true,
    frequency: 'instant',
    enabledTypes: ['approval_request', 'po_issued', 'invoice_exception', 'invoice_approved', 'spend_guard', 'software_license'],
  });

  useEffect(() => {
    api.notifications.getPreferences()
      .then((stored) => setPreferences((prev) => ({ ...prev, ...stored })))
      .catch(() => {});
  }, []);

  async function updatePreferences(nextValue: Partial<NotificationPreferences>) {
    const merged: NotificationPreferences = { ...preferences, ...nextValue };
    setPreferences(merged);
    const saved = await api.notifications.updatePreferences(merged).catch(() => merged);
    setPreferences((prev) => ({ ...prev, ...saved }));
  }

  const fetchCount = useCallback(() => {
    Promise.all([
      api.notifications.unreadCount(),
      api.notifications.list({ limit: 1 }),
    ])
      .then(([countData, latestData]) => {
        setUnreadCount(countData.count);
        const lastViewedAt = typeof window === 'undefined'
          ? null
          : window.localStorage.getItem(NOTIFICATION_LAST_VIEWED_KEY);
        const latest = latestData.items[0];
        setHasNewSinceLastView(
          Boolean(
            latest?.createdAt
            && lastViewedAt
            && new Date(latest.createdAt).getTime() > new Date(lastViewedAt).getTime(),
          ),
        );
      })
      .catch(() => {});
  }, []);

  // Initial fetch + polling every 30s
  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    function handleShortcutEscape() {
      setOpen(false);
    }

    window.addEventListener('betterspend:escape', handleShortcutEscape as EventListener);
    return () => window.removeEventListener('betterspend:escape', handleShortcutEscape as EventListener);
  }, []);

  function handleBellClick() {
    if (!open) {
      setLoading(true);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(NOTIFICATION_LAST_VIEWED_KEY, new Date().toISOString());
      }
      setHasNewSinceLastView(false);
      api.notifications.list({ limit: 10 })
        .then((data) => setNotifications(data.items.filter((item) => preferences.enabledTypes.includes(item.type))))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
    setOpen((v) => !v);
  }

  async function handleMarkAllRead() {
    await api.notifications.markAllRead().catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    setUnreadCount(0);
  }

  async function handleNotificationClick(notification: any) {
    if (!notification.readAt) {
      await api.notifications.markRead(notification.id).catch(() => {});
      setNotifications((prev) =>
        prev.map((n) => n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    if (notification.entityType && notification.entityId) {
      const base = ENTITY_ROUTES[notification.entityType];
      if (base) router.push(`${base}/${notification.entityId}`);
    }
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={handleBellClick}
        aria-label="Notifications"
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0.375rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '8px',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
      >
        <BellIcon hasUnread={unreadCount > 0} />
        {hasNewSinceLastView && unreadCount === 0 && (
          <span
            style={{
              position: 'absolute',
              top: '3px',
              right: '3px',
              width: '8px',
              height: '8px',
              borderRadius: '999px',
              background: COLORS.badgeRed,
              border: `2px solid ${COLORS.white}`,
            }}
          />
        )}
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '2px',
              right: '2px',
              background: COLORS.badgeRed,
              color: COLORS.white,
              borderRadius: '999px',
              fontSize: '0.625rem',
              fontWeight: 700,
              lineHeight: 1,
              minWidth: '16px',
              height: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {preferencesOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '320px',
            background: COLORS.white,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '12px',
            boxShadow: SHADOWS.dropdown,
            zIndex: 101,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '0.875rem 1rem', borderBottom: `1px solid ${COLORS.border}`, fontWeight: 600, fontSize: '0.875rem', color: COLORS.textPrimary }}>
            Notification Preferences
          </div>
          <div style={{ padding: '0.875rem 1rem', display: 'grid', gap: '0.875rem' }}>
            <label style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start' }}>
              <input type="checkbox" checked={preferences.emailEnabled} onChange={(event) => { void updatePreferences({ emailEnabled: event.target.checked }); }} />
              <div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: COLORS.textPrimary }}>Enable email notifications</div>
                <div style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>Saved locally for now. Server-side delivery preferences are still pending.</div>
              </div>
            </label>
            <div>
              <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.35rem' }}>Frequency</div>
              <select value={preferences.frequency} onChange={(event) => { void updatePreferences({ frequency: event.target.value as NotificationPreferences['frequency'] }); }} style={{ width: '100%', padding: '0.5rem 0.65rem', borderRadius: '8px', border: `1px solid ${COLORS.border}`, fontSize: '0.8125rem' }}>
                <option value="instant">Instant</option>
                <option value="daily">Daily digest</option>
                <option value="weekly">Weekly digest</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.35rem' }}>Visible Types</div>
              <div style={{ display: 'grid', gap: '0.4rem' }}>
                {['approval_request', 'po_issued', 'invoice_exception', 'invoice_approved', 'spend_guard', 'software_license'].map((type) => (
                  <label key={type} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8125rem', color: COLORS.textPrimary }}>
                    <input
                      type="checkbox"
                      checked={preferences.enabledTypes.includes(type)}
                      onChange={(event) => {
                        void updatePreferences({
                          enabledTypes: event.target.checked
                            ? [...preferences.enabledTypes, type]
                            : preferences.enabledTypes.filter((item) => item !== type),
                        });
                      }}
                    />
                    {type.replace(/_/g, ' ')}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '360px',
            background: COLORS.white,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '12px',
            boxShadow: SHADOWS.dropdown,
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              borderBottom: `1px solid ${COLORS.border}`,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: '0.875rem', color: COLORS.textPrimary }}>
              Notifications
            </span>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button
                onClick={() => setPreferencesOpen((value) => !value)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  color: COLORS.textSecondary,
                  padding: 0,
                  fontWeight: 500,
                }}
              >
                Preferences
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    color: COLORS.accentBlue,
                    padding: 0,
                    fontWeight: 500,
                  }}
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {loading && (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: COLORS.textMuted, fontSize: '0.8125rem' }}>
                Loading...
              </div>
            )}
            {!loading && notifications.length === 0 && (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: COLORS.textMuted, fontSize: '0.8125rem' }}>
                No notifications
              </div>
            )}
            {!loading && notifications.map((n) => {
              const isUnread = !n.readAt;
              return (
                <button
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    width: '100%',
                    padding: '0.75rem 1rem',
                    background: isUnread ? COLORS.accentBlueLight : 'none',
                    border: 'none',
                    borderBottom: `1px solid ${COLORS.border}`,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = isUnread ? '#e0edff' : COLORS.hoverBg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = isUnread ? COLORS.accentBlueLight : 'none')}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                    {isUnread && (
                      <span
                        style={{
                          flexShrink: 0,
                          marginTop: '5px',
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          background: COLORS.accentBlue,
                        }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: '0.8125rem',
                        fontWeight: isUnread ? 600 : 500,
                        color: COLORS.textPrimary,
                        flex: 1,
                        lineHeight: 1.4,
                      }}
                    >
                      {n.title}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: '0.6875rem', color: COLORS.textMuted, marginTop: '2px' }}>
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  {n.body && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: COLORS.textSecondary,
                        lineHeight: 1.4,
                        paddingLeft: isUnread ? '1.0625rem' : 0,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {n.body}
                    </span>
                  )}
                  {n.entityType && n.entityId && (
                    <span
                      style={{
                        paddingLeft: isUnread ? '1.0625rem' : 0,
                        fontSize: '0.6875rem',
                        color: COLORS.accentBlue,
                        fontWeight: 500,
                      }}
                    >
                      View {n.entityType.replace('_', ' ')} &rarr;
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div style={{ padding: '0.75rem 1rem', borderTop: `1px solid ${COLORS.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>Showing up to 10 notifications</span>
            <Link href="/notifications" onClick={() => setOpen(false)} style={{ fontSize: '0.75rem', color: COLORS.accentBlue, textDecoration: 'none', fontWeight: 600 }}>
              See all &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function ShortcutsModal({
  open,
  shortcutsDisabled,
  onClose,
  onToggleDisabled,
}: {
  open: boolean;
  shortcutsDisabled: boolean;
  onClose: () => void;
  onToggleDisabled: (nextValue: boolean) => void;
}) {
  useEffect(() => {
    if (!open) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: SHADOWS.overlay,
        zIndex: 120,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '520px',
          background: COLORS.white,
          borderRadius: '12px',
          border: `1px solid ${COLORS.border}`,
          boxShadow: SHADOWS.dropdown,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '1rem 1.25rem', borderBottom: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: COLORS.textPrimary }}>Keyboard Shortcuts</div>
          <div style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, marginTop: '0.25rem' }}>
            Global navigation and form actions for faster workflows.
          </div>
        </div>
        <div style={{ padding: '1rem 1.25rem', display: 'grid', gap: '0.75rem' }}>
          {[
            ['/', 'Focus global search'],
            ['Ctrl/Cmd + K', 'Focus global search'],
            ['Esc', 'Close open dropdowns or help modal'],
            ['?', 'Show keyboard shortcuts help'],
            ['Ctrl/Cmd + Enter', 'Submit the current form'],
            ['Ctrl/Cmd + S', 'Save the current form'],
          ].map(([shortcut, action]) => (
            <div key={shortcut} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '1rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: COLORS.textPrimary, fontFamily: 'monospace', background: COLORS.contentBg, padding: '0.25rem 0.5rem', borderRadius: '6px', border: `1px solid ${COLORS.border}` }}>
                {shortcut}
              </span>
              <span style={{ fontSize: '0.875rem', color: COLORS.textSecondary }}>{action}</span>
            </div>
          ))}
          <label style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start', marginTop: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={shortcutsDisabled}
              onChange={(event) => onToggleDisabled(event.target.checked)}
              style={{ marginTop: '0.2rem' }}
            />
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: COLORS.textPrimary }}>Disable keyboard shortcuts</div>
              <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginTop: '0.125rem' }}>
                Stores your preference in this browser for accessibility or screen-reader compatibility.
              </div>
            </div>
          </label>
        </div>
        <div style={{ padding: '1rem 1.25rem', borderTop: `1px solid ${COLORS.border}`, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.55rem 0.9rem',
              borderRadius: '8px',
              border: 'none',
              background: COLORS.accentBlue,
              color: COLORS.white,
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── AppShell ── */

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [shortcutsDisabled, setShortcutsDisabled] = useState(false);
  const isAuthPage = AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const branding = useBranding();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setShortcutsDisabled(window.localStorage.getItem(SHORTCUTS_DISABLED_KEY) === 'true');
    setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true');
  }, []);

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (shortcutsDisabled) return;

    function isTypingTarget(target: EventTarget | null) {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tagName = element.tagName;
      return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || element.isContentEditable;
    }

    function focusGlobalSearch() {
      const input = document.querySelector<HTMLInputElement>('input[data-global-search="true"]');
      input?.focus();
      input?.select();
    }

    function triggerFormAction(action: 'submit' | 'save') {
      const activeElement = document.activeElement as HTMLElement | null;
      const form = activeElement?.closest('form');
      if (!form) return;

      const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"], input[type="submit"]');
      if (submitButton) {
        submitButton.click();
        return;
      }

      if (action === 'submit') {
        form.requestSubmit();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      const typing = isTypingTarget(event.target);
      const lowerKey = event.key.toLowerCase();
      const hasMeta = event.metaKey || event.ctrlKey;

      if (event.key === 'Escape') {
        window.dispatchEvent(new Event('betterspend:escape'));
        setSidebarOpen(false);
        setShowShortcutsModal(false);
        return;
      }

      if (hasMeta && lowerKey === 'k') {
        event.preventDefault();
        focusGlobalSearch();
        return;
      }

      if (hasMeta && lowerKey === 'enter') {
        event.preventDefault();
        triggerFormAction('submit');
        return;
      }

      if (hasMeta && lowerKey === 's') {
        const activeElement = document.activeElement as HTMLElement | null;
        if (activeElement?.closest('form')) {
          event.preventDefault();
          triggerFormAction('save');
        }
        return;
      }

      if (!typing && event.key === '/') {
        event.preventDefault();
        focusGlobalSearch();
        return;
      }

      if (!typing && event.key === '?') {
        event.preventDefault();
        setShowShortcutsModal(true);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcutsDisabled]);

  function handleToggleShortcutsDisabled(nextValue: boolean) {
    setShortcutsDisabled(nextValue);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SHORTCUTS_DISABLED_KEY, nextValue ? 'true' : 'false');
    }
  }

  if (isAuthPage) {
    return <>{children}</>;
  }

  const SIDEBAR_WIDTH = isMobile ? 280 : sidebarCollapsed ? 72 : 240;

  function handleToggleSidebarCollapsed() {
    const nextValue = !sidebarCollapsed;
    setSidebarCollapsed(nextValue);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, nextValue ? 'true' : 'false');
    }
  }

  const sidebar = (
    <aside
      style={{
        width: `${SIDEBAR_WIDTH}px`,
        flexShrink: 0,
        background: COLORS.sidebarBg,
        color: COLORS.sidebarTextActive,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        transition: 'width 0.2s ease',
        ...(isMobile ? {
          position: 'fixed' as const,
          top: 0,
          left: 0,
          zIndex: 60,
        } : {
          position: 'sticky' as const,
          top: 0,
        }),
      }}
    >
      {/* Sidebar header */}
      <div
        style={{
          padding: '1rem 1.25rem',
          borderBottom: `1px solid ${COLORS.sidebarBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        {branding.app_logo_url ? (
          <img src={branding.app_logo_url} alt={branding.app_name} style={{ maxHeight: '32px', objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <span
            title={sidebarCollapsed ? branding.app_name : undefined}
            style={{
              fontWeight: 700,
              fontSize: sidebarCollapsed ? '0.875rem' : '1.0625rem',
              color: COLORS.sidebarTextActive,
              letterSpacing: '-0.02em',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {sidebarCollapsed ? branding.app_name.slice(0, 2).toUpperCase() : branding.app_name}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {!isMobile && (
            <button
              onClick={handleToggleSidebarCollapsed}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
              }}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <CollapseIcon collapsed={sidebarCollapsed} />
            </button>
          )}
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Close sidebar"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>
      <SidebarNav onClose={() => setSidebarOpen(false)} collapsed={!isMobile && sidebarCollapsed} />
    </aside>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: COLORS.contentBg }}>
      <ShortcutsModal
        open={showShortcutsModal}
        shortcutsDisabled={shortcutsDisabled}
        onClose={() => setShowShortcutsModal(false)}
        onToggleDisabled={handleToggleShortcutsDisabled}
      />
      {/* Desktop sidebar */}
      {!isMobile && sidebar}

      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <>
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: SHADOWS.overlay,
              zIndex: 50,
            }}
          />
          {sidebar}
        </>
      )}

      {/* Main content column */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Offline banner */}
        <OfflineIndicator />
        {/* Top bar */}
        <div style={{
          background: COLORS.topbarBg,
          padding: isMobile ? '0.625rem 1rem' : '0.625rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          borderBottom: `1px solid ${COLORS.topbarBorder}`,
          flexShrink: 0,
          position: 'sticky' as const,
          top: 0,
          zIndex: 40,
        }}>
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(true)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0.375rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.hoverBg)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              aria-label="Open sidebar"
            >
              <HamburgerIcon />
            </button>
          )}
          <GlobalSearch isMobile={isMobile} />
          <EntitySwitcher />
          <div style={{ marginLeft: 'auto' }}>
            <NotificationBell />
          </div>
        </div>

        {/* Page content */}
        <main style={{ flex: 1, overflowX: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
