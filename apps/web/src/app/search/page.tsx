'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

const TYPE_LABELS: Record<string, string> = {
  requisition: 'Requisitions',
  purchase_order: 'Purchase Orders',
  invoice: 'Invoices',
  vendor: 'Vendors',
  catalog_item: 'Catalog Items',
};

function SearchContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.trim() ?? '';
  const [results, setResults] = useState<Record<string, any[]>>({
    requisitions: [],
    purchaseOrders: [],
    invoices: [],
    vendors: [],
    catalogItems: [],
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults({
        requisitions: [],
        purchaseOrders: [],
        invoices: [],
        vendors: [],
        catalogItems: [],
      });
      return;
    }

    setLoading(true);
    api.search
      .query(query)
      .then((data: any) => setResults(data))
      .catch(() =>
        setResults({
          requisitions: [],
          purchaseOrders: [],
          invoices: [],
          vendors: [],
          catalogItems: [],
        }),
      )
      .finally(() => setLoading(false));
  }, [query]);

  const sections = useMemo(
    () => [
      { key: 'requisitions', label: TYPE_LABELS.requisition, items: results.requisitions ?? [] },
      { key: 'purchaseOrders', label: TYPE_LABELS.purchase_order, items: results.purchaseOrders ?? [] },
      { key: 'invoices', label: TYPE_LABELS.invoice, items: results.invoices ?? [] },
      { key: 'vendors', label: TYPE_LABELS.vendor, items: results.vendors ?? [] },
      { key: 'catalogItems', label: TYPE_LABELS.catalog_item, items: results.catalogItems ?? [] },
    ],
    [results],
  );

  const totalResults = sections.reduce((sum, section) => sum + section.items.length, 0);

  return (
    <div style={{ padding: '2rem', maxWidth: '960px' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/" style={{ color: COLORS.textSecondary, textDecoration: 'none', fontSize: '0.875rem' }}>
          &larr; Back to Dashboard
        </Link>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.textPrimary, margin: '0.75rem 0 0.25rem' }}>
          Search Results
        </h1>
        <p style={{ color: COLORS.textSecondary, fontSize: '0.875rem', margin: 0 }}>
          {query.length < 2 ? 'Enter at least two characters to search across BetterSpend.' : `Showing ${totalResults} result${totalResults === 1 ? '' : 's'} for "${query}"`}
        </p>
      </div>

      {loading ? (
        <div style={{ padding: '2rem', color: COLORS.textMuted }}>Searching...</div>
      ) : query.length < 2 ? (
        <div style={{ padding: '2rem', color: COLORS.textMuted }}>Search term too short.</div>
      ) : totalResults === 0 ? (
        <div style={{ padding: '2rem', color: COLORS.textMuted }}>No matching results.</div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {sections.map((section) =>
            section.items.length === 0 ? null : (
              <div
                key={section.key}
                style={{
                  background: COLORS.cardBg,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '10px',
                  boxShadow: SHADOWS.card,
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: '0.875rem 1rem', borderBottom: `1px solid ${COLORS.border}`, fontWeight: 600, fontSize: '0.875rem', color: COLORS.textPrimary }}>
                  {section.label} ({section.items.length})
                </div>
                <div>
                  {section.items.map((item) => (
                    <Link
                      key={`${section.key}-${item.id}`}
                      href={item._href}
                      style={{
                        display: 'block',
                        padding: '0.875rem 1rem',
                        borderBottom: `1px solid ${COLORS.contentBg}`,
                        textDecoration: 'none',
                        color: COLORS.textPrimary,
                      }}
                    >
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{item._label}</div>
                      {item.status ? (
                        <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginTop: '0.2rem' }}>
                          Status: {item.status}
                        </div>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', color: COLORS.textMuted }}>Loading search...</div>}>
      <SearchContent />
    </Suspense>
  );
}
