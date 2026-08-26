'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PackageCheck, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { type ReceivingListItem } from '../../lib/receiving';
import { PageHeader } from '../../components/page-header';
import { RelatedRecordLink } from '../../components/related-records';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

function formatCurrency(amount: string | number | null | undefined, currency = 'USD') {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

export default function ReceivingPage() {
  const [grns, setGrns] = useState<ReceivingListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.receiving
      .list()
      .then((data) => setGrns(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Goods Receipts"
        description="Record receipts against issued purchase orders and keep receiving data tied to downstream matching."
        actions={
          <Button asChild>
            <Link href="/receiving/new">
              <Plus className="h-4 w-4" />
              New GRN
            </Link>
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
              Loading goods receipts...
            </div>
          ) : grns.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="rounded-full bg-muted p-4">
                <PackageCheck className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">No goods receipts yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create a GRN when goods arrive against an issued purchase order.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="divide-y divide-border/70 md:hidden">
                {grns.map((grn) => {
                  const purchaseOrder = {
                    kind: 'purchase_order' as const,
                    id: grn.purchaseOrder?.id,
                    label: grn.purchaseOrder?.number,
                    totalAmount: grn.purchaseOrder?.totalAmount,
                    currency: grn.purchaseOrder?.currency,
                    relation: 'Purchase order',
                  };
                  const vendor = {
                    kind: 'vendor' as const,
                    id: grn.purchaseOrder?.vendor?.id,
                    label: grn.purchaseOrder?.vendor?.name,
                    relation: 'Supplier',
                  };

                  return (
                    <article key={grn.id} className="space-y-4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/receiving/${grn.id}`}
                            className="font-semibold text-primary hover:underline"
                          >
                            {grn.number}
                          </Link>
                          <div className="mt-1 text-xs text-muted-foreground">Goods receipt</div>
                        </div>
                        <StatusBadge value={grn.status} />
                      </div>
                      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div className="min-w-0">
                          <dt className="text-xs text-muted-foreground">Purchase order</dt>
                          <dd className="mt-1 truncate text-foreground">
                            <RelatedRecordLink record={purchaseOrder} />
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs text-muted-foreground">Supplier</dt>
                          <dd className="mt-1 truncate text-foreground">
                            <RelatedRecordLink record={vendor} />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Received</dt>
                          <dd className="mt-1 text-foreground">
                            {new Date(grn.receivedDate).toLocaleDateString()}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">PO amount</dt>
                          <dd className="mt-1 font-medium text-foreground">
                            {formatCurrency(purchaseOrder.totalAmount, purchaseOrder.currency)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Lines</dt>
                          <dd className="mt-1 text-foreground">{grn.lines?.length ?? 0}</dd>
                        </div>
                      </dl>
                      <Link
                        href={`/receiving/${grn.id}`}
                        className="inline-flex text-sm font-semibold text-primary hover:underline"
                      >
                        View receipt
                      </Link>
                    </article>
                  );
                })}
              </div>

              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>GRN Number</TableHead>
                      <TableHead>PO Number</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Received Date</TableHead>
                      <TableHead>PO Amount</TableHead>
                      <TableHead>Lines</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grns.map((grn) => {
                      const purchaseOrder = {
                        kind: 'purchase_order' as const,
                        id: grn.purchaseOrder?.id,
                        label: grn.purchaseOrder?.number,
                        totalAmount: grn.purchaseOrder?.totalAmount,
                        currency: grn.purchaseOrder?.currency,
                        relation: 'Purchase order',
                      };
                      const vendor = {
                        kind: 'vendor' as const,
                        id: grn.purchaseOrder?.vendor?.id,
                        label: grn.purchaseOrder?.vendor?.name,
                        relation: 'Supplier',
                      };

                      return (
                        <TableRow key={grn.id}>
                          <TableCell className="font-semibold">
                            <Link
                              href={`/receiving/${grn.id}`}
                              className="text-primary hover:underline"
                            >
                              {grn.number}
                            </Link>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <RelatedRecordLink record={purchaseOrder} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <RelatedRecordLink record={vendor} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(grn.receivedDate).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="font-medium text-foreground">
                            {formatCurrency(purchaseOrder.totalAmount, purchaseOrder.currency)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {grn.lines?.length ?? 0} line{grn.lines?.length !== 1 ? 's' : ''}
                          </TableCell>
                          <TableCell>
                            <StatusBadge value={grn.status} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
