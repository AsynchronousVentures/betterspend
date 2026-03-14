'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileSignature, Power, ShieldAlert } from 'lucide-react';
import { api } from '../../../lib/api';
import Breadcrumbs from '../../../components/breadcrumbs';
import { DocumentUploader } from '../../../components/document-uploader';
import { StatusBadge } from '../../../components/status-badge';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Textarea } from '../../../components/ui/textarea';

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

const fmt = (n: string | number | null | undefined, currency = 'USD') => {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(n));
};

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

function OverviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}

export default function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState('');
  const [contract, setContract] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [terminateReason, setTerminateReason] = useState('');
  const [terminating, setTerminating] = useState(false);

  useEffect(() => {
    params.then(({ id: resolvedId }) => {
      setId(resolvedId);
    });
  }, [params]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.contracts
      .get(id)
      .then(setContract)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleActivate() {
    setActionLoading(true);
    setError('');
    try {
      const updated = await api.contracts.activate(id);
      setContract(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to activate contract');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTerminate(event: FormEvent) {
    event.preventDefault();
    setTerminating(true);
    setError('');
    try {
      const updated = await api.contracts.terminate(id, terminateReason);
      setContract(updated);
      setShowTerminateModal(false);
      setTerminateReason('');
    } catch (err: any) {
      setError(err.message || 'Failed to terminate contract');
    } finally {
      setTerminating(false);
    }
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading...</div>;
  if (error && !contract) {
    return (
      <div className="p-8">
        <Link href="/contracts" className="text-sm text-primary hover:underline">
          Back to Contracts
        </Link>
        <div className="mt-4 text-sm text-rose-700">{error}</div>
      </div>
    );
  }
  if (!contract) return null;

  const canActivate = ['draft', 'pending_approval'].includes(contract.status);
  const canTerminate = ['active', 'expiring_soon'].includes(contract.status);
  const lines = contract.lines ?? contract.contractLines ?? [];
  const amendments = contract.amendments ?? [];

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs items={[{ label: 'Contracts', href: '/contracts' }, { label: contract.title }]} />
      <Link href="/contracts" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Contracts
      </Link>

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

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs font-semibold text-muted-foreground">
              {contract.contractNumber || 'CTR-DRAFT'}
            </span>
            <StatusBadge value={contract.status} label={STATUS_LABELS[contract.status]} />
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{contract.title}</h1>
        </div>
        <div className="flex gap-3">
          {canActivate ? (
            <Button onClick={handleActivate} disabled={actionLoading}>
              <Power className="h-4 w-4" />
              {actionLoading ? 'Activating...' : 'Activate'}
            </Button>
          ) : null}
          {canTerminate ? (
            <Button variant="outline" onClick={() => setShowTerminateModal(true)} disabled={actionLoading}>
              <ShieldAlert className="h-4 w-4" />
              Terminate
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <OverviewField label="Vendor" value={contract.vendor?.name ?? '—'} />
          <OverviewField label="Type" value={CONTRACT_TYPE_LABELS[contract.type] ?? contract.type ?? '—'} />
          <OverviewField label="Payment Terms" value={contract.paymentTerms ?? '—'} />
          <OverviewField label="Start Date" value={fmtDate(contract.startDate)} />
          <OverviewField label="End Date" value={fmtDate(contract.endDate)} />
          <OverviewField label="Total Value" value={contract.totalValue != null ? fmt(contract.totalValue, contract.currency ?? 'USD') : '—'} />
          <OverviewField
            label="Auto-Renew"
            value={contract.autoRenew ? `Yes${contract.renewalNoticeDays ? ` (${contract.renewalNoticeDays} days notice)` : ''}` : 'No'}
          />
          <OverviewField label="Currency" value={contract.currency ?? 'USD'} />
          <OverviewField label="Status" value={STATUS_LABELS[contract.status] ?? contract.status} />

          {contract.terms ? (
            <div className="md:col-span-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Terms & Conditions</div>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{contract.terms}</div>
            </div>
          ) : null}

          {contract.internalNotes ? (
            <div className="md:col-span-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Internal Notes</div>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{contract.internalNotes}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Contract Lines {lines.length > 0 ? `(${lines.length})` : ''}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No contract lines defined.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line: any, index: number) => {
                  const total = line.quantity != null && line.unitPrice != null ? Number(line.quantity) * Number(line.unitPrice) : null;
                  return (
                    <TableRow key={line.id ?? index}>
                      <TableCell className="text-foreground">{line.description ?? '—'}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{line.quantity ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{line.unitOfMeasure ?? line.uom ?? '—'}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {line.unitPrice != null ? fmt(line.unitPrice, contract.currency ?? 'USD') : '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground">
                        {total != null ? fmt(total, contract.currency ?? 'USD') : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Amendments {amendments.length > 0 ? `(${amendments.length})` : ''}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {amendments.length === 0 ? (
            <div className="text-sm text-muted-foreground">No amendments recorded.</div>
          ) : (
            amendments.map((amendment: any, index: number) => (
              <div key={amendment.id ?? index} className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                <div className="mb-2 flex items-center justify-between gap-4">
                  <span className="text-sm font-semibold text-amber-900">
                    Amendment #{amendment.amendmentNumber ?? index + 1}
                  </span>
                  <span className="text-xs text-amber-800/80">{fmtDate(amendment.effectiveDate ?? amendment.createdAt)}</span>
                </div>
                {amendment.description ? <p className="text-sm leading-6 text-foreground">{amendment.description}</p> : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {id ? <DocumentUploader entityType="contract" entityId={id} label="Documents" /> : null}

      {showTerminateModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowTerminateModal(false);
              setTerminateReason('');
            }
          }}
        >
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle className="text-lg">Terminate Contract</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                This will mark the contract as terminated. Provide a reason for the audit trail.
              </p>
              <form onSubmit={handleTerminate} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Reason *</label>
                  <Textarea rows={4} value={terminateReason} onChange={(event) => setTerminateReason(event.target.value)} placeholder="Enter reason for termination..." required />
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => { setShowTerminateModal(false); setTerminateReason(''); }}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={terminating || !terminateReason.trim()}>
                    {terminating ? 'Terminating...' : 'Terminate Contract'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
