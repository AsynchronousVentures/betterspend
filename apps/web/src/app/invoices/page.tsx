'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Download, FileSpreadsheet, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Select } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

interface Invoice {
  id: string;
  internalNumber: string;
  invoiceNumber: string;
  status: string;
  matchStatus: string;
  totalAmount: string;
  currency: string;
  invoiceDate: string;
  dueDate: string | null;
  vendor: { name: string } | null;
  purchaseOrder: { number: string } | null;
}

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

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ success: number; failed: number } | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    api.invoices
      .list()
      .then((data) => setInvoices(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = statusFilter ? invoices.filter((invoice) => invoice.status === statusFilter) : invoices;

  const approvableSelected = [...selected].filter((id) => {
    const invoice = invoices.find((item) => item.id === id);
    return invoice && !['approved', 'paid', 'cancelled'].includes(invoice.status) && invoice.matchStatus !== 'exception';
  });

  function toggleSelect(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const approvable = filtered.filter(
      (invoice) => !['approved', 'paid', 'cancelled'].includes(invoice.status) && invoice.matchStatus !== 'exception',
    );

    if (approvable.every((invoice) => selected.has(invoice.id))) {
      setSelected((previous) => {
        const next = new Set(previous);
        approvable.forEach((invoice) => next.delete(invoice.id));
        return next;
      });
      return;
    }

    setSelected((previous) => {
      const next = new Set(previous);
      approvable.forEach((invoice) => next.add(invoice.id));
      return next;
    });
  }

  async function handleBulkApprove() {
    if (approvableSelected.length === 0) return;
    setBulkLoading(true);
    setError('');
    setBulkResult(null);
    try {
      const results = await api.invoices.bulkApprove(approvableSelected);
      const success = results.filter((result: any) => result.success).length;
      const failed = results.filter((result: any) => !result.success).length;
      setBulkResult({ success, failed });
      setSelected(new Set());
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      await downloadCsv('invoices');
    } finally {
      setExporting(false);
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
      {bulkResult ? (
        <Alert variant="success">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>
              Bulk approve complete: {bulkResult.success} approved
              {bulkResult.failed > 0 ? `, ${bulkResult.failed} failed` : ''}.
            </span>
            <button onClick={() => setBulkResult(null)} className="text-sm font-semibold">
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      <PageHeader
        title="Invoices"
        description="Monitor matching, overdue exposure, and approval throughput across supplier invoices."
        actions={
          <>
            {selected.size > 0 ? (
              <Button onClick={handleBulkApprove} disabled={bulkLoading || approvableSelected.length === 0}>
                {bulkLoading ? 'Approving...' : `Approve ${approvableSelected.length} Selected`}
              </Button>
            ) : null}
            <Select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setSelected(new Set());
              }}
              className="min-w-[180px]"
            >
              <option value="">All Statuses</option>
              <option value="pending_match">Pending Match</option>
              <option value="matched">Matched</option>
              <option value="partial_match">Partial Match</option>
              <option value="exception">Exception</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
            </Select>
            <Button variant="outline" onClick={handleExportCsv} disabled={exporting}>
              {exporting ? <Download className="h-4 w-4 animate-pulse" /> : <FileSpreadsheet className="h-4 w-4" />}
              {exporting ? 'Exporting...' : 'Export CSV'}
            </Button>
            <Button asChild>
              <Link href="/invoices/new">
                <Plus className="h-4 w-4" />
                New Invoice
              </Link>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
              Loading invoices...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="rounded-full bg-muted p-4">
                <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">
                  {statusFilter ? `No ${statusFilter.replace(/_/g, ' ')} invoices` : 'No invoices yet'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {statusFilter ? 'Try a different filter.' : 'Create an invoice to start three-way matching against your PO and receipt data.'}
                </p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      onChange={toggleAll}
                      checked={
                        filtered
                          .filter(
                            (invoice) =>
                              !['approved', 'paid', 'cancelled'].includes(invoice.status) &&
                              invoice.matchStatus !== 'exception',
                          )
                          .every((invoice) => selected.has(invoice.id)) &&
                        filtered.some((invoice) => !['approved', 'paid', 'cancelled'].includes(invoice.status))
                      }
                    />
                  </TableHead>
                  <TableHead>Internal #</TableHead>
                  <TableHead>Vendor Invoice #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Invoice Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((invoice) => {
                  const isOverdue =
                    invoice.dueDate &&
                    !['approved', 'paid', 'cancelled'].includes(invoice.status) &&
                    new Date(invoice.dueDate) < new Date();
                  const canSelect =
                    !['approved', 'paid', 'cancelled'].includes(invoice.status) && invoice.matchStatus !== 'exception';

                  return (
                    <TableRow key={invoice.id} className={isOverdue ? 'bg-rose-50/70 hover:bg-rose-50' : undefined}>
                      <TableCell>
                        {canSelect ? (
                          <input
                            type="checkbox"
                            checked={selected.has(invoice.id)}
                            onChange={() => toggleSelect(invoice.id)}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell className="font-semibold">
                        <Link href={`/invoices/${invoice.id}`} className="text-primary hover:underline">
                          {invoice.internalNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{invoice.invoiceNumber}</TableCell>
                      <TableCell className="text-muted-foreground">{invoice.vendor?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{invoice.purchaseOrder?.number ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(invoice.invoiceDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell className={isOverdue ? 'font-semibold text-rose-700' : 'text-muted-foreground'}>
                        <div className="flex items-center gap-2">
                          <span>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—'}</span>
                          {isOverdue ? <AlertTriangle className="h-4 w-4" /> : null}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {formatCurrency(invoice.totalAmount, invoice.currency)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={invoice.matchStatus} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={invoice.status} />
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
