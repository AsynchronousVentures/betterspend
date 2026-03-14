'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, FileSignature, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  msa: 'MSA',
  sow: 'SOW',
  nda: 'NDA',
  sla: 'SLA',
  purchase_agreement: 'Purchase Agreement',
  framework: 'Framework Agreement',
  other: 'Other',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  active: 'Active',
  expiring_soon: 'Expiring Soon',
  expired: 'Expired',
  terminated: 'Terminated',
};

const TABS = [
  { label: 'All', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Expiring Soon', value: 'expiring_soon' },
  { label: 'Draft', value: 'draft' },
  { label: 'Expired', value: 'expired' },
  { label: 'Terminated', value: 'terminated' },
];

const fmt = (n: string | number | null | undefined, currency = 'USD') => {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(n));
};

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function ContractsPage() {
  const [contracts, setContracts] = useState<any[]>([]);
  const [expiring, setExpiring] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('');
  const [dismissWarning, setDismissWarning] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = activeTab ? { status: activeTab } : undefined;
    Promise.all([api.contracts.list(params), api.contracts.expiring(30)])
      .then(([list, exp]) => {
        setContracts(list);
        setExpiring(exp);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [activeTab]);

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

      {!dismissWarning && expiring.length > 0 ? (
        <Alert variant="warning">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>
              <strong>Warning:</strong> {expiring.length} contract{expiring.length !== 1 ? 's' : ''} expiring within 30 days.
            </span>
            <div className="flex items-center gap-3">
              <button onClick={() => setActiveTab('expiring_soon')} className="text-sm font-semibold underline">
                View expiring contracts
              </button>
              <button onClick={() => setDismissWarning(true)} className="text-sm font-semibold">
                Dismiss
              </button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <PageHeader
        title="Contracts"
        description="Vendor agreements, renewal exposure, and procurement commitments in one place."
        actions={
          <Button asChild>
            <Link href="/contracts/new">
              <Plus className="h-4 w-4" />
              New Contract
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.value;
          return (
            <Button
              key={tab.value}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTab(tab.value)}
            >
              {tab.label}
            </Button>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
              Loading contracts...
            </div>
          ) : contracts.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="rounded-full bg-muted p-4">
                <FileSignature className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">No contracts found</p>
                <p className="mt-1 text-sm text-muted-foreground">Create your first vendor agreement to start tracking obligations and renewals.</p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Contract #</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Auto-Renew</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((contract) => (
                  <TableRow
                    key={contract.id}
                    className="cursor-pointer"
                    onClick={() => {
                      window.location.href = `/contracts/${contract.id}`;
                    }}
                  >
                    <TableCell className="font-mono text-xs font-semibold text-primary">
                      {contract.contractNumber || '—'}
                    </TableCell>
                    <TableCell className="max-w-[260px] font-semibold text-foreground">
                      <span className="block truncate">{contract.title}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{contract.vendor?.name ?? contract.vendorId ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {CONTRACT_TYPE_LABELS[contract.type] ?? contract.type ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={contract.status} label={STATUS_LABELS[contract.status]} />
                    </TableCell>
                    <TableCell className="text-right font-medium text-foreground">
                      {contract.totalValue != null ? fmt(contract.totalValue, contract.currency ?? 'USD') : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(contract.startDate)}</TableCell>
                    <TableCell className={contract.status === 'expiring_soon' ? 'font-medium text-amber-700' : 'text-muted-foreground'}>
                      {fmtDate(contract.endDate)}
                    </TableCell>
                    <TableCell>
                      {contract.autoRenew ? (
                        <StatusBadge value="partial_match" label="Auto-Renew" />
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
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
