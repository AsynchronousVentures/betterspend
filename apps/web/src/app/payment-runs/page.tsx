'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, FileCheck2, RefreshCw, Send, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

type Invoice = {
  id: string;
  internalNumber: string;
  invoiceNumber: string;
  totalAmount: string;
  currency: string;
  dueDate: string | null;
  entityId?: string | null;
  vendor: { name: string } | null;
  entity?: { name: string } | null;
};

type PaymentRun = {
  id: string;
  status: string;
  runDate: string;
  scheduledDate: string | null;
  totalAmount: string;
  currency: string;
  invoiceCount: string;
  providerBatchId?: string | null;
  paymentRunInvoices?: Array<{
    paymentMethod: string;
    status: string;
    amount: string;
    currency: string;
    invoice?: Invoice | null;
  }>;
};

const PAYMENT_METHODS = [
  { value: 'manual', label: 'Manual' },
  { value: 'ach', label: 'ACH' },
  { value: 'wire', label: 'Wire' },
  { value: 'check', label: 'Check' },
  { value: 'virtual_card', label: 'Virtual Card' },
];

function formatMoney(value: string | number | null | undefined, currency = 'USD') {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusTone(status: string) {
  if (status === 'paid') return 'matched';
  if (status === 'approved') return 'approved';
  if (status === 'cancelled') return 'cancelled';
  return status;
}

export default function PaymentRunsPage() {
  const [eligibleInvoices, setEligibleInvoices] = useState<Invoice[]>([]);
  const [runs, setRuns] = useState<PaymentRun[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paymentMethod, setPaymentMethod] = useState('manual');
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [eligible, runList, runSummary] = await Promise.all([
        api.paymentRuns.eligibleInvoices(),
        api.paymentRuns.list(),
        api.paymentRuns.summary(),
      ]);
      setEligibleInvoices(Array.isArray(eligible) ? eligible : []);
      setRuns(Array.isArray(runList) ? runList : []);
      setSummary(runSummary ?? null);
    } catch (err: any) {
      setError(err.message || 'Failed to load payment runs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedInvoices = useMemo(
    () => eligibleInvoices.filter((invoice) => selected.has(invoice.id)),
    [eligibleInvoices, selected],
  );

  const selectedTotal = selectedInvoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount ?? 0), 0);
  const selectedCurrency = selectedInvoices[0]?.currency ?? 'USD';
  const mixedCurrency = new Set(selectedInvoices.map((invoice) => invoice.currency)).size > 1;
  const mixedEntity = new Set(selectedInvoices.map((invoice) => invoice.entity?.name ?? 'none')).size > 1;

  function toggleInvoice(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreateRun() {
    if (selectedInvoices.length === 0 || mixedCurrency || mixedEntity) return;
    setBusy('create');
    setError('');
    setMessage('');
    try {
      const entityId = selectedInvoices[0]?.entityId ?? null;
      await api.paymentRuns.create({
        invoiceIds: selectedInvoices.map((invoice) => invoice.id),
        paymentMethod,
        scheduledDate,
        entityId,
        notes: notes.trim() || undefined,
      });
      setSelected(new Set());
      setNotes('');
      setMessage('Payment run created.');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to create payment run');
    } finally {
      setBusy('');
    }
  }

  async function runAction(id: string, action: 'approve' | 'submit' | 'cancel') {
    setBusy(`${action}:${id}`);
    setError('');
    setMessage('');
    try {
      if (action === 'approve') {
        await api.paymentRuns.approve(id);
        setMessage('Payment run approved.');
      } else if (action === 'submit') {
        await api.paymentRuns.submit(id, { paymentReference: paymentReference.trim() || undefined });
        setPaymentReference('');
        setMessage('Payment run submitted and invoices marked paid.');
      } else {
        await api.paymentRuns.cancel(id, { reason: 'Cancelled from payment run workspace' });
        setMessage('Payment run cancelled.');
      }
      await load();
    } catch (err: any) {
      setError(err.message || `Failed to ${action} payment run`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-sm font-semibold">
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert variant="success">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{message}</span>
            <button onClick={() => setMessage('')} className="text-sm font-semibold">
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      <PageHeader
        title="Payment Runs"
        description="Batch approved invoices, control payment methods, and record payment release status."
        actions={
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Draft Runs</div>
            <div className="mt-2 text-2xl font-semibold">{summary?.draftCount ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Approved Runs</div>
            <div className="mt-2 text-2xl font-semibold">{summary?.approvedCount ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Open Amount</div>
            <div className="mt-2 text-2xl font-semibold">{formatMoney(summary?.openAmount ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Eligible Invoices</div>
            <div className="mt-2 text-2xl font-semibold">{eligibleInvoices.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Run</CardTitle>
          <CardDescription>Select approved unpaid invoices to schedule as one payment batch.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Run notes"
              className="min-h-[44px]"
            />
            <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              {PAYMENT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </Select>
            <Input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 px-4 py-3">
            <div className="text-sm">
              <span className="font-semibold">{selectedInvoices.length}</span> selected ·{' '}
              <span className="font-semibold">{formatMoney(selectedTotal, selectedCurrency)}</span>
              {mixedCurrency ? <span className="ml-2 text-destructive">Split by currency before creating.</span> : null}
              {mixedEntity ? <span className="ml-2 text-destructive">Split by entity before creating.</span> : null}
            </div>
            <Button
              onClick={handleCreateRun}
              disabled={busy === 'create' || selectedInvoices.length === 0 || mixedCurrency || mixedEntity}
            >
              <FileCheck2 className="h-4 w-4" />
              {busy === 'create' ? 'Creating...' : 'Create Draft Run'}
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-border/70">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      Loading eligible invoices...
                    </TableCell>
                  </TableRow>
                ) : eligibleInvoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No approved unpaid invoices are ready for payment.
                    </TableCell>
                  </TableRow>
                ) : (
                  eligibleInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selected.has(invoice.id)}
                          onChange={() => toggleInvoice(invoice.id)}
                          aria-label={`Select ${invoice.internalNumber}`}
                          className="h-4 w-4 rounded border-border"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-foreground">{invoice.internalNumber}</div>
                        <div className="text-xs text-muted-foreground">{invoice.invoiceNumber}</div>
                      </TableCell>
                      <TableCell>{invoice.vendor?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{invoice.entity?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(invoice.dueDate)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoney(invoice.totalAmount, invoice.currency)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
          <CardDescription>Approve and release scheduled payment batches.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex max-w-lg gap-3">
            <Input
              value={paymentReference}
              onChange={(event) => setPaymentReference(event.target.value)}
              placeholder="Optional payment reference for submission"
            />
          </div>
          <div className="overflow-hidden rounded-lg border border-border/70">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Status</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Invoices</TableHead>
                  <TableHead>Methods</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No payment runs yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  runs.map((run) => {
                    const methods = [
                      ...new Set((run.paymentRunInvoices ?? []).map((item) => item.paymentMethod)),
                    ].join(', ');
                    const usesVirtualCard = methods.includes('virtual_card');
                    const actionBusy = (action: string) => busy === `${action}:${run.id}`;
                    return (
                      <TableRow key={run.id}>
                        <TableCell>
                          <StatusBadge value={statusTone(run.status)} label={run.status.replace(/_/g, ' ')} />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{formatDate(run.scheduledDate ?? run.runDate)}</div>
                          <div className="text-xs text-muted-foreground">{run.id.slice(0, 8)}</div>
                        </TableCell>
                        <TableCell>{Number(run.invoiceCount ?? run.paymentRunInvoices?.length ?? 0)}</TableCell>
                        <TableCell className="capitalize text-muted-foreground">{methods.replace(/_/g, ' ') || '—'}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoney(run.totalAmount, run.currency)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            {run.status === 'draft' || run.status === 'pending_approval' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => runAction(run.id, 'approve')}
                                disabled={actionBusy('approve')}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                Approve
                              </Button>
                            ) : null}
                            {run.status === 'approved' ? (
                              <Button size="sm" onClick={() => runAction(run.id, 'submit')} disabled={actionBusy('submit')}>
                                {usesVirtualCard ? (
                                  <CreditCard className="h-4 w-4" />
                                ) : (
                                  <Send className="h-4 w-4" />
                                )}
                                Submit
                              </Button>
                            ) : null}
                            {!['paid', 'cancelled'].includes(run.status) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => runAction(run.id, 'cancel')}
                                disabled={actionBusy('cancel')}
                              >
                                <XCircle className="h-4 w-4" />
                                Cancel
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
