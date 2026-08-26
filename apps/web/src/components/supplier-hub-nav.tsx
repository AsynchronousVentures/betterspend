'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';

const SUPPLIER_HUB_VIEWS = [
  { label: 'All suppliers', href: '/vendors', path: '/vendors' },
  { label: 'Onboarding', href: '/vendors?view=onboarding', path: '/vendors', view: 'onboarding' },
  { label: 'Risk flags', href: '/vendors?view=risk', path: '/vendors', view: 'risk' },
  {
    label: 'Performance',
    href: '/vendors?view=performance',
    path: '/vendors',
    view: 'performance',
  },
  { label: 'Diversity', href: '/vendors?view=diversity', path: '/vendors', view: 'diversity' },
  { label: 'Contracts', href: '/contracts', path: '/contracts' },
  {
    label: 'Software licenses',
    href: '/contracts?view=software',
    path: '/contracts',
    view: 'software',
  },
] as const;

export function SupplierHubNav() {
  const pathname = usePathname();
  const [activeView, setActiveView] = useState<string>();

  useEffect(() => {
    setActiveView(new URLSearchParams(window.location.search).get('view') ?? undefined);
  }, [pathname]);

  return (
    <nav
      aria-label="Supplier workspaces"
      className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border/70 pb-3"
    >
      {SUPPLIER_HUB_VIEWS.map((view) => {
        const onSupplierWorkspace =
          view.path === '/vendors' && (pathname === '/vendors' || pathname.startsWith('/vendors/'));
        const active =
          (pathname === view.path || onSupplierWorkspace) &&
          activeView === ('view' in view ? view.view : undefined);
        return (
          <Link
            key={view.href}
            href={view.href}
            className={cn(
              'border-b-2 pb-1 text-sm transition-colors',
              active
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            )}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
