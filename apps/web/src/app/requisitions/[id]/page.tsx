'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { Select } from '../../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { Textarea } from '../../../components/ui/textarea';

interface RequisitionLine {
  id: string;
  description: string;
  qty: string | number;
  uom: string;
  unitPrice: string | number;
}

interface Requisition {
  id: string;
  number: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  currency: string;
  totalAmount: string | null;
  neededBy: string | null;
  createdAt: string;
  lines: RequisitionLine[];
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  converted: 'Converted',
};

function statusVariant(status: string) {
  if (status === 'approved') return 'success';
  if (status === 'pending_approval') return 'warning';
  if (status === 'rejected') return 'destructive';
  if (status === 'converted') return 'outline';
  return 'secondary';
}

function formatCurrency(amount: string | number | null, currency = 'USD') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

export default function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState('');
  const [req, setReq] = useState<Requisition | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [poDialogOpen, setPoDialogOpen] = useState(false);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [poVendorId, setPoVendorId] = useState('');
  const [poPaymentTerms, setPoPaymentTerms] = useState('');
  const [poSubmitting, setPoSubmitting] = useState(false);
  const [poError, setPoError] = useState('');
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [templateOrgWide, setTemplateOrgWide] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [templateSuccess, setTemplateSuccess] = useState(false);

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.requisitions
        .get(pid)
        .then((data) => setReq(data))
        .catch(() => setReq(null))
        .finally(() => setLoading(false));
    });
  }, [params]);

  async function openPoDialog() {
    if (vendors.length === 0) {
      const data = await api.vendors.list().catch(() => []);
      setVendors(data as any[]);
      if ((data as any[]).length > 0) setPoVendorId((data as any[])[0].id);
    }
    setPoDialogOpen(true);
  }

  async function submitCreatePO() {
    if (!poVendorId || !req) {
      setPoError('Select a vendor.');
      return;
    }
    setPoError('');
    setPoSubmitting(true);
    try {
      const lines = (req.lines ?? []).map((line) => ({
        description: line.description,
        quantity: Number(line.qty) || 1,
        unitOfMeasure: line.uom || 'each',
        unitPrice: Number(line.unitPrice) || 0,
        requisitionLineId: line.id,
      }));
      const po = (await api.purchaseOrders.create({
        vendorId: poVendorId,
        requisitionId: req.id,
        paymentTerms: poPaymentTerms || undefined,
        currency: req.currency,
        lines,
      })) as any;
      router.push(`/purchase-orders/${po.id}`);
    } catch (err) {
      setPoError(err instanceof Error ? err.message : 'PO creation failed');
    } finally {
      setPoSubmitting(false);
    }
  }

  async function saveAsTemplate() {
    if (!templateName.trim()) {
      setTemplateError('Name is required');
      return;
    }
    setTemplateError('');
    setTemplateSaving(true);
    try {
      await api.requisitionTemplates.createFromRequisition(id, {
        name: templateName,
        description: templateDesc || undefined,
        isOrgWide: templateOrgWide,
      });
      setTemplateSuccess(true);
      setSaveTemplateOpen(false);
      setTemplateName('');
      setTemplateDesc('');
      setTemplateOrgWide(false);
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setTemplateSaving(false);
    }
  }

  async function doAction(action: 'submit' | 'cancel') {
    setError('');
    setActionLoading(action);
    try {
      if (action === 'submit') await api.requisitions.submit(id);
      else await api.requisitions.cancel(id);
      const updated = await api.requisitions.get(id);
      setReq(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
          Loading requisition...
        </div>
      </div>
    );
  }

  if (!req) {
    return (
      <div className="p-4 lg:p-8">
        <Alert variant="destructive">
          <AlertDescription>
            Requisition not found.{' '}
            <Link href="/requisitions" className="underline underline-offset-4">
              Back to list
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const lines = req.lines ?? [];

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs items={[{ label: 'Requisitions', href: '/requisitions' }, { label: req.number }]} />

      <PageHeader
        title={req.number}
        description={req.title}
        actions={
          <div className="flex flex-wrap gap-3">
            <Badge variant={statusVariant(req.status) as any}>
              {STATUS_LABELS[req.status] ?? req.status}
            </Badge>
            <Button asChild variant="outline">
              <Link href="/requisitions">Back to Requisitions</Link>
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {templateSuccess ? (
        <Alert variant="success">
          <AlertDescription>
            Template saved.{' '}
            <Link href="/requisitions/templates" className="underline underline-offset-4">
              View templates
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total" value={formatCurrency(req.totalAmount, req.currency)} />
        <StatCard label="Priority" value={req.priority.charAt(0).toUpperCase() + req.priority.slice(1)} />
        <StatCard label="Needed By" value={req.neededBy ? new Date(req.neededBy).toLocaleDateString() : '—'} />
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl">Request Summary</CardTitle>
          <CardDescription>Request metadata, narrative context, and timing.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="Title" value={req.title} />
          <DetailField label="Status" value={STATUS_LABELS[req.status] ?? req.status} />
          <DetailField label="Created" value={new Date(req.createdAt).toLocaleDateString()} />
          <DetailField label="Currency" value={req.currency} />
          <DetailField label="Line Count" value={String(lines.length)} />
          <DetailField label="Needed By" value={req.neededBy ? new Date(req.neededBy).toLocaleDateString() : '—'} />
          {req.description ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <DetailField label="Description" value={req.description} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl">Line Items</CardTitle>
          <CardDescription>Requested quantities, units, and estimated pricing.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {lines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
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
                      <TableCell className="font-medium text-foreground">{line.description}</TableCell>
                      <TableCell>{Number(line.qty)}</TableCell>
                      <TableCell>{line.uom}</TableCell>
                      <TableCell>{formatCurrency(line.unitPrice, req.currency)}</TableCell>
                      <TableCell className="font-medium text-foreground">
                        {formatCurrency(lineTotal, req.currency)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell colSpan={5} className="text-right font-semibold text-muted-foreground">
                    Total
                  </TableCell>
                  <TableCell className="font-semibold text-foreground">
                    {formatCurrency(req.totalAmount, req.currency)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        {req.status === 'draft' ? (
          <Button type="button" onClick={() => doAction('submit')} disabled={actionLoading !== null}>
            {actionLoading === 'submit' ? 'Submitting...' : 'Submit for Approval'}
          </Button>
        ) : null}

        {req.status === 'approved' ? (
          <Button type="button" onClick={openPoDialog}>
            Create Purchase Order
          </Button>
        ) : null}

        {req.status === 'draft' || req.status === 'pending_approval' ? (
          <Button type="button" variant="destructive" onClick={() => doAction('cancel')} disabled={actionLoading !== null}>
            {actionLoading === 'cancel' ? 'Cancelling...' : 'Cancel Requisition'}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSaveTemplateOpen(true);
            setTemplateError('');
            setTemplateSuccess(false);
          }}
        >
          Save as Template
        </Button>
      </div>

      {saveTemplateOpen ? (
        <ModalShell onClose={() => setSaveTemplateOpen(false)}>
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Save as Template</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Save this requisition as a reusable template to pre-fill future requests.
              </p>
            </div>
            <Field label="Template Name">
              <Input
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="Monthly Office Supplies"
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={templateDesc}
                onChange={(event) => setTemplateDesc(event.target.value)}
                rows={3}
                placeholder="Optional description"
              />
            </Field>
            <label className="inline-flex items-center gap-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={templateOrgWide}
                onChange={(event) => setTemplateOrgWide(event.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
              />
              Make available to all org members
            </label>
            {templateError ? (
              <Alert variant="destructive">
                <AlertDescription>{templateError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setSaveTemplateOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={saveAsTemplate} disabled={templateSaving}>
                {templateSaving ? 'Saving...' : 'Save Template'}
              </Button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {poDialogOpen ? (
        <ModalShell
          onClose={() => {
            setPoDialogOpen(false);
            setPoError('');
          }}
        >
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Create Purchase Order</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Select a vendor to create a PO from {req.number}. All {req.lines?.length ?? 0} line items will be included.
              </p>
            </div>
            <Field label="Vendor">
              <Select value={poVendorId} onChange={(event) => setPoVendorId(event.target.value)} className="w-full">
                <option value="">Select vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Payment Terms">
              <Input
                value={poPaymentTerms}
                onChange={(event) => setPoPaymentTerms(event.target.value)}
                placeholder="Net 30"
              />
            </Field>
            {poError ? (
              <Alert variant="destructive">
                <AlertDescription>{poError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPoDialogOpen(false);
                  setPoError('');
                }}
              >
                Cancel
              </Button>
              <Button type="button" onClick={submitCreatePO} disabled={poSubmitting || !poVendorId}>
                {poSubmitting ? 'Creating...' : 'Create PO'}
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
    <div className="rounded-lg border border-border/70 bg-background/70 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-lg border-border/70 bg-card/95">
      <CardContent className="p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">{value}</div>
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
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
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
      <div className="w-full max-w-xl rounded-lg border border-border/70 bg-background p-6 shadow-[0_30px_100px_-40px_rgba(15,23,42,0.6)]">
        {children}
      </div>
    </div>
  );
}
