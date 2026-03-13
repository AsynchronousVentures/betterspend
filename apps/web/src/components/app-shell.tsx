'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import SidebarNav from './sidebar-nav';
import { api } from '../lib/api';
import { COLORS, SHADOWS } from '../lib/theme';
import { useIsMobile } from '../lib/use-media-query';
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

/* ── Global Search ── */

function GlobalSearch({ isMobile }: { isMobile: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); return; }
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
          setResults(all.slice(0, 10));
          setOpen(true);
        })
        .catch(() => setResults([]))
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
    setQuery('');
    setResults([]);
    router.push(href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: isMobile ? '100%' : '360px' }}>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => { setQuery(e.target.value); if (e.target.value.length >= 2) setOpen(true); }}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
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
      {open && results.length > 0 && (
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
          {results.map((r) => {
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
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderBottom: `1px solid ${COLORS.contentBg}`,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.hoverBg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
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

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(ENTITY_STORAGE_KEY) ?? '' : '';
    setSelectedEntityId(stored);
    api.entities.list().then(setEntities).catch(() => {});
  }, []);

  if (entities.length === 0) return null;

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: COLORS.textSecondary }}>
      <span style={{ whiteSpace: 'nowrap' }}>Entity</span>
      <select
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
          minWidth: '180px',
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
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchCount = useCallback(() => {
    api.notifications.unreadCount()
      .then((data) => setUnreadCount(data.count))
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

  function handleBellClick() {
    if (!open) {
      setLoading(true);
      api.notifications.list({ limit: 10 })
        .then((data) => setNotifications(data))
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
        </div>
      )}
    </div>
  );
}

/* ── AppShell ── */

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isAuthPage = AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const branding = useBranding();

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (isAuthPage) {
    return <>{children}</>;
  }

  const SIDEBAR_WIDTH = isMobile ? 280 : 240;

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
          <span style={{
            fontWeight: 700,
            fontSize: '1.0625rem',
            color: COLORS.sidebarTextActive,
            letterSpacing: '-0.02em',
          }}>
            {branding.app_name}
          </span>
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
      <SidebarNav onClose={() => setSidebarOpen(false)} />
    </aside>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: COLORS.contentBg }}>
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
