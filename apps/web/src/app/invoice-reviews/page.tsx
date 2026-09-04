'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FileWarning } from 'lucide-react';
import { invoiceReviewListQuerySchema } from '@betterspend/shared';
import type { InvoiceReviewListQuery, InvoiceReviewListResult } from '../../lib/api-contracts';
import { api, loadFailureState } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { ListState } from '../../components/resource-state';
import { InvoiceReviewQueue, namedOptions, type NamedOption } from './review-views';

function queryFromSearchParams(searchParams: URLSearchParams): InvoiceReviewListQuery {
  const raw = Object.fromEntries(
    [...searchParams.entries()].filter(([, value]) => value.trim() !== ''),
  );
  const parsed = invoiceReviewListQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

function QueueContent() {
  const searchParams = useSearchParams();
  const query = useMemo(() => queryFromSearchParams(searchParams), [searchParams]);
  const [result, setResult] = useState<InvoiceReviewListResult | null>(null);
  const [owners, setOwners] = useState<NamedOption[]>([]);
  const [vendors, setVendors] = useState<NamedOption[]>([]);
  const [entities, setEntities] = useState<NamedOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [settledQuery, setSettledQuery] = useState<InvoiceReviewListQuery | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.invoiceReviews.list(query),
      api.users.list().catch(() => []),
      api.vendors.list().catch(() => []),
      api.entities.list().catch(() => []),
    ])
      .then(([queue, ownerRows, vendorRows, entityRows]) => {
        if (cancelled) return;
        setLoadError(null);
        setSettledQuery(query);
        setResult(queue);
        setOwners(namedOptions(ownerRows));
        setVendors(namedOptions(vendorRows));
        setEntities(namedOptions(entityRows));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error);
        setSettledQuery(query);
        setResult(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, retry]);

  const queryLoading = loading || settledQuery !== query;
  if (queryLoading || loadError || !result) {
    return (
      <ListState
        state={queryLoading ? 'loading' : loadError ? loadFailureState(loadError) : 'empty'}
        loadingLabel="Loading AP exception queue..."
        emptyTitle="No review cases"
        emptyDescription="Invoice review cases will appear here when a signal needs attention."
        icon={FileWarning}
        onRetry={() => {
          setLoading(true);
          setLoadError(null);
          setRetry((value) => value + 1);
        }}
      />
    );
  }

  return (
    <InvoiceReviewQueue
      result={result}
      query={query}
      owners={owners}
      vendors={vendors}
      entities={entities}
    />
  );
}

export default function InvoiceReviewsPage() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="AP exceptions"
        description="Review invoice blockers, source evidence, and ownership in one queue."
      />
      <Suspense
        fallback={
          <ListState
            state="loading"
            loadingLabel="Loading AP exception queue..."
            emptyTitle="No review cases"
            emptyDescription=""
          />
        }
      >
        <QueueContent />
      </Suspense>
    </div>
  );
}
