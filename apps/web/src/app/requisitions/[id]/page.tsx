'use client';

import { use, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import Breadcrumbs from '../../../components/breadcrumbs';
import { DetailActionMenu } from '../../../components/detail-action-menu';
import { LifecycleStrip } from '../../../components/lifecycle-strip';
import { PageHeader } from '../../../components/page-header';
import { RelatedRecords } from '../../../components/related-records';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { Textarea } from '../../../components/ui/textarea';
import { restoreFocus } from '../../../lib/accessibility';

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
  activeApproval?: { id: string; currentStep: number; status: string } | null;
  purchaseOrders?: { id: string; number: string; status: string }[];
  commitmentEvents?: {
    id: string;
    budgetId: string;
    budget?: { id: string; name: string } | null;
  }[];
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

export default function RequisitionDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
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
  const poDialogTriggerRef = useRef<HTMLButtonElement>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [templateOrgWide, setTemplateOrgWide] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [templateSuccess, setTemplateSuccess] = useState(false);
  const templateDialogTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api.requisitions
      .get(id)
      .then((data) => setReq(data))
      .catch(() => setReq(null))
      .finally(() => setLoading(false));
  }, [id]);

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
  const request = {
    kind: 'requisition' as const,
    id: req.id,
    label: req.number,
    relation: 'Request',
  };
  const approval = req.activeApproval
    ? {
        kind: 'approval_request' as const,
        id: req.activeApproval.id,
        label: `Step ${req.activeApproval.currentStep}`,
        relation: 'Approval',
      }
    : null;
  const purchaseOrders = (req.purchaseOrders ?? []).map((purchaseOrder) => ({
    kind: 'purchase_order' as const,
    id: purchaseOrder.id,
    label: purchaseOrder.number,
    relation: 'Purchase order',
  }));
  const budgets = (req.commitmentEvents ?? []).flatMap((event) =>
    event.budget
      ? [
          {
            kind: 'budget' as const,
            id: event.budget.id,
            label: event.budget.name,
            relation: 'Budget',
          },
        ]
      : [],
  );
  const lifecycleRecords = [request, ...(approval ? [approval] : []), ...purchaseOrders];
  const relatedRecords = [...budgets];
  const showApprovalAsPrimary = Boolean(approval);
  const canSubmit = !showApprovalAsPrimary && req.status === 'draft';
  const canCreatePurchaseOrder = !showApprovalAsPrimary && req.status === 'approved';
  const canCancel = req.status === 'draft' || req.status === 'pending_approval';

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs
        items={[{ label: 'Requisitions', href: '/requisitions' }, { label: req.number }]}
      />

      <PageHeader
        title={req.number}
        description={req.title}
        className="sticky top-28 z-20 -mx-4 bg-background px-4 py-4 min-[520px]:top-[4.5rem] lg:-mx-8 lg:px-8"
        actions={
          <div className="flex flex-wrap gap-3">
            <Badge variant={statusVariant(req.status) as any}>
              {STATUS_LABELS[req.status] ?? req.status}
            </Badge>
            {showApprovalAsPrimary ? (
              <Button asChild>
                <Link href={`/approvals/${approval?.id}`}>Review approval</Link>
              </Button>
            ) : null}
            {canSubmit ? (
              <Button
                type="button"
                onClick={() => doAction('submit')}
                disabled={actionLoading !== null}
              >
                {actionLoading === 'submit' ? 'Submitting...' : 'Submit for Approval'}
              </Button>
            ) : null}
            {canCreatePurchaseOrder ? (
              <Button type="button" ref={poDialogTriggerRef} onClick={openPoDialog}>
                Create Purchase Order
              </Button>
            ) : null}
            <DetailActionMenu
              secondary={
                <Button
                  type="button"
                  variant="outline"
                  className="justify-start"
                  ref={templateDialogTriggerRef}
                  onClick={() => {
                    setSaveTemplateOpen(true);
                    setTemplateError('');
                    setTemplateSuccess(false);
                  }}
                >
                  Save as Template
                </Button>
              }
              destructive={
                canCancel ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="justify-start"
                    onClick={() => doAction('cancel')}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === 'cancel' ? 'Cancelling...' : 'Cancel Requisition'}
                  </Button>
                ) : null
              }
            />
          </div>
        }
      />

      <LifecycleStrip records={lifecycleRecords} current={{ kind: 'requisition', id: req.id }} />
      <RelatedRecords records={relatedRecords} />

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
        <StatCard
          label="Priority"
          value={req.priority.charAt(0).toUpperCase() + req.priority.slice(1)}
        />
        <StatCard
          label="Needed By"
          value={req.neededBy ? new Date(req.neededBy).toLocaleDateString() : '—'}
        />
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
          <DetailField
            label="Needed By"
            value={req.neededBy ? new Date(req.neededBy).toLocaleDateString() : '—'}
          />
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
                      <TableCell className="font-medium text-foreground">
                        {line.description}
                      </TableCell>
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

      <Dialog
        open={saveTemplateOpen}
        onOpenChange={(open) => {
          setSaveTemplateOpen(open);
          if (!open) setTemplateError('');
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus(templateDialogTriggerRef.current);
          }}
        >
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
            <DialogDescription>
              Save this requisition as a reusable template to pre-fill future requests.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field id="template-name" label="Template Name">
              <Input
                id="template-name"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="Monthly Office Supplies"
              />
            </Field>
            <Field id="template-description" label="Description">
              <Textarea
                id="template-description"
                value={templateDesc}
                onChange={(event) => setTemplateDesc(event.target.value)}
                rows={3}
                placeholder="Optional description"
              />
            </Field>
            <div>
              <input
                id="template-org-wide"
                type="checkbox"
                checked={templateOrgWide}
                onChange={(event) => setTemplateOrgWide(event.target.checked)}
                className="mr-3 h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
              />
              <label htmlFor="template-org-wide" className="text-sm text-muted-foreground">
                Make available to all org members
              </label>
            </div>
            {templateError ? (
              <Alert variant="destructive">
                <AlertDescription>{templateError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveTemplateOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveAsTemplate} disabled={templateSaving}>
              {templateSaving ? 'Saving...' : 'Save Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={poDialogOpen}
        onOpenChange={(open) => {
          setPoDialogOpen(open);
          if (!open) setPoError('');
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus(poDialogTriggerRef.current);
          }}
        >
          <DialogHeader>
            <DialogTitle>Create Purchase Order</DialogTitle>
            <DialogDescription>
              Select a vendor to create a PO from {req.number}. All {req.lines?.length ?? 0} line
              items will be included.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field id="po-vendor" label="Vendor">
              <Select
                id="po-vendor"
                value={poVendorId}
                onChange={(event) => setPoVendorId(event.target.value)}
                className="w-full"
              >
                <option value="">Select vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="po-payment-terms" label="Payment Terms">
              <Input
                id="po-payment-terms"
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
          </div>
          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/70 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-lg border-border/70 bg-card/95">
      <CardContent className="p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
