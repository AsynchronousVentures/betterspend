'use client';

import Link from 'next/link';
import { COLORS } from '../lib/theme';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export default function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" style={{ marginBottom: '0.875rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center', fontSize: '0.8125rem', color: COLORS.textMuted }}>
        <Link href="/" style={{ color: COLORS.textSecondary, textDecoration: 'none' }}>
          Dashboard
        </Link>
        {items.map((item, index) => (
          <span key={`${item.label}-${index}`} style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
            <span style={{ color: COLORS.textMuted }}>/</span>
            {item.href && index < items.length - 1 ? (
              <Link href={item.href} style={{ color: COLORS.textSecondary, textDecoration: 'none' }}>
                {item.label}
              </Link>
            ) : (
              <span style={{ color: COLORS.textPrimary, fontWeight: 500 }}>{item.label}</span>
            )}
          </span>
        ))}
      </div>
    </nav>
  );
}
