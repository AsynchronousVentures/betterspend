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
          {(approval as any).entitySummary ? (
            <p className="text-sm text-muted-foreground">
              <Link
                href={approval.approvableType === 'requisition' ? `/requisitions/${approval.approvableId}` : `/purchase-orders/${approval.approvableId}`}
                className="text-primary hover:underline"
              >
                {(approval as any).entitySummary.number}
                {(approval as any).entitySummary.title ? ` — ${(approval as any).entitySummary.title}` : ''}
                {(approval as any).entitySummary.vendorName ? ` — ${(approval as any).entitySummary.vendorName}` : ''}
              </Link>
            </p>
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
