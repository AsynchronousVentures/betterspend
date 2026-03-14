'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, FileSpreadsheet, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Select } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

interface PurchaseOrder {
  id: string;
  number: string;
  vendor: { name: string } | null;
  version: number;
  status: string;
  currency: string;
  totalAmount: string | null;
  issuedAt: string | null;
  createdAt: string;
  poType: string;
}

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
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.purchaseOrders
      .list()
      .then((data) => setOrders(Array.isArray(data) ? data : (data as any).data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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
        description="Track issuance, receipt, invoicing, and closeout across every PO."
        actions={
          <>
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="min-w-[180px]">
              <option value="">All Statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={handleExportCsv} disabled={exporting}>
              {exporting ? <Download className="h-4 w-4 animate-pulse" /> : <FileSpreadsheet className="h-4 w-4" />}
              {exporting ? 'Exporting...' : 'Export CSV'}
            </Button>
            <Button asChild>
              <Link href="/purchase-orders/new">
                <Plus className="h-4 w-4" />
                New PO
              </Link>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
              Loading purchase orders...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="rounded-full bg-muted p-4">
                <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">
                  {statusFilter ? `No ${STATUS_LABELS[statusFilter] ?? statusFilter} purchase orders` : 'No purchase orders yet'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {statusFilter ? 'Try a different filter to expand the queue.' : 'Create your first PO to start supplier fulfillment.'}
                </p>
              </div>
            </div>
          ) : (
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
                        <Link href={`/purchase-orders/${purchaseOrder.id}`} className="text-primary hover:underline">
                          {purchaseOrder.number}
                        </Link>
                        {purchaseOrder.poType === 'blanket' ? (
                          <span className="rounded-md bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-800">
                            Blanket
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{purchaseOrder.vendor?.name ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">V{purchaseOrder.version ?? 1}</TableCell>
                    <TableCell>
                      <StatusBadge value={purchaseOrder.status} label={STATUS_LABELS[purchaseOrder.status]} />
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {formatCurrency(purchaseOrder.totalAmount, purchaseOrder.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {purchaseOrder.issuedAt ? new Date(purchaseOrder.issuedAt).toLocaleDateString() : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
