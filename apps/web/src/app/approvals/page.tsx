'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { ApprovalEntityLink } from './approval-entity-link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  approvalEntityHref,
  approvalEntityLabel,
  formatApprovalAmount,
  formatApprovalDate,
  formatApprovalStatus,
  type ApprovalEntitySummary,
} from '../../lib/approval-records';

interface ApprovalRequest {
  id: string;
  approvableType: string;
  approvableId: string;
  currentStep: number;
  status: string;
  createdAt: string;
  rule?: { name: string };
  entitySummary?: ApprovalEntitySummary | null;
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.approvals
      .list()
      .then((data) => setApprovals(Array.isArray(data) ? data : ((data as any).data ?? [])))
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
            <>
              <div className="divide-y divide-border/70 md:hidden">
                {approvals.map((approval) => {
                  const entity = approval.entitySummary;
                  const entityHref = approvalEntityHref(
                    approval.approvableType,
                    approval.approvableId,
                  );
                  const entityLabel = approvalEntityLabel(approval.approvableType, entity);
                  const counterparty = entity?.vendorName ?? entity?.title ?? 'Not available';

                  return (
                    <article key={approval.id} className="space-y-4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            {approval.approvableType.replace(/_/g, ' ')}
                          </div>
                          <ApprovalEntityLink
                            entity={entity}
                            href={entityHref}
                            label={entityLabel}
                          />
                        </div>
                        <StatusBadge value={approval.status} />
                      </div>
                      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div className="min-w-0">
                          <dt className="text-xs text-muted-foreground">Counterparty</dt>
                          <dd className="mt-1 truncate text-foreground">{counterparty}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Amount</dt>
                          <dd className="mt-1 font-medium text-foreground">
                            {entity
                              ? formatApprovalAmount(entity.amount, entity.currency)
                              : 'Not available'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Step</dt>
                          <dd className="mt-1 text-foreground">{approval.currentStep}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Created</dt>
                          <dd className="mt-1 text-foreground">
                            {new Date(approval.createdAt).toLocaleDateString()}
                          </dd>
                        </div>
                        <div className="col-span-2 min-w-0">
                          <dt className="text-xs text-muted-foreground">Rule</dt>
                          <dd className="mt-1 truncate text-foreground">
                            {approval.rule?.name ?? '—'}
                          </dd>
                        </div>
                      </dl>
                      <Button asChild size="sm">
                        <Link href={`/approvals/${approval.id}`}>
                          Review
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </article>
                  );
                })}
              </div>

              <div className="hidden md:block">
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
                      const entity = approval.entitySummary;
                      const entityHref = approvalEntityHref(
                        approval.approvableType,
                        approval.approvableId,
                      );
                      const entityLabel = approvalEntityLabel(approval.approvableType, entity);
                      const isInvoice = approval.approvableType === 'invoice';

                      return (
                        <TableRow key={approval.id}>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                {approval.approvableType.replace(/_/g, ' ')}
                              </div>
                              {entity ? (
                                entityHref ? (
                                  <Link
                                    href={entityHref}
                                    className="font-medium text-primary hover:underline"
                                  >
                                    {entityLabel}
                                  </Link>
                                ) : (
                                  <span className="font-medium text-foreground">{entityLabel}</span>
                                )
                              ) : (
                                <div className="font-mono text-xs text-muted-foreground">
                                  …{approval.approvableId.slice(-8)}
                                </div>
                              )}
                              {isInvoice && entity ? (
                                <div className="text-xs text-muted-foreground">
                                  {entity.vendorName ?? 'Supplier not available'} · Match:{' '}
                                  {formatApprovalStatus(entity.matchStatus)} · Due:{' '}
                                  {formatApprovalDate(entity.dueDate)}
                                </div>
                              ) : entity?.title || entity?.vendorName ? (
                                <div className="text-xs text-muted-foreground">
                                  {entity.title ?? entity.vendorName}
                                </div>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="font-medium text-foreground">
                            {entity
                              ? formatApprovalAmount(entity.amount, entity.currency)
                              : 'Not available'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {approval.rule?.name ?? '—'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            Step {approval.currentStep}
                          </TableCell>
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
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
