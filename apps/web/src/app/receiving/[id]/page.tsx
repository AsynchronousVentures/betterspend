'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, PackageCheck, XCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import Breadcrumbs from '../../../components/breadcrumbs';
import { PageHeader } from '../../../components/page-header';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

interface GRNLine {
  id: string;
  poLineId: string;
  quantityReceived: string;
  quantityRejected: string;
  rejectionReason: string | null;
  storageLocation: string | null;
  poLine: { lineNumber: string; description: string; quantity: string } | null;
}

interface GRN {
  id: string;
  number: string;
  status: string;
  receivedDate: string;
  notes: string | null;
  purchaseOrder: { id: string; number: string; vendor: { name: string } | null } | null;
  lines: GRNLine[];
  createdAt: string;
}

function statusVariant(status: string) {
  if (status === 'confirmed') return 'success';
  if (status === 'cancelled') return 'destructive';
  return 'secondary';
}

export default function GRNDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState('');
  const [grn, setGrn] = useState<GRN | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.receiving
        .get(pid)
        .then((data) => setGrn(data))
        .catch(() => setGrn(null))
        .finally(() => setLoading(false));
    });
  }, [params]);

  async function confirmGRN() {
    setError('');
    setConfirming(true);
    try {
      await api.receiving.confirm(id);
      const updated = await api.receiving.get(id);
      setGrn(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirm failed');
    } finally {
      setConfirming(false);
    }
  }

  async function cancelGRN() {
    if (!window.confirm('Cancel this GRN?')) return;
    setError('');
    setConfirming(true);
    try {
      await api.receiving.cancel(id);
      const updated = await api.receiving.get(id);
      setGrn(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
          Loading receipt...
        </div>
      </div>
    );
  }

  if (!grn) {
    return (
      <div className="p-4 lg:p-8">
        <Alert variant="destructive">
          <AlertDescription>
            GRN not found. <Link href="/receiving" className="underline underline-offset-4">Back to list</Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const totalReceived = grn.lines.reduce((sum, line) => sum + parseFloat(line.quantityReceived), 0);
  const totalRejected = grn.lines.reduce((sum, line) => sum + parseFloat(line.quantityRejected), 0);

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs items={[{ label: 'Receiving', href: '/receiving' }, { label: grn.number }]} />

      <PageHeader
        title={grn.number}
        description={`Goods receipt for PO ${grn.purchaseOrder?.number ?? '—'} from ${grn.purchaseOrder?.vendor?.name ?? 'Unknown vendor'}.`}
        actions={
          <div className="flex flex-wrap gap-3">
            <Badge variant={statusVariant(grn.status) as any} className="capitalize">
              {grn.status.replace(/_/g, ' ')}
            </Badge>
            <Button asChild variant="outline">
              <Link href="/receiving">Back to Receiving</Link>
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={PackageCheck} label="Total Received" value={String(totalReceived)} tone="text-emerald-700" />
        <StatCard icon={XCircle} label="Total Rejected" value={String(totalRejected)} tone="text-rose-700" />
        <StatCard icon={ClipboardCheck} label="Received Date" value={new Date(grn.receivedDate).toLocaleDateString()} tone="text-sky-700" />
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl">Receipt Information</CardTitle>
          <CardDescription>Core receipt context, supplier reference, and receiving notes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="GRN Number" value={grn.number} />
          <DetailField label="Purchase Order" value={grn.purchaseOrder?.number ?? '—'} />
          <DetailField label="Vendor" value={grn.purchaseOrder?.vendor?.name ?? '—'} />
          <DetailField label="Created" value={new Date(grn.createdAt).toLocaleString()} />
          <DetailField label="Status" value={grn.status.replace(/_/g, ' ')} />
          <DetailField label="Received Date" value={new Date(grn.receivedDate).toLocaleDateString()} />
          {grn.notes ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <DetailField label="Notes" value={grn.notes} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl">Received Lines</CardTitle>
          <CardDescription>Receipt quantities and rejection details by purchase order line.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>PO Qty</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Rejected</TableHead>
                <TableHead>Rejection Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grn.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="text-muted-foreground">{line.poLine?.lineNumber ?? '—'}</TableCell>
                  <TableCell className="font-medium text-foreground">{line.poLine?.description ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{line.poLine?.quantity ?? '—'}</TableCell>
                  <TableCell className="font-medium text-emerald-700">{line.quantityReceived}</TableCell>
                  <TableCell className={parseFloat(line.quantityRejected) > 0 ? 'font-medium text-rose-700' : 'text-muted-foreground'}>
                    {line.quantityRejected}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{line.rejectionReason ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {grn.status === 'draft' || grn.status === 'confirmed' ? (
        <div className="flex flex-wrap gap-3">
          {grn.status === 'draft' ? (
            <Button type="button" onClick={confirmGRN} disabled={confirming}>
              {confirming ? 'Confirming...' : 'Confirm Receipt'}
            </Button>
          ) : null}
          <Button type="button" variant="destructive" onClick={cancelGRN} disabled={confirming}>
            Cancel GRN
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/70 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <Card className="rounded-lg border-border/70 bg-card/95">
      <CardContent className="flex items-center gap-4 p-6">
        <div className={`rounded-lg border border-current/10 bg-current/10 p-3 ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
