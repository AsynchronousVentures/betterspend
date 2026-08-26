'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { api, loadFailureState } from '../../../lib/api';
import { localDateInputValue } from '../../../lib/date-input';
import Breadcrumbs from '../../../components/breadcrumbs';
import { DocumentUploader } from '../../../components/document-uploader';
import { MessageThread } from '../../../components/message-thread';
import { PageHeader } from '../../../components/page-header';
import { PanelError } from '../../../components/resource-state';
import { StatusBadge } from '../../../components/status-badge';
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

interface GlExportJob {
  id: string;
  targetSystem: string;
  status: string;
  completedAt: string | null;
  errorMessage: string | null;
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
  const [glJobs, setGlJobs] = useState<GlExportJob[]>([]);
  const [glJobsLoading, setGlJobsLoading] = useState(false);
  const [glJobsError, setGlJobsError] = useState<unknown>(null);
  const [showExternalPayment, setShowExternalPayment] = useState(false);
  const [paymentDate, setPaymentDate] = useState(localDateInputValue);
  const [paymentMethod, setPaymentMethod] = useState('ach');
  const [paymentReference, setPaymentReference] = useState('');
  const activeInvoiceId = useRef('');
  const exportJobsRequestId = useRef(0);

  const refreshExportJobs = useCallback(async (invoiceId: string) => {
    const currentRequestId = ++exportJobsRequestId.current;
    const isCurrentRequest = () =>
      activeInvoiceId.current === invoiceId && exportJobsRequestId.current === currentRequestId;

    if (!isCurrentRequest()) return;
    setGlJobsLoading(true);
    setGlJobsError(null);
    try {
      const jobs = await api.glExportJobs.forInvoice(invoiceId);
      if (isCurrentRequest()) setGlJobs(Array.isArray(jobs) ? (jobs as GlExportJob[]) : []);
    } catch (error) {
      if (isCurrentRequest()) setGlJobsError(error);
    } finally {
      if (isCurrentRequest()) setGlJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void params.then(({ id: pid }) => {
      if (cancelled) return;
      activeInvoiceId.current = pid;
      exportJobsRequestId.current += 1;
      setId(pid);
      setInvoice(null);
      setGlJobs([]);
      setGlJobsError(null);
      setLoading(true);
      api.invoices
        .get(pid)
        .then((data) => {
          if (cancelled || activeInvoiceId.current !== pid) return;
          setInvoice(data);
          void refreshExportJobs(pid);
        })
        .catch(() => {
          if (!cancelled && activeInvoiceId.current === pid) setInvoice(null);
        })
        .finally(() => {
          if (!cancelled && activeInvoiceId.current === pid) setLoading(false);
        });
    });
    return () => {
      cancelled = true;
      exportJobsRequestId.current += 1;
    };
  }, [params, refreshExportJobs]);

  async function refresh() {
    const updated = await api.invoices.get(id);
    setInvoice(updated);
    void refreshExportJobs(id);
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

  async function doRecordExternalPayment() {
    setError('');
    setActionLoading('paid');
    try {
      await api.invoices.markPaid(id, {
        paymentDate,
        paymentMethod,
        paymentReference,
      });
      await refresh();
      setShowExternalPayment(false);
      setSuccessMsg('External payment recorded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record external payment');
    } finally {
      setActionLoading(null);
    }
  }

  async function doManualGlExport() {
    setError('');
    setActionLoading('gl');
    try {
      await api.glExportJobs.trigger(id, glSystem);
      void refreshExportJobs(id);
      setSuccessMsg(
        `Manual GL export job queued for ${
          glSystem === 'qbo' ? 'QuickBooks Online' : 'Xero'
        }. Check GL Integration -> Export History for status.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GL export failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function retryGlExport(jobId: string) {
    setError('');
    setActionLoading(`retry:${jobId}`);
    try {
      await api.glExportJobs.retry(jobId);
      await refreshExportJobs(id);
      setSuccessMsg('Accounting export retry queued.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not retry the accounting export');
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
  const workflowApprovalPending = invoice.status === 'pending_approval';
  const latestGlJob = glJobs[0] ?? null;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs
        items={[{ label: 'Invoices', href: '/invoices' }, { label: invoice.internalNumber }]}
      />

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
            {invoice.status === 'approved' ? (
              <Button asChild>
                <Link href={`/payment-runs?invoiceId=${invoice.id}`}>Open Payment Runs</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      {hasExceptions ? (
        <Alert variant="destructive">
          <AlertDescription>
            3-way match exceptions detected. One or more lines have price or quantity variances
            outside tolerance.
          </AlertDescription>
        </Alert>
      ) : null}

      {workflowApprovalPending ? (
        <Alert>
          <AlertDescription>
            This invoice is waiting for an approval decision.{' '}
            <Link href="/approvals" className="font-semibold underline underline-offset-4">
              Open the Approvals queue
            </Link>{' '}
            to review it.
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
          <CardDescription>
            Commercial details, linked PO, and lifecycle timestamps.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="Vendor" value={invoice.vendor?.name ?? '—'} />
          <DetailField label="Linked PO" value={invoice.purchaseOrder?.number ?? '—'} />
          <DetailField
            label="Invoice Date"
            value={new Date(invoice.invoiceDate).toLocaleDateString()}
          />
          <DetailField
            label="Due Date"
            value={invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—'}
          />
          <DetailField label="Currency" value={invoice.currency} />
          <DetailField
            label="Approved At"
            value={invoice.approvedAt ? new Date(invoice.approvedAt).toLocaleString() : '—'}
          />
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl">Line Items & 3-Way Match</CardTitle>
          <CardDescription>
            Review line-level quantities, PO linkage, and match variances.
          </CardDescription>
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
                          PO: {line.poLine.description} @{' '}
                          {formatCurrency(line.poLine.unitPrice, invoice.currency)}
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
                        <span
                          className={
                            match.priceMatch
                              ? 'font-bold text-emerald-700'
                              : 'font-bold text-rose-700'
                          }
                        >
                          {match.priceMatch ? 'OK' : 'X'}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {match ? (
                        <span
                          className={
                            match.quantityMatch
                              ? 'font-bold text-emerald-700'
                              : 'font-bold text-rose-700'
                          }
                        >
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
        {!['approved', 'paid', 'pending_approval'].includes(invoice.status) ? (
          <>
            <Button
              type="button"
              onClick={doApprove}
              disabled={hasExceptions || actionLoading !== null}
            >
              {actionLoading === 'approve' ? 'Approving...' : 'Approve for Payment'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={doRerunMatch}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'match' ? 'Running...' : 'Re-run Match'}
            </Button>
          </>
        ) : null}
      </div>

      {invoice.status === 'approved' ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">Accounting export</CardTitle>
              <CardDescription>
                Approved invoices create an accounting job automatically. Check its status here
                before taking an exception path.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {glJobsLoading ? (
                <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
                  Loading accounting status...
                </div>
              ) : glJobsError ? (
                <PanelError
                  state={loadFailureState(glJobsError)}
                  onRetry={() => void refreshExportJobs(id)}
                />
              ) : latestGlJob ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border border-border/70 px-4 py-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge value={latestGlJob.status} />
                      <span className="text-sm font-medium text-foreground">
                        {latestGlJob.targetSystem === 'qbo' ? 'QuickBooks Online' : 'Xero'}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {latestGlJob.completedAt
                        ? `Updated ${new Date(latestGlJob.completedAt).toLocaleString()}`
                        : 'Job is still being processed.'}
                    </p>
                    {latestGlJob.errorMessage ? (
                      <p className="text-sm text-destructive">{latestGlJob.errorMessage}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['failed', 'skipped'].includes(latestGlJob.status) ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void retryGlExport(latestGlJob.id)}
                        disabled={actionLoading !== null}
                      >
                        <RefreshCw className="h-4 w-4" />
                        {actionLoading === `retry:${latestGlJob.id}` ? 'Retrying...' : 'Retry export'}
                      </Button>
                    ) : null}
                    <Button asChild type="button" variant="outline">
                      <Link href="/gl-mappings?view=export-history">View export history</Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 border border-border/70 px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    No automatic accounting job is available yet. Queue a manual export only when an
                    automatic job cannot be created.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Select
                      value={glSystem}
                      onChange={(event) => setGlSystem(event.target.value as 'qbo' | 'xero')}
                      className="w-48"
                    >
                      <option value="qbo">QuickBooks Online</option>
                      <option value="xero">Xero</option>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={doManualGlExport}
                      disabled={actionLoading !== null}
                    >
                      {actionLoading === 'gl' ? 'Queueing...' : 'Queue manual export'}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">External payment</CardTitle>
              <CardDescription>
                Use this exception only for a payment completed outside BetterSpend. Payment Runs
                remain the normal payment path.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!showExternalPayment ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowExternalPayment(true)}
                >
                  Record external payment
                </Button>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void doRecordExternalPayment();
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-sm font-medium text-foreground">
                      <span>Payment date</span>
                      <Input
                        type="date"
                        value={paymentDate}
                        onChange={(event) => setPaymentDate(event.target.value)}
                        required
                      />
                    </label>
                    <label className="space-y-2 text-sm font-medium text-foreground">
                      <span>Payment method</span>
                      <Select
                        value={paymentMethod}
                        onChange={(event) => setPaymentMethod(event.target.value)}
                      >
                        <option value="ach">ACH</option>
                        <option value="wire">Wire</option>
                        <option value="check">Check</option>
                        <option value="card">Card</option>
                        <option value="other">Other</option>
                      </Select>
                    </label>
                  </div>
                  <label className="block space-y-2 text-sm font-medium text-foreground">
                    <span>External reference</span>
                    <Input
                      value={paymentReference}
                      onChange={(event) => setPaymentReference(event.target.value)}
                      placeholder="Wire, check, or card reference"
                      required
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <Button type="submit" disabled={actionLoading !== null}>
                      {actionLoading === 'paid' ? 'Recording...' : 'Record payment'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowExternalPayment(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {id ? (
        <div className="pt-2">
          <DocumentUploader entityType="invoice" entityId={id} label="Documents" />
        </div>
      ) : null}

      {id ? (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">Messages</CardTitle>
            <CardDescription>
              Threaded conversation with the supplier. Messages are permanent and visible to both
              sides.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MessageThread threadType="invoice" threadId={id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/70 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-lg border-border/70 bg-card/95">
      <CardContent className="p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
