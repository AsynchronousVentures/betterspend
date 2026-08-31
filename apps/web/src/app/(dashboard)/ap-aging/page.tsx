'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, CircleDollarSign, Percent, Wallet } from 'lucide-react';
import { api } from '../../../lib/api';
import type { InvoiceAgingReport, InvoiceListItem } from '../../../lib/api-contracts';
import { localDateInputValue } from '../../../lib/date-input';
import { PageHeader } from '../../../components/page-header';
import { StatusBadge } from '../../../components/status-badge';
import { Alert, AlertDescription } from '../../../components/ui/alert';
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

function fmt(amount: string | number) {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function daysOverdue(dueDateStr?: string | null) {
  if (!dueDateStr) return 0;
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}

function agingTone(days: number) {
  // Overdue severity ramp — BRANDING §7 status colors (success → warning → deep warning → destructive).
  if (days <= 0) return '#1f7a4f';
  if (days <= 30) return '#f0a230';
  if (days <= 60) return '#b45309';
  return '#c23b33';
}

function RecordExternalPaymentModal({
  invoice,
  onClose,
  onSuccess,
}: {
  invoice: InvoiceListItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(localDateInputValue);
  const [paymentMethod, setPaymentMethod] = useState('ach');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.invoices.markPaid(invoice.id, {
        paymentReference,
        paymentDate,
        paymentMethod,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to mark as paid');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-payment-title"
        className="w-full max-w-md rounded-lg border border-border/70 bg-card p-6 shadow-[0_30px_90px_-48px_rgba(15,23,42,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h3
          id="external-payment-title"
          className="text-xl font-semibold tracking-[-0.03em] text-foreground"
        >
          Record external payment
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {invoice.internalNumber} · {invoice.vendor?.name} · {fmt(invoice.totalAmount)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Use this only when the payment happened outside BetterSpend. Payment Runs are the normal
          path.
        </p>

        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          <div>
            <label
              htmlFor="external-payment-date"
              className="mb-2 block text-sm font-medium text-foreground"
            >
              Payment date
            </label>
            <Input
              id="external-payment-date"
              type="date"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
              required
            />
          </div>
          <div>
            <label
              htmlFor="external-payment-method"
              className="mb-2 block text-sm font-medium text-foreground"
            >
              Payment method
            </label>
            <Select
              id="external-payment-method"
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value)}
              required
            >
              <option value="ach">ACH</option>
              <option value="wire">Wire</option>
              <option value="check">Check</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div>
            <label
              htmlFor="external-payment-reference"
              className="mb-2 block text-sm font-medium text-foreground"
            >
              Payment Reference
            </label>
            <Input
              id="external-payment-reference"
              type="text"
              value={paymentReference}
              onChange={(event) => setPaymentReference(event.target.value)}
              placeholder="CHK-12345 or wire reference"
              required
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : 'Record payment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ApAgingPage() {
  const [aging, setAging] = useState<InvoiceAgingReport | null>(null);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [earlyPayCount, setEarlyPayCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [markPaidInvoice, setMarkPaidInvoice] = useState<InvoiceListItem | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [agingData, allInvoices, earlyPay] = await Promise.all([
        api.invoices.aging(),
        api.invoices.list(),
        api.invoices.earlyPaymentOpportunities(),
      ]);
      setAging(agingData);
      setInvoices(allInvoices.filter((invoice) => !invoice.paidAt && invoice.status !== 'paid'));
      setEarlyPayCount(earlyPay.length);
    } catch (err: any) {
      setError(err.message || 'Failed to load AP aging data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalOverdue = aging
    ? (
        parseFloat(aging.days_1_30.totalAmount) +
        parseFloat(aging.days_31_60.totalAmount) +
        parseFloat(aging.days_61_90.totalAmount) +
        parseFloat(aging.days_90_plus.totalAmount)
      ).toFixed(2)
    : '0.00';

  const dueIn7Days = invoices.filter((invoice) => {
    if (!invoice.dueDate) return false;
    const due = new Date(invoice.dueDate);
    const today = new Date();
    const in7 = new Date();
    in7.setDate(today.getDate() + 7);
    return due >= today && due <= in7;
  });

  const bucketCards = aging
    ? [
        {
          label: 'Current',
          value: fmt(aging.current.totalAmount),
          count: aging.current.count,
          className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        },
        {
          label: '1-30 Days',
          value: fmt(aging.days_1_30.totalAmount),
          count: aging.days_1_30.count,
          className: 'border-amber-200 bg-amber-50 text-amber-800',
        },
        {
          label: '31-60 Days',
          value: fmt(aging.days_31_60.totalAmount),
          count: aging.days_31_60.count,
          className: 'border-orange-200 bg-orange-50 text-orange-800',
        },
        {
          label: '61-90 Days',
          value: fmt(aging.days_61_90.totalAmount),
          count: aging.days_61_90.count,
          className: 'border-rose-200 bg-rose-50 text-rose-700',
        },
        {
          label: '90+ Days',
          value: fmt(aging.days_90_plus.totalAmount),
          count: aging.days_90_plus.count,
          className: 'border-rose-300 bg-rose-100 text-rose-800',
        },
      ]
    : [];

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading AP aging data...</div>;
  }

  if (error) {
    return <div className="p-8 text-sm text-rose-700">{error}</div>;
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="AP Aging"
        description="Accounts payable aging report, unpaid invoice monitoring, and payment workflow follow-through."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={AlertTriangle}
          label="Total Overdue"
          value={fmt(totalOverdue)}
          sub="Outstanding beyond due date"
          tone="text-rose-700"
        />
        <StatCard
          icon={Wallet}
          label="Open Invoices"
          value={String(invoices.length)}
          sub="Unpaid invoice count"
          tone="text-foreground"
        />
        <StatCard
          icon={CalendarClock}
          label="Due in 7 Days"
          value={fmt(
            dueIn7Days.reduce((sum, invoice) => sum + parseFloat(invoice.totalAmount || '0'), 0),
          )}
          sub={`${dueIn7Days.length} invoice${dueIn7Days.length !== 1 ? 's' : ''}`}
          tone="text-amber-700"
        />
        <StatCard
          icon={Percent}
          label="Early Payment Opportunities"
          value={String(earlyPayCount)}
          sub="Discounts expiring within 14 days"
          tone="text-emerald-700"
        />
      </div>

      {aging ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {bucketCards.map((bucket) => (
            <div key={bucket.label} className={`rounded-lg border px-5 py-5 ${bucket.className}`}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">
                {bucket.label}
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-[-0.03em]">{bucket.value}</div>
              <div className="mt-2 text-xs opacity-80">
                {bucket.count} invoice{bucket.count !== 1 ? 's' : ''}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl">Unpaid Invoices</CardTitle>
          <CardDescription>
            Track due dates, overdue exposure, discount windows, and mark approved invoices as paid.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {invoices.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
              No unpaid invoices found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Invoice Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Days Overdue</TableHead>
                  <TableHead>Discount Available</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => {
                  const overdueDays = daysOverdue(invoice.dueDate);
                  const isOverdue = overdueDays > 0;
                  const hasDiscount =
                    invoice.earlyPaymentDiscountPercent &&
                    parseFloat(invoice.earlyPaymentDiscountPercent) > 0;

                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium text-foreground">
                        {invoice.vendor?.name ?? '—'}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{invoice.internalNumber}</div>
                        <div className="text-xs text-muted-foreground">{invoice.invoiceNumber}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {invoice.invoiceDate
                          ? new Date(invoice.invoiceDate).toLocaleDateString()
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {invoice.dueDate ? (
                          <span className={isOverdue ? 'text-rose-700' : 'text-muted-foreground'}>
                            {new Date(invoice.dueDate).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No due date</span>
                        )}
                      </TableCell>
                      <TableCell className="font-semibold text-foreground">
                        {fmt(invoice.totalAmount)}
                      </TableCell>
                      <TableCell>
                        {isOverdue ? (
                          <span className="font-semibold" style={{ color: agingTone(overdueDays) }}>
                            {overdueDays}d overdue
                          </span>
                        ) : invoice.dueDate ? (
                          <span className="text-sm text-emerald-700">
                            {Math.abs(overdueDays)}d remaining
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {hasDiscount ? (
                          <div>
                            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                              {invoice.earlyPaymentDiscountPercent}% off
                            </span>
                            {invoice.earlyPaymentDiscountBy ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                by {new Date(invoice.earlyPaymentDiscountBy).toLocaleDateString()}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={invoice.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {invoice.status === 'approved' ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button asChild size="sm">
                              <Link href={`/payment-runs?invoiceId=${invoice.id}`}>
                                Open Payment Runs
                              </Link>
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setMarkPaidInvoice(invoice)}
                            >
                              Record external payment
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {markPaidInvoice ? (
        <RecordExternalPaymentModal
          invoice={markPaidInvoice}
          onClose={() => setMarkPaidInvoice(null)}
          onSuccess={() => {
            setMarkPaidInvoice(null);
            loadData();
          }}
        />
      ) : null}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <Card className="rounded-lg">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
          <div className="rounded-full border border-border/70 bg-muted/30 p-2">
            <Icon className="h-4 w-4 text-foreground" />
          </div>
        </div>
        <div className={`text-3xl font-semibold tracking-[-0.03em] ${tone}`}>{value}</div>
        <div className="mt-2 text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
