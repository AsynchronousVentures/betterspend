'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileSearch, RefreshCcw, ScanLine } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

const STATUS_STYLES: Record<string, string> = {
  pending: 'border-amber-200 bg-amber-100 text-amber-800',
  processing: 'border-sky-200 bg-sky-100 text-sky-800',
  done: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  failed: 'border-rose-200 bg-rose-100 text-rose-800',
};

export default function OcrJobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.ocr.list();
      setJobs(data);
    } catch {
      setError('Failed to load OCR job history.');
    } finally {
      setLoading(false);
    }
  }

  const completedJobs = jobs.filter((job) => job.status === 'done').length;
  const failedJobs = jobs.filter((job) => job.status === 'failed').length;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="OCR Jobs"
        description="Invoice PDF and image extraction history. Upload documents from New Invoice to start a new scan."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/invoices/new">New Invoice</Link>
            </Button>
            <Button type="button" variant="outline" onClick={load}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={ScanLine} label="Total Jobs" value={String(jobs.length)} tone="text-sky-700" />
        <StatCard icon={FileSearch} label="Completed" value={String(completedJobs)} tone="text-emerald-700" />
        <StatCard icon={RefreshCcw} label="Failed" value={String(failedJobs)} tone="text-rose-700" />
      </div>

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Extraction History</CardTitle>
          <CardDescription>
            Expand successful jobs to inspect the extracted invoice fields and line-item payload.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <EmptyState message="Loading OCR jobs..." />
          ) : jobs.length === 0 ? (
            <EmptyState message="No OCR jobs yet. Upload an invoice PDF or image on the New Invoice page to start extraction." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Filename</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const extracted = job.extractedData;
                  const confidence = job.confidence;
                  const isExpanded = expanded === job.id;
                  const hasData = extracted && (extracted.invoiceNumber || extracted.lines?.length > 0);

                  return (
                    <Fragment key={job.id}>
                      <TableRow
                        className={hasData ? 'cursor-pointer' : undefined}
                        onClick={() => hasData && setExpanded(isExpanded ? null : job.id)}
                      >
                        <TableCell className="max-w-[220px] truncate font-medium text-foreground">
                          {job.filename}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={STATUS_STYLES[job.status] ?? 'border-border bg-muted text-foreground'}
                          >
                            {job.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {extracted?.invoiceNumber ?? '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {extracted?.vendorName ?? '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {extracted?.totalAmount != null
                            ? new Intl.NumberFormat('en-US', {
                                style: 'currency',
                                currency: extracted.currency ?? 'USD',
                              }).format(extracted.totalAmount)
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {confidence?.overall != null ? (
                            <div className="flex items-center gap-3">
                              <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={`h-full rounded-full ${
                                    confidence.overall > 0.8
                                      ? 'bg-emerald-500'
                                      : confidence.overall > 0.5
                                        ? 'bg-amber-500'
                                        : 'bg-rose-500'
                                  }`}
                                  style={{ width: `${Math.round(confidence.overall * 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {Math.round(confidence.overall * 100)}%
                              </span>
                            </div>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {new Date(job.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {job.invoiceId ? (
                            <Link
                              href={`/invoices/${job.invoiceId}`}
                              className="text-sm font-medium text-foreground underline underline-offset-4"
                              onClick={(event) => event.stopPropagation()}
                            >
                              View Invoice
                            </Link>
                          ) : job.status === 'done' ? (
                            <Link
                              href="/invoices/new"
                              className="text-sm text-muted-foreground underline underline-offset-4"
                              onClick={(event) => event.stopPropagation()}
                            >
                              Create Invoice
                            </Link>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          {hasData ? (isExpanded ? 'Hide' : 'Show') : '—'}
                        </TableCell>
                      </TableRow>

                      {isExpanded && hasData ? (
                        <TableRow>
                          <TableCell colSpan={9} className="bg-muted/20 py-5">
                            <div className="space-y-5">
                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                {[
                                  { label: 'Invoice #', value: extracted.invoiceNumber },
                                  { label: 'Vendor', value: extracted.vendorName },
                                  { label: 'Invoice Date', value: extracted.invoiceDate },
                                  { label: 'Due Date', value: extracted.dueDate },
                                  {
                                    label: 'Subtotal',
                                    value:
                                      extracted.subtotal != null
                                        ? `${extracted.currency ?? '$'}${extracted.subtotal}`
                                        : null,
                                  },
                                  {
                                    label: 'Tax',
                                    value:
                                      extracted.taxAmount != null
                                        ? `${extracted.currency ?? '$'}${extracted.taxAmount}`
                                        : null,
                                  },
                                  {
                                    label: 'Total',
                                    value:
                                      extracted.totalAmount != null
                                        ? `${extracted.currency ?? '$'}${extracted.totalAmount}`
                                        : null,
                                  },
                                  { label: 'Currency', value: extracted.currency },
                                ].map(({ label, value }) => (
                                  <div
                                    key={label}
                                    className="rounded-2xl border border-border/70 bg-background/80 p-4"
                                  >
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                      {label}
                                    </div>
                                    <div className="mt-2 text-sm text-foreground">{value ?? '—'}</div>
                                  </div>
                                ))}
                              </div>

                              {extracted.lines && extracted.lines.length > 0 ? (
                                <div className="space-y-3">
                                  <div className="text-sm font-semibold text-foreground">Line Items</div>
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Description</TableHead>
                                        <TableHead>Qty</TableHead>
                                        <TableHead>Unit Price</TableHead>
                                        <TableHead>Total</TableHead>
                                        <TableHead>GL Account</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {extracted.lines.map((line: any, index: number) => (
                                        <TableRow key={index}>
                                          <TableCell>{line.description}</TableCell>
                                          <TableCell>{line.quantity}</TableCell>
                                          <TableCell>${line.unitPrice}</TableCell>
                                          <TableCell>${line.totalPrice}</TableCell>
                                          <TableCell className="text-muted-foreground">
                                            {line.glAccount ?? '—'}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              ) : null}

                              {job.errorMessage ? (
                                <Alert variant="destructive">
                                  <AlertDescription>Error: {job.errorMessage}</AlertDescription>
                                </Alert>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
      {message}
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
    <Card className="rounded-[24px] border-border/70 bg-card/95">
      <CardContent className="flex items-center gap-4 p-6">
        <div className={`rounded-2xl border border-current/10 bg-current/10 p-3 ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
          <div className="font-display text-3xl font-semibold tracking-[-0.04em] text-foreground">
            {value}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
