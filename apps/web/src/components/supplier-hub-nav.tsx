'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../lib/utils';

const SUPPLIER_HUB_VIEWS = [
  {
    label: 'All suppliers',
    href: '/vendors',
    isActive: (pathname: string) =>
      pathname === '/vendors' || (pathname.startsWith('/vendors/') && pathname !== '/vendors/new'),
  },
  {
    label: 'Onboarding',
    href: '/vendors/onboarding',
    isActive: (pathname: string) => pathname === '/vendors/onboarding',
  },
  {
    label: 'Risk flags',
    href: '/risk-screening',
    isActive: (pathname: string) => pathname === '/risk-screening',
  },
  {
    label: 'Performance',
    href: '/supplier-scorecard',
    isActive: (pathname: string) => pathname === '/supplier-scorecard',
  },
  {
    label: 'Diversity',
    href: '/supplier-diversity',
    isActive: (pathname: string) => pathname === '/supplier-diversity',
  },
  {
    label: 'Contracts',
    href: '/contracts',
    isActive: (pathname: string) => pathname === '/contracts',
  },
  {
    label: 'Software licenses',
    href: '/software-licenses',
    isActive: (pathname: string) => pathname === '/software-licenses',
  },
] as const;

export function SupplierHubNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Supplier workspaces"
      className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border/70 pb-3"
    >
      {SUPPLIER_HUB_VIEWS.map((view) => {
        return (
          <Link
            key={view.href}
            href={view.href}
            className={cn(
              'border-b-2 pb-1 text-sm transition-colors',
              view.isActive(pathname)
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
