'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  ShoppingCart,
  Megaphone,
  RefreshCw,
  BookOpen,
  PackageCheck,
  Boxes,
  Receipt,
  Inbox,
  ScanLine,
  CheckSquare,
  SlidersHorizontal,
  ArrowLeftRight,
  PiggyBank,
  ShieldAlert,
  Percent,
  Clock,
  Link2,
  CreditCard,
  BarChart2,
  FileBarChart2,
  Building2,
  KeyRound,
  ScrollText,
  Users,
  FolderTree,
  Briefcase,
  Building,
  Zap,
  History,
  Settings,
  ChevronRight,
  Puzzle,
  Sparkles,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { signOut } from '../lib/auth-client';
import { api } from '../lib/api';
import { useBranding } from '../lib/branding';
import {
  PRODUCT_NAV_SECTIONS,
  productNavigationSections,
  type ProductNavSectionKey,
  type ProductNavigationSection,
  type ProductRoute,
  type ProductRouteIcon,
} from '../lib/product-routes';
import { useReleaseVersion } from './release-version-provider';
import { useAccess } from './access-provider';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import { SidebarAccount } from './sidebar-account';

function isGroup(
  section: ProductNavigationSection,
): section is ProductNavigationSection & { label: string } {
  return section.label !== null;
}

function isNavPathActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`) && !pathname.endsWith('/new');
}

function groupId(value: string) {
  return `sidebar-group-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

const NAV_ICONS: Record<ProductRouteIcon, LucideIcon> = {
  Dashboard: LayoutDashboard,
  StartRequest: Sparkles,
  Requisitions: ClipboardList,
  PurchaseOrders: ShoppingCart,
  Rfq: Megaphone,
  RecurringPos: RefreshCw,
  Catalog: BookOpen,
  Receiving: PackageCheck,
  Inventory: Boxes,
  Invoices: Receipt,
  InvoiceReviews: ShieldAlert,
  Intake: Inbox,
  Ocr: ScanLine,
  Approvals: CheckSquare,
  ApprovalRules: SlidersHorizontal,
  Delegations: ArrowLeftRight,
  Budgets: PiggyBank,
  SpendGuard: ShieldAlert,
  TaxCodes: Percent,
  Currencies: ArrowLeftRight,
  ApAging: Clock,
  PaymentRuns: CreditCard,
  GlIntegration: Link2,
  Analytics: BarChart2,
  Reports: FileBarChart2,
  Suppliers: Building2,
  Contracts: ScrollText,
  SoftwareLicenses: KeyRound,
  Users,
  Departments: FolderTree,
  Projects: Briefcase,
  Entities: Building,
  Addons: Puzzle,
  Webhooks: Zap,
  AuditLog: History,
  Compliance: ShieldCheck,
  WorkspaceSettings: Settings,
};

const GROUP_ICONS: Partial<Record<ProductNavSectionKey, LucideIcon>> = {
  procurement: ShoppingCart,
  operations: PackageCheck,
  approvals: CheckSquare,
  finance: PiggyBank,
  analytics: BarChart2,
  'supplier-operations': Building2,
  organization: Building,
  system: Settings,
};

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
  const { version: appReleaseVersion } = useReleaseVersion();
  const { access } = useAccess();
  const navigationSections = useMemo(
    () => productNavigationSections(access?.permissions ?? []),
    [access?.permissions],
  );

  const [openGroups, setOpenGroups] = useState<Set<ProductNavSectionKey>>(
    () =>
      new Set(
        PRODUCT_NAV_SECTIONS.filter((section) => section.label !== null && section.defaultOpen).map(
          (section) => section.key,
        ),
      ),
  );

  useEffect(() => {
    setOpenGroups((current) => {
      const availableGroups = new Set(
        navigationSections.filter(isGroup).map((section) => section.key),
      );
      const next = new Set([...current].filter((key) => availableGroups.has(key)));
      for (const section of navigationSections) {
        if (
          isGroup(section) &&
          section.routes.some((route) => isNavPathActive(pathname, route.href))
        ) {
          next.add(section.key);
        }
      }
      return next;
    });
  }, [navigationSections, pathname]);

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

  function toggleGroup(sectionKey: ProductNavSectionKey) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  function isActive(href: string) {
    return isNavPathActive(pathname, href);
  }

  function handleLinkClick() {
    onClose?.();
  }

  function getBadge(href: string): number | undefined {
    if (href === '/approvals' && pendingApprovalsCount > 0) return pendingApprovalsCount;
    if (href === '/invoice-reviews' && invoiceExceptionCount > 0) return invoiceExceptionCount;
    if (href === '/spend-guard' && spendGuardCount > 0) return spendGuardCount;
    if (href === '/software-licenses' && softwareRenewalCount > 0) return softwareRenewalCount;
    return undefined;
  }

  function renderLink(item: ProductRoute, indented: boolean) {
    const active = isActive(item.href);
    const badge = getBadge(item.href);
    const Icon = NAV_ICONS[item.icon];

    return (
      <Link
        key={item.key}
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
                active
                  ? 'text-sidebar-accent'
                  : 'text-sidebar-muted/70 group-hover:text-sidebar-foreground',
              )}
            />
          ) : null}
          {!collapsed ? <span className="truncate text-sm">{item.label}</span> : null}
        </span>
        {badge != null && badge > 0 ? (
          <Badge
            variant="destructive"
            className="h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px]"
          >
            {badge > 99 ? '99+' : badge}
          </Badge>
        ) : null}
      </Link>
    );
  }

  function renderGroup(group: ProductNavigationSection & { label: string }) {
    const open = openGroups.has(group.key);
    const childrenId = groupId(group.key);
    const hasActiveChild = group.routes.some((route) => isActive(route.href));
    const groupBadge = group.routes.reduce((sum, route) => sum + (getBadge(route.href) ?? 0), 0);
    const GroupIcon = GROUP_ICONS[group.key];

    return (
      <div key={group.key} className="space-y-0.5">
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          aria-expanded={open}
          aria-controls={childrenId}
          title={collapsed ? group.label : undefined}
          className={cn(
            'flex w-full items-center justify-between rounded-md px-3 py-1.5 transition-colors',
            collapsed && 'justify-center px-2',
            hasActiveChild
              ? 'text-sidebar-foreground'
              : 'text-sidebar-muted hover:text-sidebar-foreground',
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
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">
                  {group.label}
                </span>
                {!open && groupBadge > 0 ? (
                  <Badge
                    variant="destructive"
                    className="h-5 min-w-5 rounded-full px-1.5 text-[10px]"
                  >
                    {groupBadge > 99 ? '99+' : groupBadge}
                  </Badge>
                ) : null}
              </>
            )}
          </span>
          {!collapsed ? (
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          ) : null}
        </button>
        {open ? (
          <div id={childrenId} className="space-y-0.5">
            {group.routes.map((route) => renderLink(route, true))}
          </div>
        ) : (
          <div id={childrenId} hidden />
        )}
      </div>
    );
  }

  return (
    <>
      <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {navigationSections.map((section) =>
          isGroup(section)
            ? renderGroup(section)
            : section.routes.map((route) => renderLink(route, false)),
        )}
      </nav>

      <SidebarAccount collapsed={collapsed} onSignOut={handleSignOut} />

      <div
        className={cn(
          'border-t border-sidebar-border px-4 py-4 text-sidebar-muted',
          collapsed ? 'text-center' : 'text-left',
        )}
      >
        {!collapsed ? (
          <div className="text-[11px] leading-5 text-sidebar-muted/90">
            {branding.copyright_text}
          </div>
        ) : null}
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
