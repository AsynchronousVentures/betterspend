'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import Breadcrumbs from '../../../components/breadcrumbs';
import { DocumentUploader } from '../../../components/document-uploader';
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
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

interface MatchResult {
  id: string;
  priceMatch: boolean;
  quantityMatch: boolean;
  variancePct: string;
  status: string;
}

interface InvoiceLine {
  id: string;
  lineNumber: string;
  description: string;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
  glAccount: string | null;
  poLine: { lineNumber: string; description: string; unitPrice: string; quantity: string } | null;
  matchResults: MatchResult[];
}

interface Invoice {
  id: string;
  internalNumber: string;
  invoiceNumber: string;
  status: string;
  matchStatus: string;
  invoiceDate: string;
  dueDate: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
  vendor: { name: string } | null;
  purchaseOrder: { id: string; number: string } | null;
  lines: InvoiceLine[];
  approvedAt: string | null;
}

function statusVariant(status: string) {
  if (status === 'matched' || status === 'paid') return 'success';
  if (status === 'pending_match') return 'warning';
  if (status === 'partial_match') return 'outline';
  if (status === 'exception') return 'destructive';
  if (status === 'approved') return 'secondary';
  return 'outline';
}

function formatCurrency(amount: string | number | null, currency = 'USD') {
  if (!amount) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState('');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [exceptionReason, setExceptionReason] = useState('');
  const [glSystem, setGlSystem] = useState<'qbo' | 'xero'>('qbo');

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.invoices
        .get(pid)
        .then((data) => setInvoice(data))
        .catch(() => setInvoice(null))
        .finally(() => setLoading(false));
    });
  }, [params]);

  async function refresh() {
    const updated = await api.invoices.get(id);
    setInvoice(updated);
  }

  async function doApprove() {
    setError('');
    setActionLoading('approve');
    try {
      await api.invoices.approve(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function doMarkPaid() {
    setError('');
    setActionLoading('paid');
    try {
      await api.invoices.markPaid(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mark paid failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function doGlExport() {
    setError('');
    setActionLoading('gl');
    try {
      await api.glExportJobs.trigger(id, glSystem);
      setSuccessMsg(
        `GL export job queued for ${
          glSystem === 'qbo' ? 'QuickBooks Online' : 'Xero'
        }. Check GL Integration -> Export Jobs for status.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GL export failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function doRerunMatch() {
    setError('');
    setActionLoading('match');
    try {
      await api.invoices.rerunMatch(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Match failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function doResolveException() {
    setError('');
    setSuccessMsg('');
    setActionLoading('resolve');
    try {
      await api.invoices.resolveException(id, { reason: exceptionReason || undefined });
      await refresh();
      setExceptionReason('');
      setSuccessMsg('Invoice exception marked as reviewed. It can now proceed through approval.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resolve failed');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
          Loading invoice...
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-4 lg:p-8">
        <Alert variant="destructive">
          <AlertDescription>
            Invoice not found.{' '}
            <Link href="/invoices" className="underline underline-offset-4">
              Back to list
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const hasExceptions = invoice.matchStatus === 'exception';

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs items={[{ label: 'Invoices', href: '/invoices' }, { label: invoice.internalNumber }]} />

      <PageHeader
        title={invoice.internalNumber}
        description={`Vendor invoice ${invoice.invoiceNumber} from ${invoice.vendor?.name ?? 'Unknown vendor'}.`}
        actions={
          <div className="flex flex-wrap gap-3">
            <Badge variant={statusVariant(invoice.status) as any} className="capitalize">
              {invoice.status.replace(/_/g, ' ')}
            </Badge>
            <Badge variant={statusVariant(invoice.matchStatus) as any} className="capitalize">
              Match: {invoice.matchStatus.replace(/_/g, ' ')}
            </Badge>
            <Button asChild variant="outline">
              <Link href="/invoices">Back to Invoices</Link>
            </Button>
          </div>
        }
      />

      {hasExceptions ? (
        <Alert variant="destructive">
          <AlertDescription>
            3-way match exceptions detected. One or more lines have price or quantity variances outside tolerance.
          </AlertDescription>
        </Alert>
      ) : null}

      {successMsg ? (
        <Alert variant="success">
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {hasExceptions ? (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">Finance Exception Resolution</CardTitle>
            <CardDescription>
              Accept the variance after review to move this invoice back into the payable workflow.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 lg:flex-row">
            <Input
              value={exceptionReason}
              onChange={(event) => setExceptionReason(event.target.value)}
              placeholder="Reason for accepting this exception"
              className="flex-1"
            />
            <Button type="button" onClick={doResolveException} disabled={actionLoading !== null}>
              {actionLoading === 'resolve' ? 'Resolving...' : 'Accept Exception'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Subtotal" value={formatCurrency(invoice.subtotal, invoice.currency)} />
        <StatCard label="Tax" value={formatCurrency(invoice.taxAmount, invoice.currency)} />
        <StatCard label="Total" value={formatCurrency(invoice.totalAmount, invoice.currency)} />
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl">Invoice Details</CardTitle>
          <CardDescription>Commercial details, linked PO, and lifecycle timestamps.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="Vendor" value={invoice.vendor?.name ?? '—'} />
          <DetailField label="Linked PO" value={invoice.purchaseOrder?.number ?? '—'} />
          <DetailField label="Invoice Date" value={new Date(invoice.invoiceDate).toLocaleDateString()} />
          <DetailField label="Due Date" value={invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—'} />
          <DetailField label="Currency" value={invoice.currency} />
          <DetailField label="Approved At" value={invoice.approvedAt ? new Date(invoice.approvedAt).toLocaleString() : '—'} />
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl">Line Items & 3-Way Match</CardTitle>
          <CardDescription>Review line-level quantities, PO linkage, and match variances.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Variance</TableHead>
                <TableHead>Match Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lines.map((line) => {
                const match = line.matchResults?.[0];
                return (
                  <TableRow
                    key={line.id}
                    className={
                      match?.status === 'exception'
                        ? 'bg-rose-50/60'
                        : match?.status === 'match'
                          ? 'bg-emerald-50/50'
                          : undefined
                    }
                  >
                    <TableCell className="text-muted-foreground">{line.lineNumber}</TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{line.description}</div>
                      {line.poLine ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          PO: {line.poLine.description} @ {formatCurrency(line.poLine.unitPrice, invoice.currency)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{line.quantity}</TableCell>
                    <TableCell>{formatCurrency(line.unitPrice, invoice.currency)}</TableCell>
                    <TableCell className="font-medium text-foreground">
                      {formatCurrency(line.totalPrice, invoice.currency)}
                    </TableCell>
                    <TableCell className="text-center">
                      {match ? (
                        <span className={match.priceMatch ? 'font-bold text-emerald-700' : 'font-bold text-rose-700'}>
                          {match.priceMatch ? 'OK' : 'X'}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {match ? (
                        <span className={match.quantityMatch ? 'font-bold text-emerald-700' : 'font-bold text-rose-700'}>
                          {match.quantityMatch ? 'OK' : 'X'}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {match ? `${parseFloat(match.variancePct).toFixed(1)}%` : '—'}
                    </TableCell>
                    <TableCell>
                      {match ? (
                        <Badge variant={statusVariant(match.status) as any} className="capitalize">
                          {match.status.replace(/_/g, ' ')}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        {!['approved', 'paid'].includes(invoice.status) ? (
          <>
            <Button type="button" onClick={doApprove} disabled={hasExceptions || actionLoading !== null}>
              {actionLoading === 'approve' ? 'Approving...' : 'Approve for Payment'}
            </Button>
            <Button type="button" variant="outline" onClick={doRerunMatch} disabled={actionLoading !== null}>
              {actionLoading === 'match' ? 'Running...' : 'Re-run Match'}
            </Button>
          </>
        ) : null}

        {invoice.status === 'approved' ? (
          <>
            <Button type="button" onClick={doMarkPaid} disabled={actionLoading !== null}>
              {actionLoading === 'paid' ? 'Marking...' : 'Mark as Paid'}
            </Button>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-background/80 px-4 py-3">
              <span className="text-sm font-medium text-muted-foreground">Export to GL</span>
              <Select
                value={glSystem}
                onChange={(event) => setGlSystem(event.target.value as 'qbo' | 'xero')}
                className="w-48"
              >
                <option value="qbo">QuickBooks Online</option>
                <option value="xero">Xero</option>
              </Select>
              <Button type="button" variant="outline" onClick={doGlExport} disabled={actionLoading !== null}>
                {actionLoading === 'gl' ? 'Exporting...' : 'Export'}
              </Button>
            </div>
          </>
        ) : null}
      </div>

      {id ? (
        <div className="pt-2">
          <DocumentUploader entityType="invoice" entityId={id} label="Documents" />
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-lg border-border/70 bg-card/95">
      <CardContent className="p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}
