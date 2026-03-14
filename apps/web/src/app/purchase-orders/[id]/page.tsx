'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import Breadcrumbs from '../../../components/breadcrumbs';
import { PageHeader } from '../../../components/page-header';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Textarea } from '../../../components/ui/textarea';

interface POLine {
  id: string;
  lineNumber?: number;
  description: string;
  qty: string | number;
  uom: string;
  unitPrice: string | number;
}

interface POVersion {
  id: string;
  version: number;
  changeReason: string | null;
  createdAt: string;
}

interface BlanketRelease {
  id: string;
  releaseNumber: number;
  amount: string;
  description: string | null;
  status: string;
  createdAt: string;
}

interface ReceivingLine {
  poLineId: string;
  lineNumber: string;
  description: string;
  orderedQty: string;
  uom: string;
  receivedQty: string;
  rejectedQty: string;
  outstandingQty: string;
  receivedPct: string;
  grnCount: number;
}

interface PurchaseOrder {
  id: string;
  number: string;
  vendor: { name: string } | null;
  version: number;
  status: string;
  currency: string;
  paymentTerms: string | null;
  notes: string | null;
  totalAmount: string | null;
  issuedAt: string | null;
  createdAt: string;
  poType: string;
  blanketStartDate: string | null;
  blanketEndDate: string | null;
  blanketTotalLimit: string | null;
  blanketReleasedAmount: string | null;
  lines: POLine[];
  versions?: POVersion[];
}

function formatCurrency(amount: string | number | null, currency = 'USD') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

function statusVariant(status: string) {
  if (['approved', 'received', 'closed'].includes(status)) return 'success';
  if (['issued', 'invoiced'].includes(status)) return 'outline';
  if (status === 'partially_received') return 'warning';
  if (status === 'cancelled') return 'destructive';
  return 'secondary';
}

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState('');
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [changeError, setChangeError] = useState('');
  const [changeSubmitting, setChangeSubmitting] = useState(false);
  const [releases, setReleases] = useState<BlanketRelease[]>([]);
  const [receivingLines, setReceivingLines] = useState<ReceivingLine[]>([]);
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [complianceReport, setComplianceReport] = useState<any>(null);
  const [releaseAmount, setReleaseAmount] = useState('');
  const [releaseDesc, setReleaseDesc] = useState('');
  const [releaseError, setReleaseError] = useState('');
  const [releaseSubmitting, setReleaseSubmitting] = useState(false);

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.purchaseOrders
        .get(pid)
        .then((data) => {
          setPo(data);
          if (data.poType === 'blanket') {
            api.purchaseOrders.releases(pid).then(setReleases).catch(() => {});
          }
          api.purchaseOrders.receivingSummary(pid).then(setReceivingLines).catch(() => {});
          api.purchaseOrders.complianceReport(pid).then(setComplianceReport).catch(() => {});
        })
        .catch(() => setPo(null))
        .finally(() => setLoading(false));
    });
  }, [params]);

  async function refresh() {
    const updated = await api.purchaseOrders.get(id);
    setPo(updated);
  }

  async function issuePO() {
    setActionError('');
    setActionLoading('issue');
    try {
      await api.purchaseOrders.issue(id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Issue failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function submitChangeOrder() {
    if (!changeReason.trim()) {
      setChangeError('Change reason is required.');
      return;
    }
    setChangeError('');
    setChangeSubmitting(true);
    try {
      await api.purchaseOrders.changeOrder(id, { changeReason: changeReason.trim() });
      setChangeDialogOpen(false);
      setChangeReason('');
      await refresh();
    } catch (err) {
      setChangeError(err instanceof Error ? err.message : 'Change order failed');
    } finally {
      setChangeSubmitting(false);
    }
  }

  async function submitRelease() {
    if (!releaseAmount || parseFloat(releaseAmount) <= 0) {
      setReleaseError('Enter a valid amount.');
      return;
    }
    setReleaseError('');
    setReleaseSubmitting(true);
    try {
      await api.purchaseOrders.createRelease(id, {
        amount: parseFloat(releaseAmount),
        description: releaseDesc || undefined,
      });
      setReleaseDialogOpen(false);
      setReleaseAmount('');
      setReleaseDesc('');
      const [updated, updatedReleases] = await Promise.all([
        api.purchaseOrders.get(id),
        api.purchaseOrders.releases(id),
      ]);
      setPo(updated);
      setReleases(updatedReleases);
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : 'Release creation failed');
    } finally {
      setReleaseSubmitting(false);
    }
  }

  async function cancelRelease(releaseId: string) {
    if (!window.confirm('Cancel this release?')) return;
    try {
      await api.purchaseOrders.cancelRelease(id, releaseId);
      const [updated, updatedReleases] = await Promise.all([
        api.purchaseOrders.get(id),
        api.purchaseOrders.releases(id),
      ]);
      setPo(updated);
      setReleases(updatedReleases);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Cancel release failed');
    }
  }

  async function cancelPO() {
    if (!window.confirm('Cancel this purchase order?')) return;
    setActionError('');
    setActionLoading('cancel');
    try {
      await api.purchaseOrders.cancel(id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function downloadPDF() {
    try {
      const res = await api.purchaseOrders.pdf(id);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${po?.number ?? 'purchase-order'}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'PDF download failed');
    }
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
          Loading purchase order...
        </div>
      </div>
    );
  }

  if (!po) {
    return (
      <div className="p-4 lg:p-8">
        <Alert variant="destructive">
          <AlertDescription>
            Purchase order not found.{' '}
            <Link href="/purchase-orders" className="underline underline-offset-4">
              Back to list
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const lines = po.lines ?? [];
  const versions = po.versions ?? [];
  const canIssue = po.status === 'draft' || po.status === 'approved';
  const canChangeOrder = po.status !== 'closed' && po.status !== 'cancelled';
  const canCancel = po.status !== 'closed' && po.status !== 'cancelled' && po.status !== 'received';
  const canReceive = ['approved', 'issued', 'partially_received'].includes(po.status);
  const isBlanket = po.poType === 'blanket';
  const canCreateRelease = isBlanket && ['issued', 'approved', 'partially_received'].includes(po.status);
  const blanketLimit = po.blanketTotalLimit ? parseFloat(po.blanketTotalLimit) : null;
  const blanketReleased = parseFloat(po.blanketReleasedAmount ?? '0');
  const blanketRemaining = blanketLimit !== null ? blanketLimit - blanketReleased : null;
  const blanketPct = blanketLimit && blanketLimit > 0 ? (blanketReleased / blanketLimit) * 100 : 0;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs items={[{ label: 'Purchase Orders', href: '/purchase-orders' }, { label: po.number }]} />

      <PageHeader
        title={po.number}
        description={po.vendor?.name ?? 'No vendor assigned'}
        actions={
          <div className="flex flex-wrap gap-3">
            <Badge variant={statusVariant(po.status) as any} className="capitalize">
              {po.status.replace(/_/g, ' ')}
            </Badge>
            <Badge variant="outline">V{po.version ?? 1}</Badge>
            {isBlanket ? <Badge variant="warning">Blanket PO</Badge> : null}
            <Button asChild variant="outline">
              <Link href="/purchase-orders">Back to Purchase Orders</Link>
            </Button>
          </div>
        }
      />

      {actionError ? (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total" value={formatCurrency(po.totalAmount, po.currency)} />
        <StatCard label="Created" value={new Date(po.createdAt).toLocaleDateString()} />
        <StatCard label="Issued" value={po.issuedAt ? new Date(po.issuedAt).toLocaleDateString() : '—'} />
      </div>

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">PO Summary</CardTitle>
          <CardDescription>Commercial terms, supplier reference, and header notes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="Vendor" value={po.vendor?.name ?? '—'} />
          <DetailField label="Payment Terms" value={po.paymentTerms ?? '—'} />
          <DetailField label="Currency" value={po.currency} />
          <DetailField label="Status" value={po.status.replace(/_/g, ' ')} />
          <DetailField label="Type" value={po.poType} />
          <DetailField label="Created" value={new Date(po.createdAt).toLocaleString()} />
          {po.notes ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <DetailField label="Notes" value={po.notes} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isBlanket ? (
        <Card className="rounded-[24px] border-amber-200/70 bg-amber-50/60">
          <CardHeader>
            <CardTitle className="text-xl">Blanket PO Summary</CardTitle>
            <CardDescription>Release utilization, term boundaries, and remaining spending room.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {po.blanketStartDate ? <DetailField label="Start Date" value={new Date(po.blanketStartDate).toLocaleDateString()} /> : null}
              {po.blanketEndDate ? <DetailField label="End Date" value={new Date(po.blanketEndDate).toLocaleDateString()} /> : null}
              {blanketLimit !== null ? <DetailField label="Total Limit" value={formatCurrency(blanketLimit, po.currency)} /> : null}
              <DetailField label="Released" value={formatCurrency(blanketReleased, po.currency)} />
              {blanketRemaining !== null ? <DetailField label="Remaining" value={formatCurrency(blanketRemaining, po.currency)} /> : null}
            </div>
            {blanketLimit !== null ? (
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-amber-200">
                  <div
                    className={`h-full rounded-full ${
                      blanketPct >= 100 ? 'bg-rose-600' : blanketPct >= 80 ? 'bg-amber-500' : 'bg-emerald-600'
                    }`}
                    style={{ width: `${Math.min(100, blanketPct)}%` }}
                  />
                </div>
                <div className="text-sm text-muted-foreground">{blanketPct.toFixed(1)}% utilized</div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Line Items</CardTitle>
          <CardDescription>Ordered quantities, pricing, and PO totals.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {lines.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
              No line items.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => {
                  const lineTotal = (Number(line.qty) || 0) * (Number(line.unitPrice) || 0);
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                      <TableCell className="text-foreground">{line.description}</TableCell>
                      <TableCell>{Number(line.qty)}</TableCell>
                      <TableCell>{line.uom}</TableCell>
                      <TableCell>{formatCurrency(line.unitPrice, po.currency)}</TableCell>
                      <TableCell className="font-medium text-foreground">{formatCurrency(lineTotal, po.currency)}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell colSpan={5} className="text-right font-semibold text-muted-foreground">
                    Total
                  </TableCell>
                  <TableCell className="font-semibold text-foreground">{formatCurrency(po.totalAmount, po.currency)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {complianceReport?.lines?.length ? (
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Contract Compliance</CardTitle>
            <CardDescription>
              {complianceReport.summary?.compliantLines ?? 0} of {complianceReport.summary?.totalLines ?? 0} lines compliant.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Contract Price</TableHead>
                  <TableHead>Delta</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {complianceReport.lines.map((line: any, index: number) => {
                  const st = line.contractComplianceStatus ?? 'no_contract';
                  const delta = line.contractComplianceDeltaPercent ? parseFloat(line.contractComplianceDeltaPercent) : null;
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="text-muted-foreground">{line.lineNumber ?? index + 1}</TableCell>
                      <TableCell>{line.description}</TableCell>
                      <TableCell>{line.unitPrice != null ? formatCurrency(line.unitPrice, po.currency) : '—'}</TableCell>
                      <TableCell>
                        {line.contractedUnitPrice != null ? formatCurrency(line.contractedUnitPrice, po.currency) : '—'}
                      </TableCell>
                      <TableCell className={delta != null && delta > 0 ? 'text-amber-700' : 'text-muted-foreground'}>
                        {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            st === 'compliant' ? 'success' : st === 'deviation' ? 'warning' : st === 'exempt' ? 'outline' : 'secondary'
                          }
                        >
                          {st.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {receivingLines.length > 0 ? (
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Receiving Progress</CardTitle>
            <CardDescription>Ordered, received, rejected, and outstanding quantities by line.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Ordered</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Rejected</TableHead>
                  <TableHead>Outstanding</TableHead>
                  <TableHead>Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receivingLines.map((line) => {
                  const pct = Math.min(100, parseFloat(line.receivedPct ?? '0'));
                  return (
                    <TableRow key={line.poLineId}>
                      <TableCell className="text-muted-foreground">{line.lineNumber}</TableCell>
                      <TableCell>{line.description}</TableCell>
                      <TableCell>{Number(line.orderedQty)} {line.uom}</TableCell>
                      <TableCell className="font-medium text-emerald-700">{Number(line.receivedQty)}</TableCell>
                      <TableCell className={parseFloat(line.rejectedQty) > 0 ? 'text-rose-700' : 'text-muted-foreground'}>
                        {Number(line.rejectedQty)}
                      </TableCell>
                      <TableCell className={parseFloat(line.outstandingQty) > 0 ? 'font-medium text-amber-700' : 'text-muted-foreground'}>
                        {Number(line.outstandingQty)}
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        <div className="flex items-center gap-3">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${
                                pct >= 100 ? 'bg-emerald-600' : pct >= 50 ? 'bg-sky-600' : 'bg-amber-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">{pct.toFixed(0)}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {isBlanket ? (
        <Card className="rounded-[24px]">
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-xl">Releases</CardTitle>
              <CardDescription>{releases.length} release{releases.length === 1 ? '' : 's'} against this blanket PO.</CardDescription>
            </div>
            {canCreateRelease ? (
              <Button type="button" onClick={() => setReleaseDialogOpen(true)}>
                New Release
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="pt-0">
            {releases.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
                No releases yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Release #</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {releases.map((release) => (
                    <TableRow key={release.id}>
                      <TableCell className="font-medium text-foreground">#{release.releaseNumber}</TableCell>
                      <TableCell>{formatCurrency(release.amount, po.currency)}</TableCell>
                      <TableCell>{release.description ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={release.status === 'approved' ? 'success' : release.status === 'cancelled' ? 'destructive' : 'secondary'}>
                          {release.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{new Date(release.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        {release.status !== 'cancelled' ? (
                          <Button size="sm" variant="destructive" onClick={() => cancelRelease(release.id)}>
                            Cancel
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {versions.length > 0 ? (
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Version History</CardTitle>
            <CardDescription>Change-order history and revision trail for this purchase order.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Change Reason</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((version) => (
                  <TableRow key={version.id}>
                    <TableCell className="font-medium text-foreground">V{version.version}</TableCell>
                    <TableCell>{version.changeReason ?? 'Initial version'}</TableCell>
                    <TableCell>{new Date(version.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {canIssue ? (
          <Button type="button" onClick={issuePO} disabled={actionLoading !== null}>
            {actionLoading === 'issue' ? 'Issuing...' : 'Issue PO'}
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={downloadPDF}>
          Download PDF
        </Button>
        {canReceive ? (
          <Button asChild>
            <Link href={`/receiving/new?poId=${id}`}>Create GRN</Link>
          </Button>
        ) : null}
        {canChangeOrder ? (
          <Button type="button" variant="outline" onClick={() => setChangeDialogOpen(true)}>
            Change Order
          </Button>
        ) : null}
        {canCancel ? (
          <Button type="button" variant="destructive" onClick={cancelPO} disabled={actionLoading !== null}>
            {actionLoading === 'cancel' ? 'Cancelling...' : 'Cancel PO'}
          </Button>
        ) : null}
      </div>

      {changeDialogOpen ? (
        <ModalShell onClose={() => setChangeDialogOpen(false)}>
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Create Change Order</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Describe the reason for this change order. A new version of the PO will be created.
              </p>
            </div>
            <Field label="Change Reason">
              <Textarea
                value={changeReason}
                onChange={(event) => setChangeReason(event.target.value)}
                rows={4}
                placeholder="Updated pricing agreed with vendor"
              />
            </Field>
            {changeError ? (
              <Alert variant="destructive">
                <AlertDescription>{changeError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setChangeDialogOpen(false);
                  setChangeReason('');
                  setChangeError('');
                }}
              >
                Cancel
              </Button>
              <Button type="button" onClick={submitChangeOrder} disabled={changeSubmitting}>
                {changeSubmitting ? 'Submitting...' : 'Submit Change Order'}
              </Button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {releaseDialogOpen ? (
        <ModalShell
          onClose={() => {
            setReleaseDialogOpen(false);
            setReleaseAmount('');
            setReleaseDesc('');
            setReleaseError('');
          }}
        >
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">New Blanket Release</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Release funds against this blanket PO.
                {blanketRemaining !== null ? ` Remaining: ${formatCurrency(blanketRemaining, po.currency)}` : ''}
              </p>
            </div>
            <Field label={`Amount (${po.currency})`}>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={releaseAmount}
                onChange={(event) => setReleaseAmount(event.target.value)}
                placeholder="0.00"
              />
            </Field>
            <Field label="Description">
              <Input
                value={releaseDesc}
                onChange={(event) => setReleaseDesc(event.target.value)}
                placeholder="Q1 office supplies"
              />
            </Field>
            {releaseError ? (
              <Alert variant="destructive">
                <AlertDescription>{releaseError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setReleaseDialogOpen(false);
                  setReleaseAmount('');
                  setReleaseDesc('');
                  setReleaseError('');
                }}
              >
                Cancel
              </Button>
              <Button type="button" onClick={submitRelease} disabled={releaseSubmitting}>
                {releaseSubmitting ? 'Creating...' : 'Create Release'}
              </Button>
            </div>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-[24px] border-border/70 bg-card/95">
      <CardContent className="p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className="mt-2 font-display text-3xl font-semibold tracking-[-0.04em] text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-[24px] border border-border/70 bg-background p-6 shadow-[0_30px_100px_-40px_rgba(15,23,42,0.6)]">
        {children}
      </div>
    </div>
  );
}
