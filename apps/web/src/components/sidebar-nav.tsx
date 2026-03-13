'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { signOut } from '../lib/auth-client';
import { api } from '../lib/api';
import { COLORS } from '../lib/theme';
import { useBranding } from '../lib/branding';
import { appReleaseVersion } from '../lib/release';

/* ── Types ── */

type NavChild = { label: string; href: string };

type NavGroup = {
  label: string;
  children: NavChild[];
  defaultOpen?: boolean;
};

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

/* ── Navigation config ── */

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

/* ── Chevron SVG ── */

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{
        transition: 'transform 0.2s ease',
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        flexShrink: 0,
      }}
    >
      <path
        d="M4.5 2.5L8 6L4.5 9.5"
        stroke={COLORS.sidebarGroupLabel}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Component ── */

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

  // Determine which groups should be open initially
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

  // Auto-open group for active route on navigation
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

  // Fetch pending count
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

  /* ── Render helpers ── */

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
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: collapsed
            ? '0.5rem 0.625rem'
            : indented
              ? '0.5rem 1rem 0.5rem 2.5rem'
              : '0.5rem 1rem 0.5rem 1.25rem',
          color: active ? COLORS.sidebarTextActive : COLORS.sidebarText,
          textDecoration: 'none',
          fontSize: '0.8125rem',
          fontWeight: active ? 500 : 400,
          background: active ? COLORS.sidebarHover : 'transparent',
          borderLeft: active ? `2px solid ${COLORS.sidebarAccent}` : '2px solid transparent',
          transition: 'background 0.15s, color 0.15s',
          lineHeight: '1.4',
          gap: '0.625rem',
        }}
        onMouseEnter={(e) => {
          if (!active) {
            (e.currentTarget as HTMLAnchorElement).style.background = COLORS.sidebarHover;
            (e.currentTarget as HTMLAnchorElement).style.color = COLORS.sidebarTextActive;
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
            (e.currentTarget as HTMLAnchorElement).style.color = COLORS.sidebarText;
          }
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', minWidth: 0 }}>
          <span
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: active ? COLORS.sidebarAccent : COLORS.sidebarHover,
              color: COLORS.sidebarTextActive,
              fontSize: '0.6875rem',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {initials}
          </span>
          {!collapsed ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span> : null}
        </span>
        {badge != null && badge > 0 && (
          <span
            style={{
              background: COLORS.badgeRed,
              color: '#fff',
              borderRadius: '9999px',
              fontSize: '0.625rem',
              fontWeight: 600,
              minWidth: '18px',
              height: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 5px',
              flexShrink: 0,
            }}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </Link>
    );
  }

  function renderGroup(group: NavGroup) {
    const open = openGroups.has(group.label);
    const hasActiveChild = group.children.some((c) => isActive(c.href));
    const groupBadge = group.children.reduce((sum, c) => sum + (getBadge(c.href) ?? 0), 0);
    const initials = compactLabel(group.label);

    return (
      <div key={group.label} style={{ marginBottom: '0.125rem' }}>
        <button
          onClick={() => toggleGroup(group.label)}
          title={collapsed ? group.label : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: collapsed ? '0.625rem 0.625rem' : '0.625rem 1rem 0.625rem 1.25rem',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: hasActiveChild ? COLORS.sidebarTextActive : COLORS.sidebarGroupLabel,
            fontSize: '0.6875rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
            textAlign: 'left' as const,
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = COLORS.sidebarTextActive;
          }}
          onMouseLeave={(e) => {
            if (!hasActiveChild) {
              (e.currentTarget as HTMLButtonElement).style.color = COLORS.sidebarGroupLabel;
            }
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {collapsed ? (
              <span
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '8px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: hasActiveChild ? COLORS.sidebarAccent : COLORS.sidebarHover,
                  color: COLORS.sidebarTextActive,
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {initials}
              </span>
            ) : (
              group.label
            )}
            {!open && groupBadge > 0 && (
              <span
                style={{
                  background: COLORS.badgeRed,
                  color: '#fff',
                  borderRadius: '9999px',
                  fontSize: '0.5625rem',
                  fontWeight: 600,
                  minWidth: '16px',
                  height: '16px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                }}
              >
                {groupBadge > 99 ? '99+' : groupBadge}
              </span>
            )}
          </span>
          {!collapsed ? <Chevron open={open} /> : null}
        </button>
        {open && <div>{group.children.map((child) => renderLink(child, true))}</div>}
      </div>
    );
  }

  /* ── Main render ── */

  return (
    <>
      <nav style={{ flex: 1, paddingTop: '0.5rem', overflowY: 'auto' }}>
        {NAV_CONFIG.map((entry) =>
          isGroup(entry) ? renderGroup(entry) : renderLink(entry, false),
        )}
      </nav>

      {/* Sign out */}
      <div style={{ padding: '0.5rem 1rem', borderTop: `1px solid ${COLORS.sidebarBorder}` }}>
        <button
          title={collapsed ? 'Sign out' : undefined}
          onClick={handleSignOut}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            color: COLORS.sidebarText,
            fontSize: '0.8125rem',
            textAlign: collapsed ? 'center' : 'left',
            padding: '0.5rem 0.25rem',
            cursor: 'pointer',
            borderRadius: '4px',
            transition: 'color 0.15s, background 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = COLORS.sidebarTextActive;
            (e.currentTarget as HTMLButtonElement).style.background = COLORS.sidebarHover;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = COLORS.sidebarText;
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          {collapsed ? 'SO' : 'Sign out'}
        </button>
      </div>

      {/* Copyright / branding footer */}
      <div
        style={{
          padding: collapsed ? '0.625rem 0.5rem' : '0.625rem 1.25rem',
          borderTop: `1px solid ${COLORS.sidebarBorder}`,
          fontSize: '0.6875rem',
          color: COLORS.sidebarGroupLabel,
          lineHeight: 1.5,
          textAlign: collapsed ? 'center' : 'left',
        }}
      >
        {!collapsed ? <div style={{ opacity: 0.8 }}>{branding.copyright_text}</div> : null}
        <div style={{ opacity: 0.65, marginTop: '0.125rem' }}>{collapsed ? `v${appReleaseVersion}` : `Version ${appReleaseVersion}`}</div>
        {!collapsed && branding.hide_powered_by !== 'true' && (
          <div style={{ opacity: 0.5, marginTop: '0.125rem' }}>Powered by BetterSpend</div>
        )}
      </div>
    </>
  );
}
