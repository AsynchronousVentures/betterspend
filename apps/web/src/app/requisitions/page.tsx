'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Plus } from 'lucide-react';
import { api, loadFailureState } from '../../lib/api';
import type { RequisitionListItem } from '../../lib/api-contracts';
import { PageHeader } from '../../components/page-header';
import { ListState } from '../../components/resource-state';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Select } from '../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  converted: 'Converted',
};

function formatCurrency(amount: string | number | null, currency = 'USD') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

export default function RequisitionsPage() {
  const [requisitions, setRequisitions] = useState<RequisitionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.requisitions.list();
      setRequisitions(data);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = statusFilter
    ? requisitions.filter((requisition) => requisition.status === statusFilter)
    : requisitions;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Requisitions"
        description="Manage purchase requests from intake through approval and conversion."
        actions={
          <>
            <Button asChild>
              <Link href="/start">
                <Plus className="h-4 w-4" />
                Start Request
              </Link>
            </Button>
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="min-w-[200px]"
            >
              <option value="">All Statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button asChild variant="outline">
              <Link href="/requisitions/new">Manual requisition</Link>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading || loadError || filtered.length === 0 ? (
            <ListState
              state={loading ? 'loading' : loadError ? loadFailureState(loadError) : 'empty'}
              loadingLabel="Loading requisitions..."
              emptyTitle={
                statusFilter
                  ? `No ${STATUS_LABELS[statusFilter] ?? statusFilter} requisitions`
                  : 'No requisitions yet'
              }
              emptyDescription={
                statusFilter
                  ? 'Try a different filter.'
                  : 'Start a request to collect the context needed for routing and approval.'
              }
              icon={ClipboardList}
              onRetry={() => void load()}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((requisition) => (
                  <TableRow key={requisition.id}>
                    <TableCell className="font-semibold">
                      <Link
                        href={`/requisitions/${requisition.id}`}
                        className="text-primary hover:underline"
                      >
                        {requisition.number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{requisition.title}</TableCell>
                    <TableCell>
                      <StatusBadge
                        value={requisition.status}
                        label={STATUS_LABELS[requisition.status]}
                      />
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {requisition.priority}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {formatCurrency(requisition.totalAmount, requisition.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(requisition.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
