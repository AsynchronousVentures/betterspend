'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, RefreshCw, RotateCcw } from 'lucide-react';
import { Fragment } from 'react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

const SYSTEM_LABELS: Record<string, string> = { qbo: 'QuickBooks Online', xero: 'Xero' };

export default function GlExportJobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<{ id: string; ok: boolean } | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    setLoading(true);
    api.glExportJobs
      .list()
      .then(setJobs)
      .catch(() => {})
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
    if (retryResult && retryResult.id === jobId) {
      return retryResult.ok ? 'Queued' : 'Retry Failed';
    }
    return 'Retry';
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="GL Export Jobs"
        description="Review posting history to QuickBooks Online and Xero, inspect failures, and retry jobs that need another push."
        actions={
          <Button type="button" variant="outline" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Export history</CardTitle>
          <CardDescription>Approved invoices create jobs automatically. Failed jobs expose their error payload inline so finance can recover quickly.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
              Loading GL export jobs...
            </div>
          ) : jobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
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
                        className={hasError ? 'cursor-pointer' : undefined}
                        onClick={() => hasError && setExpanded(isExpanded ? null : job.id)}
                      >
                        <TableCell>
                          {job.invoiceId ? (
                            <Link
                              href={`/invoices/${job.invoiceId}`}
                              className="font-mono text-sm text-sky-700 transition-colors hover:text-sky-900"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {job.invoiceId.slice(0, 8)}...
                            </Link>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{SYSTEM_LABELS[job.targetSystem] ?? job.targetSystem}</TableCell>
                        <TableCell>
                          <StatusBadge value={job.status} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {job.completedAt ? new Date(job.completedAt).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">{job.attempts ?? 0}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {job.status === 'failed' ? (
                              <Button type="button" size="sm" onClick={(event) => handleRetry(event, job.id)} disabled={retrying === job.id}>
                                <RotateCcw className="h-3.5 w-3.5" />
                                {getRetryLabel(job.id)}
                              </Button>
                            ) : null}
                            {hasError ? (
                              <Button type="button" variant="outline" size="sm">
                                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
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
                                <code className="whitespace-pre-wrap break-all font-mono text-xs">{job.errorMessage}</code>
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
    </div>
  );
}
