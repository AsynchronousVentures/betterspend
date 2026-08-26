'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../../lib/api';
import Breadcrumbs from '../../../components/breadcrumbs';
import { StatusBadge } from '../../../components/status-badge';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Textarea } from '../../../components/ui/textarea';
import {
  approvalEntityHref,
  approvalEntityLabel,
  formatApprovalAmount,
  formatApprovalDate,
  formatApprovalStatus,
  type ApprovalEntitySummary,
} from '../../../lib/approval-records';

interface ApprovalAction {
  id: string;
  step: number;
  actorId: string;
  action: string;
  comment: string | null;
  createdAt: string;
}

interface ApprovalRequest {
  id: string;
  approvableType: string;
  approvableId: string;
  currentStep: number;
  status: string;
  createdAt: string;
  rule?: { id: string; name: string };
  actions?: ApprovalAction[];
  entitySummary?: ApprovalEntitySummary | null;
}

export default function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState('');
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.approvals
        .get(pid)
        .then((data) => setApproval(data))
        .catch(() => setApproval(null))
        .finally(() => setLoading(false));
    });
  }, [params]);

  async function doAction(action: 'approve' | 'reject') {
    setError('');
    setActionLoading(action);
    try {
      if (action === 'approve') await api.approvals.approve(id, { comment: comment || undefined });
      else await api.approvals.reject(id, { comment: comment || undefined });
      const updated = await api.approvals.get(id);
      setApproval(updated);
      setComment('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading...</div>;
  if (!approval) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Approval not found. <Link href="/approvals" className="text-primary hover:underline">Back to queue</Link>
      </div>
    );
  }

  const actions = approval.actions ?? [];
  const entity = approval.entitySummary;
  const entityHref = approvalEntityHref(approval.approvableType, approval.approvableId);
  const entityLabel = approvalEntityLabel(approval.approvableType, entity);
  const isInvoice = approval.approvableType === 'invoice';
  const openLabel = isInvoice ? 'Open invoice' : 'Open record';

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs items={[{ label: 'Approvals', href: '/approvals' }, { label: approval.approvableType.replace(/_/g, ' ') }]} />
      <Link href="/approvals" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Approvals Queue
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3 text-xl capitalize">
            {approval.approvableType.replace(/_/g, ' ')}
            <StatusBadge value={approval.status} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {entity ? (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {entityHref ? (
                  <Link href={entityHref} className="text-primary hover:underline">
                    {openLabel}: {entityLabel}
                  </Link>
                ) : (
                  <span>{entityLabel}</span>
                )}
              </div>
              {isInvoice ? (
                <div className="grid gap-4 border-y border-border/70 py-4 sm:grid-cols-2 lg:grid-cols-5">
                  <ContextField label="Supplier" value={entity.vendorName ?? 'Not available'} />
                  <ContextField label="Gross amount" value={formatApprovalAmount(entity.amount, entity.currency)} />
                  <ContextField label="Currency" value={entity.currency ?? 'Not available'} />
                  <ContextField label="Match status" value={formatApprovalStatus(entity.matchStatus)} />
                  <ContextField label="Due date" value={formatApprovalDate(entity.dueDate)} />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="font-mono text-sm text-muted-foreground">ID: …{approval.approvableId.slice(-8)}</p>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            <div><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Rule</div><div className="mt-1 text-sm text-foreground">{approval.rule?.name ?? '—'}</div></div>
            <div><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Current Step</div><div className="mt-1 text-sm text-foreground">Step {approval.currentStep}</div></div>
            <div><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Created</div><div className="mt-1 text-sm text-foreground">{new Date(approval.createdAt).toLocaleDateString()}</div></div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Action History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {actions.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No actions recorded yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Step</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Comment</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.map((act) => (
                  <TableRow key={act.id}>
                    <TableCell className="text-muted-foreground">{act.step}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">…{act.actorId.slice(-8)}</TableCell>
                    <TableCell><StatusBadge value={act.action === 'approved' ? 'approved' : act.action === 'rejected' ? 'exception' : 'partial_match'} label={act.action} className="capitalize" /></TableCell>
                    <TableCell className="text-muted-foreground">{act.comment ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(act.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {approval.status === 'pending' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Take Action</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">Comment (optional)</label>
              <Textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="Add a comment for this action..." />
            </div>
            <div className="flex gap-3">
              <Button onClick={() => doAction('approve')} disabled={actionLoading !== null}>
                {actionLoading === 'approve' ? 'Approving...' : 'Approve'}
              </Button>
              <Button variant="outline" onClick={() => doAction('reject')} disabled={actionLoading !== null}>
                {actionLoading === 'reject' ? 'Rejecting...' : 'Reject'}
              </Button>
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ContextField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}
