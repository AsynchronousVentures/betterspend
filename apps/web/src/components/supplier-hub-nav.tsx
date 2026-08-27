'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { supplierHubRoutes } from '../lib/product-routes';
import { cn } from '../lib/utils';
import { useAccess } from './access-provider';

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return href !== '/' && pathname.startsWith(`${href}/`) && !pathname.endsWith('/new');
}

export function SupplierHubNav() {
  const pathname = usePathname();
  const { access } = useAccess();
  const views = useMemo(() => supplierHubRoutes(access?.permissions ?? []), [access?.permissions]);

  if (views.length === 0) return null;

  return (
    <nav
      aria-label="Supplier workspaces"
      className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border/70 pb-3"
    >
      {views.map((view) => {
        return (
          <Link
            key={view.key}
            href={view.href}
            className={cn(
              'border-b-2 pb-1 text-sm transition-colors',
              isActive(pathname, view.href)
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            )}
          >
            {view.supplierHubLabel ?? view.label}
          </Link>
        );
      })}
    </nav>
  );
}
