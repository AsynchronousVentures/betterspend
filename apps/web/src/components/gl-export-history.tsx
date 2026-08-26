'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, RefreshCw, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { StatusBadge } from './status-badge';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

type GlExportJob = {
  id: string;
  invoiceId: string;
  targetSystem: string;
  status: string;
  attempts: number;
  exportedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  externalId: string | null;
  createdAt: string;
  invoice?: {
    internalNumber?: string | null;
    invoiceNumber?: string | null;
  } | null;
};

const SYSTEM_LABELS: Record<string, string> = {
  qbo: 'QuickBooks Online',
  xero: 'Xero',
};

function invoiceLabel(job: GlExportJob): string {
  return (
    job.invoice?.invoiceNumber ?? job.invoice?.internalNumber ?? `${job.invoiceId.slice(0, 8)}...`
  );
}

export function GlExportHistory({ selectedJobId }: { selectedJobId?: string | null }) {
  const [jobs, setJobs] = useState<GlExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<{ id: string; ok: boolean } | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!selectedJobId || loading || !jobs.some((job) => job.id === selectedJobId)) return;
    const job = jobs.find((candidate) => candidate.id === selectedJobId);
    if (job?.errorMessage) setExpanded(selectedJobId);
    document.getElementById(`gl-export-job-${selectedJobId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [jobs, loading, selectedJobId]);

  function refresh() {
    setLoading(true);
    api.glExportJobs
      .list()
      .then((data) => setJobs(data as GlExportJob[]))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }

  async function handleRetry(event: React.MouseEvent, jobId: string) {
    event.stopPropagation();
    setRetrying(jobId);
    setRetryResult(null);
    try {
      await api.glExportJobs.retry(jobId);
      setRetryResult({ id: jobId, ok: true });
      setTimeout(refresh, 1500);
    } catch {
      setRetryResult({ id: jobId, ok: false });
    } finally {
      setRetrying(null);
    }
  }

  function getRetryLabel(jobId: string) {
    if (retrying === jobId) return 'Retrying...';
    if (retryResult?.id === jobId) return retryResult.ok ? 'Queued' : 'Retry failed';
    return 'Retry';
  }

  return (
    <Card className="rounded-lg">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-xl">Export history</CardTitle>
          <CardDescription>
            Approved invoices create jobs automatically. Failed jobs expose their error payload
            inline so finance can recover quickly.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
            Loading export history...
          </div>
        ) : jobs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
            No export jobs yet. Trigger GL exports from approved invoice detail pages.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>System</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const isExpanded = expanded === job.id;
                const hasError = Boolean(job.errorMessage);
                return (
                  <Fragment key={job.id}>
                    <TableRow
                      id={`gl-export-job-${job.id}`}
                      aria-current={job.id === selectedJobId ? 'true' : undefined}
                      className={job.id === selectedJobId ? 'bg-muted/50' : hasError ? 'cursor-pointer' : undefined}
                      onClick={() => hasError && setExpanded(isExpanded ? null : job.id)}
                    >
                      <TableCell>
                        {job.invoiceId ? (
                          <Link
                            href={`/invoices/${job.invoiceId}`}
                            className="text-sm font-medium text-primary hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {invoiceLabel(job)}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {SYSTEM_LABELS[job.targetSystem] ?? job.targetSystem}
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={job.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {job.completedAt ? new Date(job.completedAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {job.attempts ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {job.status === 'failed' ? (
                            <Button
                              type="button"
                              size="sm"
                              onClick={(event) => handleRetry(event, job.id)}
                              disabled={retrying === job.id}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              {getRetryLabel(job.id)}
                            </Button>
                          ) : null}
                          {hasError ? (
                            <Button type="button" variant="outline" size="sm">
                              {isExpanded ? (
                                <ChevronUp className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                              Error
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && hasError ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={7} className="bg-rose-50/60">
                          <Alert variant="destructive">
                            <AlertDescription>
                              <code className="whitespace-pre-wrap break-all font-mono text-xs">
                                {job.errorMessage}
                              </code>
                            </AlertDescription>
                          </Alert>
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
  );
}
