'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, ClipboardList, ShoppingCart, Megaphone,
  RefreshCw, BookOpen, PackageCheck, Boxes, Receipt, Inbox,
  ScanLine, CheckSquare, SlidersHorizontal, ArrowLeftRight,
  PiggyBank, ShieldAlert, Percent, Clock, Link2, Upload,
  BarChart2, FileBarChart2, Building2, Star, Leaf, UserPlus,
  ScrollText, KeyRound, Users, FolderTree, Briefcase, Building,
  Zap, History, Settings, LogOut, ChevronRight,
  type LucideIcon,
} from 'lucide-react';
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

const NAV_ICONS: Record<string, LucideIcon> = {
  'Dashboard':                LayoutDashboard,
  'Requisitions':             ClipboardList,
  'Purchase Orders':          ShoppingCart,
  'RFQ / Sourcing':           Megaphone,
  'Recurring POs':            RefreshCw,
  'Catalog':                  BookOpen,
  'Receiving':                PackageCheck,
  'Inventory':                Boxes,
  'Invoices':                 Receipt,
  'Intake Queue':             Inbox,
  'OCR Jobs':                 ScanLine,
  'Pending Approvals':        CheckSquare,
  'Approval Rules':           SlidersHorizontal,
  'Delegations':              ArrowLeftRight,
  'Budgets':                  PiggyBank,
  'Spend Guard':              ShieldAlert,
  'Tax Codes':                Percent,
  'AP Aging':                 Clock,
  'GL Integration':           Link2,
  'GL Export Jobs':           Upload,
  'Analytics':                BarChart2,
  'Reports':                  FileBarChart2,
  'Vendors':                  Building2,
  'Supplier Scorecard':       Star,
  'Supplier Diversity & ESG': Leaf,
  'Vendor Onboarding':        UserPlus,
  'Contracts':                ScrollText,
  'Software Licenses':        KeyRound,
  'Users':                    Users,
  'Departments':              FolderTree,
  'Projects':                 Briefcase,
  'Entities':                 Building,
  'Webhooks':                 Zap,
  'Audit Log':                History,
  'Settings':                 Settings,
};

const GROUP_ICONS: Record<string, LucideIcon> = {
  'Procurement':         ShoppingCart,
  'Operations':          PackageCheck,
  'Approvals':           CheckSquare,
  'Finance':             PiggyBank,
  'Analytics & Reports': BarChart2,
  'Organization':        Building2,
  'System':              Settings,
};

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
    const activeGroups = new Set<string>();
    for (const entry of NAV_CONFIG) {
      if (!isGroup(entry)) continue;
      for (const child of entry.children) {
        if (child.href === '/' ? pathname === '/' : pathname.startsWith(child.href)) {
          activeGroups.add(entry.label);
        }
      }
    }
    setOpenGroups(activeGroups);
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
    const Icon = NAV_ICONS[item.label];

    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? item.label : undefined}
        onClick={handleLinkClick}
        className={cn(
          'group flex items-center justify-between gap-3 rounded-md transition-colors',
          collapsed ? 'px-2 py-2 justify-center' : indented ? 'pl-5 pr-3 py-1.5' : 'px-3 py-2',
          active
            ? 'bg-white/[0.08] text-sidebar-foreground font-medium'
            : 'text-sidebar-muted hover:bg-white/[0.05] hover:text-sidebar-foreground',
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {Icon ? (
            <Icon
              size={15}
              className={cn(
                'shrink-0 transition-colors',
                active ? 'text-sidebar-accent' : 'text-sidebar-muted/70 group-hover:text-sidebar-foreground',
              )}
            />
          ) : null}
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
    const GroupIcon = GROUP_ICONS[group.label];

    return (
      <div key={group.label} className="space-y-0.5">
        <button
          type="button"
          onClick={() => toggleGroup(group.label)}
          title={collapsed ? group.label : undefined}
          className={cn(
            'flex w-full items-center justify-between rounded-md px-3 py-1.5 transition-colors',
            collapsed && 'justify-center px-2',
            hasActiveChild ? 'text-sidebar-foreground' : 'text-sidebar-muted hover:text-sidebar-foreground',
          )}
        >
          <span className="flex items-center gap-2.5">
            {collapsed ? (
              GroupIcon ? (
                <GroupIcon
                  size={15}
                  className={cn(hasActiveChild ? 'text-sidebar-accent' : 'text-sidebar-muted/70')}
                />
              ) : null
            ) : (
              <>
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">{group.label}</span>
                {!open && groupBadge > 0 ? (
                  <Badge variant="destructive" className="h-5 min-w-5 rounded-full px-1.5 text-[10px]">
                    {groupBadge > 99 ? '99+' : groupBadge}
                  </Badge>
                ) : null}
              </>
            )}
          </span>
          {!collapsed ? <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} /> : null}
        </button>
        {open ? <div className="space-y-0.5">{group.children.map((child) => renderLink(child, true))}</div> : null}
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
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-muted transition-colors hover:bg-white/[0.05] hover:text-sidebar-foreground',
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
