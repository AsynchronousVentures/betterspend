'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, LogOut } from 'lucide-react';
import { signOut } from '../lib/auth-client';
import { api } from '../lib/api';
import { useBranding } from '../lib/branding';
import { appReleaseVersion } from '../lib/release';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

type NavChild = { label: string; href: string };
type NavGroup = { label: string; children: NavChild[]; defaultOpen?: boolean };
type NavTopLevel = { label: string; href: string };
type NavEntry = NavTopLevel | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'children' in entry;
}

function compactLabel(label: string) {
  return label
    .split(/[\s/&-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

const NAV_CONFIG: NavEntry[] = [
  { label: 'Dashboard', href: '/' },
  {
    label: 'Procurement',
    defaultOpen: true,
    children: [
      { label: 'Requisitions', href: '/requisitions' },
      { label: 'Purchase Orders', href: '/purchase-orders' },
      { label: 'RFQ / Sourcing', href: '/rfq' },
      { label: 'Recurring POs', href: '/recurring-po' },
      { label: 'Catalog', href: '/catalog' },
    ],
  },
  {
    label: 'Operations',
    defaultOpen: true,
    children: [
      { label: 'Receiving', href: '/receiving' },
      { label: 'Inventory', href: '/inventory' },
      { label: 'Invoices', href: '/invoices' },
      { label: 'Intake Queue', href: '/intake' },
      { label: 'OCR Jobs', href: '/ocr' },
    ],
  },
  {
    label: 'Approvals',
    children: [
      { label: 'Pending Approvals', href: '/approvals' },
      { label: 'Approval Rules', href: '/approval-rules' },
      { label: 'Delegations', href: '/approval-delegations' },
    ],
  },
  {
    label: 'Finance',
    children: [
      { label: 'Budgets', href: '/budgets' },
      { label: 'Spend Guard', href: '/spend-guard' },
      { label: 'Tax Codes', href: '/tax-codes' },
      { label: 'AP Aging', href: '/ap-aging' },
      { label: 'GL Integration', href: '/gl-mappings' },
      { label: 'GL Export Jobs', href: '/gl-export-jobs' },
    ],
  },
  {
    label: 'Analytics & Reports',
    children: [
      { label: 'Analytics', href: '/analytics' },
      { label: 'Reports', href: '/reports' },
    ],
  },
  {
    label: 'Organization',
    children: [
      { label: 'Vendors', href: '/vendors' },
      { label: 'Supplier Scorecard', href: '/supplier-scorecard' },
      { label: 'Supplier Diversity & ESG', href: '/supplier-diversity' },
      { label: 'Vendor Onboarding', href: '/vendors/onboarding' },
      { label: 'Contracts', href: '/contracts' },
      { label: 'Software Licenses', href: '/software-licenses' },
      { label: 'Users', href: '/users' },
      { label: 'Departments', href: '/departments' },
      { label: 'Projects', href: '/projects' },
      { label: 'Entities', href: '/entities' },
    ],
  },
  {
    label: 'System',
    children: [
      { label: 'Webhooks', href: '/webhooks' },
      { label: 'Audit Log', href: '/audit' },
      { label: 'Settings', href: '/settings' },
    ],
  },
];

export default function SidebarNav({
  onClose,
  collapsed = false,
}: {
  onClose?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [invoiceExceptionCount, setInvoiceExceptionCount] = useState(0);
  const [spendGuardCount, setSpendGuardCount] = useState(0);
  const [softwareRenewalCount, setSoftwareRenewalCount] = useState(0);
  const branding = useBranding();

  const getInitialOpen = useCallback(() => {
    const initial = new Set<string>();
    for (const entry of NAV_CONFIG) {
      if (!isGroup(entry)) continue;
      if (entry.defaultOpen) initial.add(entry.label);
      for (const child of entry.children) {
        if (child.href === '/' ? pathname === '/' : pathname.startsWith(child.href)) {
          initial.add(entry.label);
        }
      }
    }
    return initial;
  }, [pathname]);

  const [openGroups, setOpenGroups] = useState<Set<string>>(getInitialOpen);

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      for (const entry of NAV_CONFIG) {
        if (!isGroup(entry)) continue;
        for (const child of entry.children) {
          if (child.href === '/' ? pathname === '/' : pathname.startsWith(child.href)) {
            next.add(entry.label);
          }
        }
      }
      return next;
    });
  }, [pathname]);

  useEffect(() => {
    api.analytics
      .pendingItems()
      .then((data: any) => {
        setPendingApprovalsCount(data?.pendingApprovals ?? 0);
        setInvoiceExceptionCount(data?.invoiceExceptions ?? 0);
        setSpendGuardCount(data?.spendGuardAlerts ?? 0);
        setSoftwareRenewalCount(data?.upcomingSoftwareRenewals ?? 0);
      })
      .catch(() => {});
  }, [pathname]);

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  function handleLinkClick() {
    onClose?.();
  }

  function getBadge(href: string): number | undefined {
    if (href === '/approvals' && pendingApprovalsCount > 0) return pendingApprovalsCount;
    if (href === '/invoices' && invoiceExceptionCount > 0) return invoiceExceptionCount;
    if (href === '/spend-guard' && spendGuardCount > 0) return spendGuardCount;
    if (href === '/software-licenses' && softwareRenewalCount > 0) return softwareRenewalCount;
    return undefined;
  }

  function renderLink(item: NavChild, indented: boolean) {
    const active = isActive(item.href);
    const badge = getBadge(item.href);
    const initials = compactLabel(item.label);

    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? item.label : undefined}
        onClick={handleLinkClick}
        className={cn(
          'group flex items-center justify-between gap-3 rounded-xl transition-colors',
          collapsed ? 'px-2 py-2' : indented ? 'px-3 py-2 pl-6' : 'px-3 py-2.5',
          active ? 'bg-white/10 text-sidebar-foreground' : 'text-sidebar-muted hover:bg-white/6 hover:text-sidebar-foreground',
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold tracking-wide',
              active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'bg-white/7 text-sidebar-foreground',
            )}
          >
            {initials}
          </span>
          {!collapsed ? <span className="truncate text-sm">{item.label}</span> : null}
        </span>
        {badge != null && badge > 0 ? (
          <Badge variant="destructive" className="h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px]">
            {badge > 99 ? '99+' : badge}
          </Badge>
        ) : null}
      </Link>
    );
  }

  function renderGroup(group: NavGroup) {
    const open = openGroups.has(group.label);
    const hasActiveChild = group.children.some((child) => isActive(child.href));
    const groupBadge = group.children.reduce((sum, child) => sum + (getBadge(child.href) ?? 0), 0);
    const initials = compactLabel(group.label);

    return (
      <div key={group.label} className="space-y-1">
        <button
          type="button"
          onClick={() => toggleGroup(group.label)}
          title={collapsed ? group.label : undefined}
          className={cn(
            'flex w-full items-center justify-between rounded-xl transition-colors',
            collapsed ? 'px-2 py-2' : 'px-3 py-2',
            hasActiveChild ? 'text-sidebar-foreground' : 'text-sidebar-muted hover:text-sidebar-foreground',
          )}
        >
          <span className="flex items-center gap-3">
            {collapsed ? (
              <span
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold tracking-wide',
                  hasActiveChild ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'bg-white/7 text-sidebar-foreground',
                )}
              >
                {initials}
              </span>
            ) : (
              <span className="text-[11px] font-semibold uppercase tracking-[0.24em]">{group.label}</span>
            )}
            {!open && groupBadge > 0 ? (
              <Badge variant="destructive" className="h-5 min-w-5 rounded-full px-1.5 text-[10px]">
                {groupBadge > 99 ? '99+' : groupBadge}
              </Badge>
            ) : null}
          </span>
          {!collapsed ? <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} /> : null}
        </button>
        {open ? <div className="space-y-1">{group.children.map((child) => renderLink(child, true))}</div> : null}
      </div>
    );
  }

  return (
    <>
      <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {NAV_CONFIG.map((entry) => (isGroup(entry) ? renderGroup(entry) : renderLink(entry, false)))}
      </nav>

      <div className="border-t border-sidebar-border px-3 py-3">
        <button
          type="button"
          title={collapsed ? 'Sign out' : undefined}
          onClick={handleSignOut}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-sidebar-muted transition-colors hover:bg-white/6 hover:text-sidebar-foreground',
            collapsed && 'justify-center px-2',
          )}
        >
          <LogOut className="size-4" />
          {!collapsed ? <span>Sign out</span> : null}
        </button>
      </div>

      <div className={cn('border-t border-sidebar-border px-4 py-4 text-sidebar-muted', collapsed ? 'text-center' : 'text-left')}>
        {!collapsed ? <div className="text-[11px] leading-5 text-sidebar-muted/90">{branding.copyright_text}</div> : null}
        <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-sidebar-muted/70">
          {collapsed ? `v${appReleaseVersion}` : `Version ${appReleaseVersion}`}
        </div>
        {!collapsed && branding.hide_powered_by !== 'true' ? (
          <div className="mt-1 text-[11px] text-sidebar-muted/55">Powered by BetterSpend</div>
        ) : null}
      </div>
    </>
  );
}
