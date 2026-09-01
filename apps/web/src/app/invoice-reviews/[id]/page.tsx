'use client';

import { use, useEffect, useState } from 'react';
import type { InvoiceReviewCommandInput } from '@betterspend/shared';
import type { InvoiceReviewProjection } from '../../../lib/api-contracts';
import { api, loadFailureState } from '../../../lib/api';
import Breadcrumbs from '../../../components/breadcrumbs';
import { MessageThread } from '../../../components/message-thread';
import { PageHeader } from '../../../components/page-header';
import { ListState } from '../../../components/resource-state';
import { InvoiceReviewDetail, namedOptions, type NamedOption } from '../review-views';

export default function InvoiceReviewPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const [projection, setProjection] = useState<InvoiceReviewProjection | null>(null);
  const [assignees, setAssignees] = useState<NamedOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.invoiceReviews.get(id), api.users.list().catch(() => [])])
      .then(([nextProjection, users]) => {
        if (cancelled) return;
        setLoadError(null);
        setProjection(nextProjection);
        setAssignees(namedOptions(users));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error);
        setProjection(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, retry]);

  async function command(input: InvoiceReviewCommandInput) {
    await api.invoiceReviews.command(id, input);
    const refreshed = await api.invoiceReviews.get(id);
    setProjection(refreshed);
  }

  if (loading || loadError || !projection) {
    return (
      <div className="p-4 md:p-6">
        <ListState
          state={loading ? 'loading' : loadError ? loadFailureState(loadError) : 'empty'}
          loadingLabel="Loading invoice review..."
          emptyTitle="Invoice review not found"
          emptyDescription="The review case may no longer be accessible."
          onRetry={() => {
            setLoading(true);
            setLoadError(null);
            setRetry((value) => value + 1);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <Breadcrumbs
        items={[
          { label: 'AP exceptions', href: '/invoice-reviews' },
          { label: projection.invoice.internalNumber },
        ]}
      />
      <PageHeader
        title={projection.invoice.invoiceNumber}
        description={`${projection.invoice.vendor?.name ?? 'Restricted vendor'} · ${projection.invoice.internalNumber}`}
      />
      <InvoiceReviewDetail
        projection={projection}
        assignees={assignees}
        onCommand={command}
        messageThread={
          <MessageThread
            key={projection.case.version}
            threadType="invoice"
            threadId={id}
            recipientVendorId={projection.invoice.vendor?.id}
          />
        }
      />
    </div>
  );
}
