'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { isRecordKind, recordHref } from '@betterspend/shared';
import {
  Bell,
  ChevronRight,
  Command,
  LockKeyhole,
  Menu,
  Search,
  Settings2,
  WifiOff,
  X,
} from 'lucide-react';
import SidebarNav from './sidebar-nav';
import { api, loadFailureState } from '../lib/api';
import { useIsMobile, useMediaQuery } from '../lib/use-media-query';
import { useBranding } from '../lib/branding';
import {
  canAccessProductRoute,
  canAccessProductAction,
  productActionForPathname,
  productRouteForPathname,
  productSearchResults,
  type ProductSearchResult,
} from '../lib/product-routes';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';
import { useAccess } from './access-provider';

function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="flex items-center justify-center gap-2 border-b border-amber-300/70 bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-950">
      <WifiOff className="size-3.5" />
      You are offline — some features may be unavailable
    </div>
  );
}

const AUTH_PATHS = ['/login', '/signup', '/punchout', '/forgot-password', '/reset-password', '/vendor-portal', '/account/verify-email'];
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
  product_destination: 'Destination',
  product_action: 'Action',
};

const TYPE_TONE: Record<string, string> = {
  requisition: 'bg-primary/12 text-primary',
  purchase_order: 'bg-emerald-100 text-emerald-800',
  invoice: 'bg-amber-100 text-amber-800',
  vendor: 'bg-violet-100 text-violet-800',
  catalog_item: 'bg-sky-100 text-sky-800',
  product_destination: 'bg-primary/12 text-primary',
  product_action: 'bg-amber-100 text-amber-800',
};

interface SearchResult {
  readonly id: string;
  readonly _type: string;
  readonly _href: string;
  readonly _label: string;
  readonly status?: string;
}

function displayProductSearchResult(result: ProductSearchResult): SearchResult {
  return {
    id: result.key,
    _type: result.resultType === 'Destination' ? 'product_destination' : 'product_action',
    _href: result.href,
    _label: result.label,
  };
}

function recordSearchResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== 'object') return [];

  const response = data as Record<string, unknown>;
  const resultGroups = [
    ['requisitions', 'requisition'],
    ['purchaseOrders', 'purchase_order'],
    ['invoices', 'invoice'],
    ['vendors', 'vendor'],
    ['catalogItems', 'catalog_item'],
  ] as const;

  return resultGroups.flatMap(([group, type]) => {
    const records = response[group];
    if (!Array.isArray(records)) return [];
    return records.flatMap((record): SearchResult[] => {
      if (!record || typeof record !== 'object') return [];
      const item = record as Record<string, unknown>;
      if (
        typeof item.id !== 'string' ||
        typeof item._href !== 'string' ||
        typeof item._label !== 'string'
      ) {
        return [];
      }
      return [
        {
          id: item.id,
          _type: type,
          _href: item._href,
          _label: item._label,
          ...(typeof item.status === 'string' ? { status: item.status } : {}),
        },
      ];
    });
  });
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

function GlobalSearch({ isMobile }: { isMobile: boolean }) {
  const router = useRouter();
  const { access } = useAccess();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleProductResults = useMemo(
    () => productSearchResults(query, access?.permissions ?? []),
    [access?.permissions, query],
  );

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
      api.search
        .query(query)
        .then((data: unknown) => {
          const all = [
            ...visibleProductResults.map(displayProductSearchResult),
            ...recordSearchResults(data),
          ];
          setTotalResults(all.length);
          setResults(all.slice(0, 10));
          setActiveIndex(all.length > 0 ? 0 : -1);
          setOpen(true);
        })
        .catch(() => {
          const fallback = visibleProductResults.map(displayProductSearchResult);
          setResults(fallback.slice(0, 10));
          setTotalResults(fallback.length);
          setActiveIndex(fallback.length > 0 ? 0 : -1);
          setOpen(fallback.length > 0);
        })
        .finally(() => setLoading(false));
    }, 300);
  }, [query, visibleProductResults]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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
      const nextRecentSearches = [
        normalizedQuery,
        ...recentSearches.filter((item) => item !== normalizedQuery),
      ].slice(0, 5);
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

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
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

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
      return;
    }

    if (event.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault();
      navigate(results[activeIndex]._href);
    }
  }

  return (
    <div ref={containerRef} className={cn('relative', isMobile ? 'w-full' : 'w-[22rem]')}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          data-global-search="true"
          aria-label="Global search"
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value.length >= 2 || recentSearches.length > 0) setOpen(true);
          }}
          onFocus={() => {
            if (results.length > 0 || recentSearches.length > 0) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search records, destinations, actions..."
          className="h-9 rounded-md border-border/70 bg-background/85 pl-10 pr-10 shadow-none backdrop-blur"
        />
        {loading ? (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">...</div>
        ) : (
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Command className="mr-1 inline size-3" />K
          </div>
        )}
      </div>

      {open && (results.length > 0 || (query.length < 2 && recentSearches.length > 0)) ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 animate-[slideDown_0.15s_ease-out_both] overflow-hidden rounded-lg border border-border/70 bg-card shadow-xl">
          {query.length < 2 && recentSearches.length > 0 ? (
            <>
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <span className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Recent Searches
                </span>
                <button
                  type="button"
                  onClick={clearRecentSearches}
                  className="text-xs font-semibold text-primary transition-colors hover:text-primary/80"
                >
                  Clear
                </button>
              </div>
              {recentSearches.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => applyRecentSearch(item)}
                  className="flex w-full items-center px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted/60"
                >
                  {item}
                </button>
              ))}
            </>
          ) : null}

          {results.map((result, index) => {
            const tone = TYPE_TONE[result._type] ?? 'bg-muted text-muted-foreground';
            return (
              <button
                key={`${result._type}-${result.id}`}
                onClick={() => navigate(result._href)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors',
                  activeIndex === index ? 'bg-muted/70' : 'hover:bg-muted/40',
                )}
              >
                <span className={cn('rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em]', tone)}>
                  {TYPE_LABELS[result._type] ?? result._type}
                </span>
                <span className="truncate text-sm text-foreground">{result._label}</span>
                {result.status ? (
                  <span className="ml-auto shrink-0 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {result.status}
                  </span>
                ) : null}
              </button>
            );
          })}

          {query.length >= 2 && totalResults > 0 ? (
            <div className="flex items-center justify-between bg-muted/50 px-4 py-3">
              <span className="text-xs text-muted-foreground">
                Showing {Math.min(results.length, 10)} of {totalResults} results
              </span>
              {totalResults > 10 ? (
                <button
                  type="button"
                  onClick={() => navigate(`/search?q=${encodeURIComponent(query.trim())}`)}
                  className="text-xs font-semibold text-primary transition-colors hover:text-primary/80"
                >
                  See all results
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AccessDeniedState({ routeLabel }: { routeLabel?: string }) {
  return (
    <div
      role="alert"
      className="flex min-h-[300px] flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <LockKeyhole className="h-6 w-6 text-destructive" aria-hidden="true" />
      <div>
        <h1 className="text-base font-semibold text-foreground">Access denied</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {routeLabel
            ? `You do not have permission to open ${routeLabel}. Return to your work or ask an administrator for access.`
            : 'You do not have access to this section. Return to your work or ask an administrator for access.'}
        </p>
      </div>
      <Link
        href="/"
        className="text-sm font-semibold text-primary transition-colors hover:text-primary/80"
      >
        Return to dashboard
      </Link>
    </div>
  );
}

function ProductRouteAccessBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { access, error, loading, resolved, refresh } = useAccess();
  const route = productRouteForPathname(pathname);
  const action = productActionForPathname(pathname);

  if (!resolved || loading) {
    return (
      <div role="status" aria-live="polite" className="p-8 text-sm text-muted-foreground">
        Checking access...
      </div>
    );
  }

  if (error) {
    if (loadFailureState(error) === 'denied') return <AccessDeniedState />;

    return (
      <div
        role="alert"
        className="flex min-h-[300px] flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <p className="text-base font-semibold text-foreground">Unable to verify access</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Try again. If this keeps happening, contact your administrator.
        </p>
        <Button type="button" variant="outline" onClick={() => void refresh()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!access) {
    return <AccessDeniedState />;
  }

  if (action && action.href !== route?.href && !canAccessProductAction(action, access.permissions)) {
    return <AccessDeniedState routeLabel={action.label} />;
  }

  if (route && !canAccessProductRoute(route, access.permissions)) {
    return <AccessDeniedState routeLabel={route.label} />;
  }

  return <>{children}</>;
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
    <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
      {!compactEntitySwitcher ? <span>Entity</span> : null}
      <select
        aria-label="Select active entity"
        value={selectedEntityId}
        onChange={(event) => {
          const nextValue = event.target.value;
          setSelectedEntityId(nextValue);
          if (typeof window !== 'undefined') {
            if (nextValue) window.localStorage.setItem(ENTITY_STORAGE_KEY, nextValue);
            else window.localStorage.removeItem(ENTITY_STORAGE_KEY);
            window.location.reload();
          }
        }}
        className={cn(
          'rounded-lg border border-border/70 bg-background/85 px-3 py-1.5 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
          compactEntitySwitcher ? 'min-w-[9rem]' : 'min-w-[12rem]',
        )}
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

function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasNewSinceLastView, setHasNewSinceLastView] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchCount = useCallback(() => {
    Promise.all([api.notifications.unreadCount(), api.notifications.list({ limit: 1 })])
      .then(([countData, latestData]) => {
        setUnreadCount(countData.count);
        const lastViewedAt =
          typeof window === 'undefined' ? null : window.localStorage.getItem(NOTIFICATION_LAST_VIEWED_KEY);
        const latest = latestData.items[0];
        setHasNewSinceLastView(
          Boolean(latest?.createdAt && lastViewedAt && new Date(latest.createdAt).getTime() > new Date(lastViewedAt).getTime()),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
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
      api.notifications
        .list({ limit: 10 })
        .then((data) => setNotifications(data.items))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
    setOpen((value) => !value);
  }

  async function handleMarkAllRead() {
    await api.notifications.markAllRead().catch(() => {});
    setNotifications((prev) => prev.map((notification) => ({ ...notification, readAt: new Date().toISOString() })));
    setUnreadCount(0);
  }

  async function handleNotificationClick(notification: any) {
    if (!notification.readAt) {
      await api.notifications.markRead(notification.id).catch(() => {});
      setNotifications((prev) =>
        prev.map((record) => (record.id === notification.id ? { ...record, readAt: new Date().toISOString() } : record)),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    }

    setOpen(false);
    if (
      notification.entityType &&
      notification.entityId &&
      isRecordKind(notification.entityType)
    ) {
      router.push(recordHref({ kind: notification.entityType, id: notification.entityId }));
    }
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={handleBellClick}
        aria-label="Notifications"
        className="relative inline-flex size-9 items-center justify-center rounded-lg border border-border/70 bg-background/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className={cn('size-4', unreadCount > 0 && 'text-primary')} />
        {hasNewSinceLastView && unreadCount === 0 ? (
          <span className="absolute right-2 top-2 size-2 rounded-full bg-destructive ring-2 ring-card" />
        ) : null}
        {unreadCount > 0 ? (
          <span className="absolute right-1.5 top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <Card className="absolute right-0 top-[calc(100%+0.75rem)] z-[100] w-[22rem] overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/70 pb-4">
            <CardTitle className="text-sm font-semibold">Notifications</CardTitle>
            <div className="flex items-center gap-3">
              <Link
                href="/settings#notifications"
                onClick={() => setOpen(false)}
                className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                Manage preferences
              </Link>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs font-semibold text-primary transition-colors hover:text-primary/80"
                >
                  Mark all read
                </button>
              ) : null}
            </div>
          </CardHeader>
          <div className="max-h-[26rem] overflow-y-auto">
            {loading ? <div className="px-6 py-8 text-center text-sm text-muted-foreground">Loading...</div> : null}
            {!loading && notifications.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">No notifications</div>
            ) : null}
            {!loading
              ? notifications.map((notification) => {
                  const isUnread = !notification.readAt;
                  return (
                    <button
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={cn(
                        'flex w-full flex-col gap-1 border-b border-border/60 px-6 py-4 text-left transition-colors hover:bg-muted/45',
                        isUnread && 'bg-primary/8',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {isUnread ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" /> : null}
                        <span className="flex-1 text-sm font-medium leading-6 text-foreground">{notification.title}</span>
                        <span className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                          {timeAgo(notification.createdAt)}
                        </span>
                      </div>
                      {notification.body ? (
                        <span className={cn('line-clamp-2 text-sm leading-6 text-muted-foreground', isUnread && 'pl-4')}>
                          {notification.body}
                        </span>
                      ) : null}
                      {notification.entityType && notification.entityId ? (
                        <span className={cn('text-xs font-semibold uppercase tracking-[0.2em] text-primary', isUnread && 'pl-4')}>
                          View {notification.entityType.replace('_', ' ')}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              : null}
          </div>
          <div className="flex items-center justify-between border-t border-border/70 bg-muted/40 px-6 py-3">
            <span className="text-xs text-muted-foreground">Showing up to 10 notifications</span>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-primary transition-colors hover:text-primary/80"
            >
              See all
            </Link>
          </div>
        </Card>
      ) : null}
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
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(19,18,21,0.48)] px-4 py-6"
    >
      <Card className="w-full max-w-xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <CardHeader className="border-b border-border/70 pb-4">
          <CardTitle className="text-base font-semibold">Keyboard Shortcuts</CardTitle>
          <p className="text-sm text-muted-foreground">Global navigation and form actions for faster workflows.</p>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          {[
            ['/', 'Focus global search'],
            ['Ctrl/Cmd + K', 'Focus global search'],
            ['Esc', 'Close open dropdowns or help modal'],
            ['?', 'Show keyboard shortcuts help'],
            ['Ctrl/Cmd + Enter', 'Submit the current form'],
            ['Ctrl/Cmd + S', 'Save the current form'],
          ].map(([shortcut, action]) => (
            <div key={shortcut} className="grid grid-cols-[150px_1fr] items-center gap-4">
              <span className="rounded-lg border border-border/70 bg-muted/60 px-3 py-2 font-mono text-xs font-bold text-foreground">
                {shortcut}
              </span>
              <span className="text-sm text-muted-foreground">{action}</span>
            </div>
          ))}
          <label className="flex gap-3 rounded-lg border border-border/70 bg-muted/35 p-4 text-sm">
            <input
              type="checkbox"
              checked={shortcutsDisabled}
              onChange={(event) => onToggleDisabled(event.target.checked)}
              className="mt-1"
            />
            <div>
              <div className="font-medium text-foreground">Disable keyboard shortcuts</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                Stores your preference in this browser for accessibility or screen-reader compatibility.
              </div>
            </div>
          </label>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [shortcutsDisabled, setShortcutsDisabled] = useState(false);
  const isAuthPage = AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(path + '/'));
  const branding = useBranding();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setShortcutsDisabled(window.localStorage.getItem(SHORTCUTS_DISABLED_KEY) === 'true');
    setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true');
  }, []);

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

      if (action === 'submit') form.requestSubmit();
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

  if (isAuthPage) return <>{children}</>;

  const sidebarWidth = isMobile ? 280 : sidebarCollapsed ? 88 : 268;

  function handleToggleSidebarCollapsed() {
    const nextValue = !sidebarCollapsed;
    setSidebarCollapsed(nextValue);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, nextValue ? 'true' : 'false');
    }
  }

  const sidebar = (
    <aside
      className={cn(
        'flex h-screen shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200',
        isMobile ? 'fixed left-0 top-0 z-[60]' : 'sticky top-0',
      )}
      style={{ width: `${sidebarWidth}px` }}
    >
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-4">
        {branding.app_logo_url ? (
          <img
            src={branding.app_logo_url}
            alt={branding.app_name}
            className="max-h-8 object-contain"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span
            title={sidebarCollapsed ? branding.app_name : undefined}
            className="text-lg font-bold tracking-[-0.02em] text-sidebar-foreground"
          >
            {sidebarCollapsed && !isMobile ? branding.app_name.slice(0, 2).toUpperCase() : branding.app_name}
          </span>
        )}
        <div className="flex items-center gap-1">
          {!isMobile ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleToggleSidebarCollapsed}
              className="size-8 rounded-lg text-sidebar-muted hover:bg-white/8 hover:text-sidebar-foreground"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <ChevronRight className={cn('size-4 transition-transform', !sidebarCollapsed && 'rotate-180')} />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(false)}
              className="size-8 rounded-lg text-sidebar-muted hover:bg-white/8 hover:text-sidebar-foreground"
              aria-label="Close sidebar"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>
      <SidebarNav onClose={() => setSidebarOpen(false)} collapsed={!isMobile && sidebarCollapsed} />
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <ShortcutsModal
        open={showShortcutsModal}
        shortcutsDisabled={shortcutsDisabled}
        onClose={() => setShowShortcutsModal(false)}
        onToggleDisabled={handleToggleShortcutsDisabled}
      />

      {!isMobile ? sidebar : null}

      {isMobile && sidebarOpen ? (
        <>
          <div className="fixed inset-0 z-50 bg-[rgba(19,18,21,0.48)]" onClick={() => setSidebarOpen(false)} />
          {sidebar}
        </>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineIndicator />
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/92 backdrop-blur-md">
          <div className="flex items-center gap-3 px-4 py-2.5 md:px-6">
            {isMobile ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(true)}
                className="size-9 rounded-lg border border-border/70 bg-background/80"
                aria-label="Open sidebar"
              >
                <Menu className="size-4" />
              </Button>
            ) : null}
            <GlobalSearch isMobile={isMobile} />
            <div className="hidden min-[520px]:block">
              <EntitySwitcher />
            </div>
            <div className="ml-auto flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowShortcutsModal(true)}
                className="hidden size-9 rounded-lg border border-border/70 bg-background/80 text-muted-foreground hover:bg-muted md:inline-flex"
                aria-label="Keyboard shortcuts"
              >
                <Settings2 className="size-4" />
              </Button>
              <NotificationBell />
            </div>
          </div>
          <div className="px-4 pb-3 min-[520px]:hidden md:px-6">
            <EntitySwitcher />
          </div>
        </header>

        <main className="flex-1 overflow-x-auto">
          <div className="mx-auto min-h-[calc(100vh-4.5rem)] w-full max-w-[1440px]">
            <ProductRouteAccessBoundary>{children}</ProductRouteAccessBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
