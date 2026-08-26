'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, BellRing } from 'lucide-react';
import { isRecordKind, notificationTypeLabel, recordHref } from '@betterspend/shared';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Select } from '../../components/ui/select';

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
  return isRecordKind(notification.entityType)
    ? recordHref({ kind: notification.entityType, id: notification.entityId })
    : null;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    api.notifications.types().then(setAvailableTypes).catch(() => setAvailableTypes([]));
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
        description="Full notification history with filtering and read-state controls."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/settings#notifications">Manage notification preferences</Link>
            </Button>
            <Button variant="outline" onClick={handleMarkAllRead}>
              Mark all read
            </Button>
          </div>
        }
      />

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
                    {notificationTypeLabel(type)}
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
            ) : notifications.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="rounded-full bg-muted p-4">
                  <BellRing className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-base font-semibold text-foreground">No notifications match</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try changing the current filters or check back after new activity arrives.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="divide-y divide-border/70">
                  {notifications.map((notification) => {
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
                              <StatusBadge value={unread ? 'pending' : 'approved'} label={notificationTypeLabel(notification.type)} />
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
  );
}
