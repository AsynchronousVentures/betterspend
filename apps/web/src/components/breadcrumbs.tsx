'use client';

import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export default function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link href="/" className="inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-muted hover:text-foreground">
          <Home className="size-3.5" />
          Dashboard
        </Link>
        {items.map((item, index) => (
          <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1">
            <ChevronRight className="size-3.5 text-muted-foreground/70" />
            {item.href && index < items.length - 1 ? (
              <Link href={item.href} className="rounded-md px-2 py-1 transition-colors hover:bg-muted hover:text-foreground">
                {item.label}
              </Link>
            ) : (
              <span className="rounded-md px-2 py-1 font-medium text-foreground">{item.label}</span>
            )}
          </span>
        ))}
      </div>
    </nav>
  );
}
