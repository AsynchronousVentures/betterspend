'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, FileSpreadsheet, Plus } from 'lucide-react';
import { api, loadFailureState } from '../../lib/api';
import type { PurchaseOrderListItem } from '../../lib/api-contracts';
import { PageHeader } from '../../components/page-header';
import { RelatedRecordLink } from '../../components/related-records';
import { useAccess } from '../../components/access-provider';
import { ListState } from '../../components/resource-state';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Select } from '../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  approved: 'Approved',
  issued: 'Issued',
  received: 'Received',
  invoiced: 'Invoiced',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

function formatCurrency(amount: string | number | null, currency = 'USD') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

async function downloadCsv(type: string) {
  const { api: exportApi } = await import('../../lib/api');
  const res = await exportApi.export.download(type);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `export-${type}-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [exporting, setExporting] = useState(false);
  const { access } = useAccess();
  const canCreateStandalone = access?.permissions.includes('purchase_orders:create') ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.purchaseOrders.list();
      setOrders(data);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = statusFilter ? orders.filter((order) => order.status === statusFilter) : orders;

  async function handleExportCsv() {
    setExporting(true);
    try {
      await downloadCsv('purchase-orders');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Purchase Orders"
        description="Track issuance, receipt, invoicing, and closeout across every PO. Use a source request or RFQ whenever one exists."
        actions={
          <>
            <Button asChild>
              <Link href="/start">
                <Plus className="h-4 w-4" />
                Start Request
              </Link>
            </Button>
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="min-w-[180px]"
            >
              <option value="">All Statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={handleExportCsv} disabled={exporting}>
              {exporting ? (
                <Download className="h-4 w-4 animate-pulse" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              {exporting ? 'Exporting...' : 'Export CSV'}
            </Button>
            {canCreateStandalone ? (
              <Button asChild variant="outline">
                <Link href="/purchase-orders/new">Standalone PO</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading || loadError || filtered.length === 0 ? (
            <ListState
              state={loading ? 'loading' : loadError ? loadFailureState(loadError) : 'empty'}
              loadingLabel="Loading purchase orders..."
              emptyTitle={
                statusFilter
                  ? `No ${STATUS_LABELS[statusFilter] ?? statusFilter} purchase orders`
                  : 'No purchase orders yet'
              }
              emptyDescription={
                statusFilter
                  ? 'Try a different filter to expand the queue.'
                  : 'Start a request. Approved requisitions and awarded RFQs create traceable purchase orders.'
              }
              icon={FileSpreadsheet}
              onRetry={() => void load()}
            />
          ) : (
            <>
              <div className="divide-y divide-border/70 md:hidden">
                {filtered.map((purchaseOrder) => (
                  <article key={purchaseOrder.id} className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/purchase-orders/${purchaseOrder.id}`}
                          className="font-semibold text-primary hover:underline"
                        >
                          {purchaseOrder.number}
                        </Link>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Version {purchaseOrder.version ?? 1}
                          {purchaseOrder.poType === 'blanket' ? ' · Blanket' : ''}
                        </div>
                      </div>
                      <StatusBadge
                        value={purchaseOrder.status}
                        label={STATUS_LABELS[purchaseOrder.status]}
                      />
                    </div>
                    <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div className="min-w-0">
                        <dt className="text-xs text-muted-foreground">Supplier</dt>
                        <dd className="mt-1 truncate text-foreground">
                          <RelatedRecordLink
                            record={{
                              kind: 'vendor',
                              id: purchaseOrder.vendor?.id,
                              label: purchaseOrder.vendor?.name,
                              relation: 'Supplier',
                            }}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Total</dt>
                        <dd className="mt-1 font-medium text-foreground">
                          {formatCurrency(purchaseOrder.totalAmount, purchaseOrder.currency)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Issued</dt>
                        <dd className="mt-1 text-foreground">
                          {purchaseOrder.issuedAt
                            ? new Date(purchaseOrder.issuedAt).toLocaleDateString()
                            : '—'}
                        </dd>
                      </div>
                    </dl>
                    <Link
                      href={`/purchase-orders/${purchaseOrder.id}`}
                      className="inline-flex text-sm font-semibold text-primary hover:underline"
                    >
                      View purchase order
                    </Link>
                  </article>
                ))}
              </div>

              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Number</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Issued Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((purchaseOrder) => (
                      <TableRow key={purchaseOrder.id}>
                        <TableCell className="font-semibold">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/purchase-orders/${purchaseOrder.id}`}
                              className="text-primary hover:underline"
                            >
                              {purchaseOrder.number}
                            </Link>
                            {purchaseOrder.poType === 'blanket' ? (
                              <span className="rounded-md bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-800">
                                Blanket
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <RelatedRecordLink
                            record={{
                              kind: 'vendor',
                              id: purchaseOrder.vendor?.id,
                              label: purchaseOrder.vendor?.name,
                              relation: 'Supplier',
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          V{purchaseOrder.version ?? 1}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            value={purchaseOrder.status}
                            label={STATUS_LABELS[purchaseOrder.status]}
                          />
                        </TableCell>
                        <TableCell className="font-medium text-foreground">
                          {formatCurrency(purchaseOrder.totalAmount, purchaseOrder.currency)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {purchaseOrder.issuedAt
                            ? new Date(purchaseOrder.issuedAt).toLocaleDateString()
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
