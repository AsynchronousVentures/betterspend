'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PackageCheck, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { relatedRecordLink, type ReceivingListItem, type RelatedRecordLink } from '../../lib/receiving';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

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
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>GRN Number</TableHead>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Received Date</TableHead>
                  <TableHead>Lines</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grns.map((grn) => {
                  const purchaseOrderLink = relatedRecordLink(
                    grn.purchaseOrder
                      ? { id: grn.purchaseOrder.id, label: grn.purchaseOrder.number }
                      : null,
                    'purchase-orders',
                  );
                  const vendorLink = relatedRecordLink(
                    grn.purchaseOrder?.vendor
                      ? { id: grn.purchaseOrder.vendor.id, label: grn.purchaseOrder.vendor.name }
                      : null,
                    'vendors',
                  );

                  return (
                  <TableRow key={grn.id}>
                    <TableCell className="font-semibold">
                      <Link href={`/receiving/${grn.id}`} className="text-primary hover:underline">
                        {grn.number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <RelatedLink link={purchaseOrderLink} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <RelatedLink link={vendorLink} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(grn.receivedDate).toLocaleDateString()}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RelatedLink({ link }: { link: RelatedRecordLink }) {
  if (!link.href) return <span>{link.label}</span>;
  return (
    <Link href={link.href} className="text-primary hover:underline">
      {link.label}
    </Link>
  );
}
