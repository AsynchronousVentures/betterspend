'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BellRing } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Select } from '../../components/ui/select';

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
    <div className="space-y-6 p-4 lg:p-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      <PageHeader
        title="Notifications"
        description="Full notification history with saved delivery preferences and paginated filters."
        actions={
          <Button variant="outline" onClick={handleMarkAllRead}>
            Mark all read
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="text-base">Preferences</CardTitle>
            <CardDescription>Stored server-side for your account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={prefs.emailEnabled}
                onChange={(event) => persistPreferences({ ...prefs, emailEnabled: event.target.checked })}
              />
              <div>
                <div className="text-sm font-medium text-foreground">Email notifications</div>
                <div className="text-xs text-muted-foreground">Deliver messages outside the app.</div>
              </div>
            </label>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Digest Frequency</div>
              <Select
                value={prefs.frequency}
                onChange={(event) =>
                  persistPreferences({ ...prefs, frequency: event.target.value as NotificationPrefs['frequency'] })
                }
                className="w-full"
              >
                <option value="instant">Instant</option>
                <option value="daily">Daily digest</option>
                <option value="weekly">Weekly digest</option>
              </Select>
            </div>

            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Enabled Types</div>
              <div className="grid gap-2">
                {availableTypes.map((type) => (
                  <label key={type} className="flex items-center gap-3 text-sm text-foreground">
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
                    <span className="capitalize">{type.replace(/_/g, ' ')}</span>
                  </label>
                ))}
              </div>
              {savingPrefs ? <div className="text-xs text-muted-foreground">Saving preferences...</div> : null}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="gap-4 border-b border-border/70 bg-muted/20 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base">Inbox</CardTitle>
              <CardDescription>
                Page {page} of {pageCount} · {total} total notifications
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={showUnreadOnly} onChange={(event) => setShowUnreadOnly(event.target.checked)} />
                Unread only
              </label>
              <Select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="min-w-[180px]">
                <option value="all">All types</option>
                {availableTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
              <Select
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as 'newest' | 'oldest')}
                className="min-w-[160px]"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex min-h-[280px] items-center justify-center text-sm text-muted-foreground">
                Loading notifications...
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="rounded-full bg-muted p-4">
                  <BellRing className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-base font-semibold text-foreground">No notifications match</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Current filters or enabled types are excluding everything from the feed.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="divide-y divide-border/70">
                  {filteredNotifications.map((notification) => {
                    const unread = !notification.readAt;
                    const href = entityHref(notification);

                    return (
                      <div key={notification.id} className={unread ? 'bg-primary/5' : undefined}>
                        <div className="flex gap-3 px-5 py-4">
                          <div className={`mt-2 h-2.5 w-2.5 rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className={`text-sm ${unread ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>
                                  {notification.title}
                                </div>
                                {notification.body ? (
                                  <div className="mt-1 text-sm leading-6 text-muted-foreground">{notification.body}</div>
                                ) : null}
                              </div>
                              <div className="text-xs text-muted-foreground">{timeAgo(notification.createdAt)}</div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <StatusBadge value={unread ? 'pending' : 'approved'} label={notification.type.replace(/_/g, ' ')} className="capitalize" />
                              {href ? (
                                <Link href={href} className="text-sm font-semibold text-primary hover:underline">
                                  Open record
                                </Link>
                              ) : null}
                              {unread ? (
                                <button onClick={() => handleMarkRead(notification.id)} className="text-sm font-semibold text-primary">
                                  Mark read
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between border-t border-border/70 px-5 py-4">
                  <div className="text-xs text-muted-foreground">{total} total notifications</div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
                      Previous
                    </Button>
                    <Button variant="outline" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount}>
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
