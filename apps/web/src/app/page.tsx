'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
} from 'lucide-react';
import { api } from '../lib/api';
import { PageHeader } from '../components/page-header';
import { StatusBadge } from '../components/status-badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

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

const ACTIVITY_ENTITY_ROUTES: Record<string, string> = {
  requisition: '/requisitions',
  purchase_order: '/purchase-orders',
  invoice: '/invoices',
  goods_receipt: '/receiving',
  receiving: '/receiving',
  approval_request: '/approvals',
  approval: '/approvals',
  vendor: '/vendors',
  contract: '/contracts',
  inventory_item: '/inventory',
  budget: '/budgets',
};

function KpiCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
}) {
  const content = (
    <Card className="h-full">
      <CardContent className="space-y-2 p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className="font-mono text-2xl font-semibold tracking-[-0.02em] text-foreground">{value}</div>
        {sub ? <div className="text-sm text-muted-foreground">{sub}</div> : null}
        {href ? <div className="text-sm font-medium text-primary">View details</div> : null}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {content}
    </Link>
  ) : (
    content
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
    <Link
      href={href}
      className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-background/80 px-4 py-2.5 transition-colors hover:bg-muted/40"
    >
      <span className="text-sm text-foreground">{label}</span>
      <StatusBadge value={urgent ? 'exception' : 'pending'} label={String(count)} className="min-w-9 justify-center" />
    </Link>
  );
}

export default function HomePage() {
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [kpis, setKpis] = useState<any>(null);
  const [pending, setPending] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [expiringContracts, setExpiringContracts] = useState<any[]>([]);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [autoApprovedSummary, setAutoApprovedSummary] = useState<{ count: number; totalAmount: number } | null>(null);
  const [autoApproveThreshold, setAutoApproveThreshold] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

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
      .then(([kpiData, pendingItems, recentActivity, contracts, lowStock, autoApproved, settings]) => {
        setKpis(kpiData);
        setPending(pendingItems);
        setActivity(Array.isArray(recentActivity) ? recentActivity : []);
        setExpiringContracts(Array.isArray(contracts) ? contracts : []);
        setLowStockItems(Array.isArray(lowStock) ? lowStock : []);
        if (autoApproved) setAutoApprovedSummary(autoApproved);

        const settingsMap = settings as Record<string, string>;
        if (settingsMap.auto_approve_threshold) {
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

  async function handleExportCsv() {
    setExportingCsv(true);
    try {
      const exportedAt = new Date().toISOString();
      const datePart = exportedAt.split('T')[0];
      const rows = [
        ['KPI Name', 'Value', 'Exported At'],
        ['Active POs', String(po?.active ?? 0), exportedAt],
        ['Open Requisitions', String(req?.total ?? 0), exportedAt],
        ['Invoices Paid', String(inv?.paid ?? 0), exportedAt],
        ['Annual Budget', String(bud?.totalBudget ?? 0), exportedAt],
      ];
      const csv = rows
        .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `dashboard-${datePart}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportingCsv(false);
    }
  }

  async function handleExportPdf() {
    if (!dashboardRef.current) return;
    setExportingPdf(true);
    try {
      const exportedAt = new Date();
      const datePart = exportedAt.toISOString().split('T')[0];
      const printWindow = window.open('', '_blank', 'noopener,noreferrer');
      if (!printWindow) return;

      printWindow.document.write(`
        <html>
          <head>
            <title>dashboard-${datePart}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
              h1 { font-size: 24px; margin-bottom: 4px; }
              p.meta { color: #475569; font-size: 12px; margin-top: 0; margin-bottom: 16px; }
              a { color: inherit; text-decoration: none; }
            </style>
          </head>
          <body>
            <h1>BetterSpend Dashboard</h1>
            <p class="meta">Generated ${exportedAt.toLocaleString()}</p>
            ${dashboardRef.current.innerHTML}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      window.setTimeout(() => {
        printWindow.print();
      }, 250);
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Dashboard"
        description="A procurement command center for approvals, operational risk, and the current spend pulse."
        actions={
          <>
            <Button variant="outline" onClick={handleExportCsv} disabled={loading || exportingCsv}>
              {exportingCsv ? 'Exporting CSV...' : 'Export CSV'}
            </Button>
            <Button onClick={handleExportPdf} disabled={loading || exportingPdf}>
              {exportingPdf ? 'Preparing PDF...' : 'Export PDF'}
            </Button>
          </>
        }
      />

      <div ref={dashboardRef} className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {loading ? (
            [...Array(4)].map((_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-lg border border-border/70 bg-muted/60" />
            ))
          ) : (
            <>
              <KpiCard
                label="Active POs"
                value={String(po?.active ?? 0)}
                sub={`${po?.total ?? 0} total · ${fmt(po?.totalValue)} committed`}
                href="/purchase-orders"
              />
              <KpiCard
                label="Open Requisitions"
                value={String(req?.total ?? 0)}
                sub="Pending approval or in progress"
                href="/requisitions"
              />
              <KpiCard
                label="Invoices Paid"
                value={fmt(inv?.paid)}
                sub={`${fmt(inv?.pending)} still pending`}
                href="/invoices"
              />
              <KpiCard
                label="Annual Budget"
                value={fmt(bud?.totalBudget)}
                sub="All active budgets combined"
                href="/budgets"
              />
            </>
          )}
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Action Required</CardTitle>
                <CardDescription>Queues that need attention across approvals, invoices, and controls.</CardDescription>
              </div>
              {totalActions > 0 ? (
                <div className="rounded bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">{totalActions}</div>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              {!pending || totalActions === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  {loading ? 'Loading...' : 'All caught up.'}
                </div>
              ) : (
                <>
                  <ActionItem label="Pending Approvals" count={pending.pendingApprovals ?? 0} href="/approvals" />
                  <ActionItem label="Invoice Exceptions" count={pending.invoiceExceptions ?? 0} href="/invoices" urgent />
                  <ActionItem label="Spend Guard Alerts" count={pending.spendGuardAlerts ?? 0} href="/spend-guard" urgent />
                  <ActionItem label="Software Renewals Due" count={pending.upcomingSoftwareRenewals ?? 0} href="/software-licenses" />
                  <ActionItem label="Requisitions Awaiting Approval" count={pending.requisitionsPendingApproval ?? 0} href="/requisitions" />
                  <ActionItem label="POs Awaiting First Receipt" count={pending.posAwaitingReceipt ?? 0} href="/receiving" />
                  <ActionItem label="Overdue Invoices" count={pending.overdueInvoices ?? 0} href="/invoices" urgent />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Recent Activity</CardTitle>
                <CardDescription>Latest system and user actions across the P2P workflow.</CardDescription>
              </div>
              <Link href="/audit" className="text-sm font-semibold text-primary hover:underline">
                View audit log
              </Link>
            </CardHeader>
            <CardContent className="max-h-[420px] overflow-y-auto">
              {loading ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  Loading...
                </div>
              ) : activity.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  No recent activity
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {activity.slice(0, 12).map((item, index) => {
                    const baseRoute = ACTIVITY_ENTITY_ROUTES[String(item.entityType ?? '')];
                    const detailHref = baseRoute && item.entityId ? `${baseRoute}/${item.entityId}` : null;
                    const row = (
                      <div className="flex items-center gap-3 px-1 py-2.5 transition-colors hover:bg-muted/30">
                        <span className="size-1.5 shrink-0 rounded-full bg-primary/60" />
                        <div className="min-w-0 flex-1 text-sm">
                          <span className="font-medium text-foreground">{item.userName ?? 'System'}</span>
                          {' '}{item.action}{' '}
                          <span className="text-muted-foreground capitalize">{String(item.entityType ?? '').replace(/_/g, ' ')}</span>
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatRelativeTime(item.createdAt, relativeNow)}
                        </span>
                      </div>
                    );
                    return detailHref ? (
                      <Link key={item.id ?? index} href={detailHref}>{row}</Link>
                    ) : (
                      <div key={item.id ?? index}>{row}</div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {!loading && expiringContracts.length > 0 ? (
          <Card className="border-amber-200 bg-amber-50/80">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base text-amber-950">
                  <AlertTriangle className="h-4 w-4" />
                  Contracts Expiring Within 30 Days
                </CardTitle>
                <CardDescription className="text-amber-900/80">Renewal risk that should be reviewed before lapse.</CardDescription>
              </div>
              <Link href="/contracts?filter=expiring_soon" className="text-sm font-semibold text-amber-900 hover:underline">
                View all contracts
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {expiringContracts.slice(0, 5).map((contract: any) => {
                const daysLeft = contract.endDate ? Math.ceil((new Date(contract.endDate).getTime() - Date.now()) / 86400000) : null;
                return (
                  <Link
                    key={contract.id}
                    href={`/contracts/${contract.id}`}
                    className="flex items-center justify-between gap-4 rounded-lg border border-amber-200/80 bg-white/70 px-4 py-3 transition-colors hover:bg-white"
                  >
                    <div>
                      <div className="font-medium text-amber-950">
                        {contract.contractNumber} — {contract.title}
                      </div>
                      <div className="mt-1 text-sm text-amber-900/80">{contract.vendor?.name ?? 'Unknown vendor'}</div>
                    </div>
                    <StatusBadge
                      value={(daysLeft ?? 99) <= 7 ? 'exception' : 'pending'}
                      label={daysLeft != null ? (daysLeft <= 0 ? 'Expired' : `${daysLeft}d left`) : 'Check date'}
                    />
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        ) : null}

        {!loading && lowStockItems.length > 0 ? (
          <Card className="border-amber-200 bg-orange-50/70">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base text-orange-950">
                  Low Stock Alert — {lowStockItems.length} item{lowStockItems.length !== 1 ? 's' : ''} below reorder point
                </CardTitle>
                <CardDescription className="text-orange-900/80">Inventory positions that are at risk of delaying fulfillment.</CardDescription>
              </div>
              <Link href="/inventory?lowStockOnly=true" className="text-sm font-semibold text-orange-900 hover:underline">
                Go to inventory
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {lowStockItems.slice(0, 5).map((item: any) => (
                <Link
                  key={item.id}
                  href={`/inventory/${item.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-orange-200/80 bg-white/70 px-4 py-3 transition-colors hover:bg-white"
                >
                  <div>
                    <div className="font-medium text-orange-950">{item.name}</div>
                    <div className="mt-1 text-sm text-orange-900/80">
                      SKU: {item.sku}
                      {item.location ? ` · ${item.location}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <StatusBadge value={item.stockStatus === 'out_of_stock' ? 'exception' : 'pending'} label={item.stockStatus === 'out_of_stock' ? 'Out of Stock' : 'Low Stock'} />
                    <div className="mt-2 text-xs text-orange-900/80">
                      {item.quantityOnHand} {item.unit} on hand
                    </div>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {!loading && autoApproveThreshold > 0 && autoApprovedSummary !== null ? (
          <Card className="border-emerald-200 bg-emerald-50/70">
            <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Auto-approved this month</div>
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="text-3xl font-semibold tracking-[-0.04em] text-emerald-950">{autoApprovedSummary.count}</span>
                  <span className="text-sm text-emerald-900/80">
                    requisition{autoApprovedSummary.count !== 1 ? 's' : ''} ·{' '}
                    {new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: 'USD',
                      maximumFractionDigits: 0,
                    }).format(autoApprovedSummary.totalAmount)}{' '}
                    total
                  </span>
                </div>
                <div className="text-sm text-emerald-900/80">
                  Fast lane threshold: $
                  {autoApproveThreshold.toLocaleString('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
              <StatusBadge value="approved" label="Fast Lane Active" />
            </CardContent>
          </Card>
        ) : null}

        <section className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Quick Actions</div>
          <div className="flex flex-wrap gap-3">
            {[
              { label: 'New Requisition', href: '/requisitions/new' },
              { label: 'New PO', href: '/purchase-orders/new' },
              { label: 'Receive Goods', href: '/receiving/new' },
              { label: 'New Invoice', href: '/invoices/new' },
              { label: 'New Vendor', href: '/vendors/new' },
              { label: 'New Budget', href: '/budgets/new' },
            ].map((action) => (
              <Button key={action.href} asChild variant="outline">
                <Link href={action.href}>{action.label}</Link>
              </Button>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
