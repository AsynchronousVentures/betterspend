'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, SearchIcon } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';

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
    <div className="space-y-6 p-4 lg:p-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Dashboard
      </Link>
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">Search Results</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {query.length < 2
            ? 'Enter at least two characters to search across BetterSpend.'
            : `Showing ${totalResults} result${totalResults === 1 ? '' : 's'} for "${query}"`}
        </p>
      </div>

      {loading ? (
        <Card><CardContent className="p-8 text-sm text-muted-foreground">Searching...</CardContent></Card>
      ) : query.length < 2 ? (
        <Card><CardContent className="p-8 text-sm text-muted-foreground">Search term too short.</CardContent></Card>
      ) : totalResults === 0 ? (
        <Card>
          <CardContent className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center">
            <div className="rounded-full bg-muted p-4"><SearchIcon className="h-6 w-6 text-muted-foreground" /></div>
            <div>
              <p className="text-base font-semibold text-foreground">No matching results</p>
              <p className="mt-1 text-sm text-muted-foreground">Try a broader term or a different identifier.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {sections.map((section) =>
            section.items.length === 0 ? null : (
              <Card key={section.key} className="overflow-hidden">
                <CardHeader>
                  <CardTitle className="text-base">
                    {section.label} ({section.items.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border/70">
                    {section.items.map((item) => (
                      <Link
                        key={`${section.key}-${item.id}`}
                        href={item._href}
                        className="block px-5 py-4 transition-colors hover:bg-muted/30"
                      >
                        <div className="text-sm font-medium text-foreground">{item._label}</div>
                        {item.status ? (
                          <div className="mt-1 text-xs text-muted-foreground">Status: {item.status}</div>
                        ) : null}
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading search...</div>}>
      <SearchContent />
    </Suspense>
  );
}
