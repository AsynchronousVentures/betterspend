'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

interface ApprovalRequest {
  id: string;
  approvableType: string;
  approvableId: string;
  currentStep: number;
  status: string;
  createdAt: string;
  rule?: { name: string };
}

function formatAmount(value: number | null | undefined) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.approvals
      .list()
      .then((data) => setApprovals(Array.isArray(data) ? data : (data as any).data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Approvals Queue"
        description="Review and act on approval requests that are actively waiting on a decision."
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
              Loading approvals...
            </div>
          ) : approvals.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="rounded-full bg-emerald-100 p-4">
                <CheckCircle2 className="h-6 w-6 text-emerald-700" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">No pending approvals</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  All caught up. Nothing currently requires review.
                </p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Entity</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Rule Name</TableHead>
                  <TableHead>Current Step</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvals.map((approval) => {
                  const entity = (approval as any).entitySummary;
                  const entityHref =
                    approval.approvableType === 'requisition'
                      ? `/requisitions/${approval.approvableId}`
                      : `/purchase-orders/${approval.approvableId}`;

                  return (
                    <TableRow key={approval.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            {approval.approvableType.replace(/_/g, ' ')}
                          </div>
                          {entity ? (
                            <Link href={entityHref} className="font-medium text-primary hover:underline">
                              {entity.number}
                              {entity.title ? ` — ${entity.title}` : entity.vendorName ? ` — ${entity.vendorName}` : ''}
                            </Link>
                          ) : (
                            <div className="font-mono text-xs text-muted-foreground">…{approval.approvableId.slice(-8)}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-foreground">{formatAmount(entity?.amount)}</TableCell>
                      <TableCell className="text-muted-foreground">{approval.rule?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">Step {approval.currentStep}</TableCell>
                      <TableCell>
                        <StatusBadge value={approval.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(approval.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm">
                          <Link href={`/approvals/${approval.id}`}>
                            Review
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </Button>
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
