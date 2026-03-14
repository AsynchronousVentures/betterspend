'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Select } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

interface Requisition {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  currency: string;
  totalAmount: string | null;
  createdAt: string;
}

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
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    api.requisitions
      .list()
      .then((data) => setRequisitions(Array.isArray(data) ? data : (data as any).data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = statusFilter ? requisitions.filter((requisition) => requisition.status === statusFilter) : requisitions;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Requisitions"
        description="Manage purchase requests from intake through approval and conversion."
        actions={
          <>
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="min-w-[200px]">
              <option value="">All Statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button asChild>
              <Link href="/requisitions/new">
                <Plus className="h-4 w-4" />
                New Requisition
              </Link>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
              Loading requisitions...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="rounded-full bg-muted p-4">
                <ClipboardList className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">
                  {statusFilter ? `No ${STATUS_LABELS[statusFilter] ?? statusFilter} requisitions` : 'No requisitions yet'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {statusFilter ? 'Try a different filter.' : 'Create your first request to kick off the procurement flow.'}
                </p>
              </div>
            </div>
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
                      <Link href={`/requisitions/${requisition.id}`} className="text-primary hover:underline">
                        {requisition.number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{requisition.title}</TableCell>
                    <TableCell>
                      <StatusBadge value={requisition.status} label={STATUS_LABELS[requisition.status]} />
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">{requisition.priority}</TableCell>
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
