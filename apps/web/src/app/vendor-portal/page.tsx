'use client';

import { Suspense, type ChangeEvent, type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ClipboardCheck,
  CreditCard,
  FileSpreadsheet,
  LoaderCircle,
  ReceiptText,
  Send,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Textarea } from '../../components/ui/textarea';

type PortalTab = 'overview' | 'pos' | 'invoices' | 'onboarding' | 'catalog';

interface InvoiceLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unitPrice: number;
  poLineId?: string;
}

interface VendorPortalStats {
  totalPOs: number;
  totalInvoiced: number;
  pendingPayment: number;
}

interface VendorPortalData {
  vendor: any;
  purchaseOrders: any[];
  invoices: any[];
  stats: VendorPortalStats;
}

const EMPTY_INVOICE_LINE: InvoiceLine = {
  lineNumber: 1,
  description: '',
  quantity: 1,
  unitPrice: 0,
};

function fmt(amount: number | string | null | undefined, currency = 'USD') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function PortalShell({
  children,
  vendorName,
  onSubmitInvoice,
}: {
  children: ReactNode;
  vendorName?: string;
  onSubmitInvoice?: () => void;
}) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.12),_transparent_32%),linear-gradient(180deg,#f8fafc_0%,#eef4ff_100%)]">
      <div className="border-b border-slate-900/10 bg-slate-950 text-slate-50 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.75)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-200/80">
              Vendor Portal
            </div>
            <div className="text-3xl font-semibold tracking-[-0.04em]">
              {vendorName ?? 'BetterSpend Supplier Access'}
            </div>
          </div>
          {onSubmitInvoice ? (
            <Button type="button" onClick={onSubmitInvoice} className="gap-2 bg-sky-500 text-white hover:bg-sky-400">
              <ReceiptText className="h-4 w-4" />
              Submit Invoice
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">{children}</div>
    </div>
  );
}

function EmptyPortalState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <PortalShell>
      <div className="flex min-h-[70vh] items-center justify-center">
        <Card className="w-full max-w-xl rounded-[32px] border-border/70 bg-card/95 shadow-[0_32px_100px_-56px_rgba(15,23,42,0.6)]">
          <CardContent className="flex flex-col items-center gap-5 px-8 py-14 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-sky-50 text-sky-700">
              {icon}
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{title}</h1>
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  );
}

function VendorStatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <Card className="rounded-lg border-border/70 bg-card/90">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn('flex h-12 w-12 items-center justify-center rounded-lg', tone)}>{icon}</div>
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold tracking-[-0.03em] text-foreground">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function SubmitInvoiceModal({
  token,
  purchaseOrders,
  onClose,
  onSuccess,
}: {
  token: string;
  purchaseOrders: any[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedPoId, setSelectedPoId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<InvoiceLine[]>([{ ...EMPTY_INVOICE_LINE }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const issuedPOs = purchaseOrders.filter(
    (po: any) => po.status === 'issued' || po.status === 'partially_received' || po.status === 'received',
  );

  function addLine() {
    setLines((current) => [
      ...current,
      { lineNumber: current.length + 1, description: '', quantity: 1, unitPrice: 0 },
    ]);
  }

  function removeLine(index: number) {
    setLines((current) =>
      current.filter((_, lineIndex) => lineIndex !== index).map((line, lineIndex) => ({
        ...line,
        lineNumber: lineIndex + 1,
      })),
    );
  }

  function updateLine(index: number, field: keyof InvoiceLine, value: string | number) {
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, [field]: value } : line)),
    );
  }

  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedPoId) {
      setError('Please select a purchase order.');
      return;
    }
    if (!invoiceNumber.trim()) {
      setError('Invoice number is required.');
      return;
    }
    if (lines.some((line) => !line.description.trim())) {
      setError('All line items need a description.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await api.vendorPortal.submitInvoice(token, {
        purchaseOrderId: selectedPoId,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        dueDate: dueDate || undefined,
        lines: lines.map((line) => ({
          lineNumber: line.lineNumber,
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
        })),
      });
      onSuccess();
    } catch (submissionError: any) {
      setError(submissionError.message || 'Failed to submit invoice.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-10"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-[32px] border border-border/70 bg-card p-6 shadow-[0_32px_100px_-56px_rgba(15,23,42,0.7)] md:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">
              Submit Invoice
            </h2>
            <p className="text-sm text-muted-foreground">
              Invoice against an issued PO and send the line-level detail directly into matching.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close modal">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-6">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-base">Invoice details</CardTitle>
              <CardDescription>Choose the PO and provide your reference numbers and dates.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Field
                  label="Purchase Order"
                  hint={issuedPOs.length === 0 ? 'No issued purchase orders are currently available to invoice against.' : undefined}
                >
                  <Select required value={selectedPoId} onChange={(event) => setSelectedPoId(event.target.value)}>
                    <option value="">Select a PO...</option>
                    {issuedPOs.map((po: any) => (
                      <option key={po.id} value={po.id}>
                        {po.internalNumber} - {fmt(po.totalAmount, po.currency)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Your Invoice Number">
                <Input
                  required
                  value={invoiceNumber}
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                  placeholder="INV-001"
                />
              </Field>
              <Field label="Invoice Date">
                <Input required type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
              </Field>
              <Field label="Due Date">
                <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </Field>
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Line items</CardTitle>
                <CardDescription>Line details will be used during match and exception handling.</CardDescription>
              </div>
              <Button type="button" variant="outline" onClick={addLine}>
                Add Line
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              {lines.map((line, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-[22px] border border-border/70 bg-background/70 p-4 md:grid-cols-[2.4fr_0.8fr_1fr_auto]"
                >
                  <Field label={`Line ${line.lineNumber}`}>
                    <Input
                      required
                      value={line.description}
                      onChange={(event) => updateLine(index, 'description', event.target.value)}
                      placeholder="Description"
                    />
                  </Field>
                  <Field label="Qty">
                    <Input
                      required
                      type="number"
                      min="0.001"
                      step="any"
                      value={line.quantity}
                      onChange={(event) => updateLine(index, 'quantity', parseFloat(event.target.value) || 0)}
                    />
                  </Field>
                  <Field label="Unit Price">
                    <Input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(event) => updateLine(index, 'unitPrice', parseFloat(event.target.value) || 0)}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="border-rose-200 text-rose-700 hover:bg-rose-50"
                      disabled={lines.length === 1}
                      onClick={() => removeLine(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex justify-end rounded-lg bg-muted/30 px-4 py-3 text-sm font-semibold text-foreground">
                Total: {fmt(total)}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || issuedPOs.length === 0} className="gap-2">
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? 'Submitting...' : 'Submit Invoice'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function VendorPortalContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<VendorPortalData | null>(null);
  const [activeTab, setActiveTab] = useState<PortalTab>('overview');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [catalogData, setCatalogData] = useState<{ items: any[]; proposals: any[] } | null>(null);
  const [onboardingData, setOnboardingData] = useState<any>(null);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingMessage, setOnboardingMessage] = useState('');
  const [onboardingForm, setOnboardingForm] = useState<any>({
    companyInfo: { legalName: '', taxId: '' },
    responses: {},
    documentLinks: { w9: '', coi: '', banking: '' },
    bankingDetails: { accountName: '', lastFour: '' },
  });
  const [proposalForm, setProposalForm] = useState({
    itemId: '',
    proposedPrice: '',
    effectiveDate: '',
    note: '',
  });
  const [proposalSaving, setProposalSaving] = useState(false);
  const [bulkUploadMessage, setBulkUploadMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api.vendorPortal
      .dashboard(token)
      .then((result) => setData(result as VendorPortalData))
      .catch((dashboardError) => setError(dashboardError.message || 'Failed to load portal data.'))
      .finally(() => setLoading(false));

    api.vendorPortal.catalog(token).then(setCatalogData).catch(() => {});
    api.vendorPortal
      .onboarding(token)
      .then((result) => {
        setOnboardingData(result);
        if (result?.latestSubmission) {
          setOnboardingForm({
            companyInfo: result.latestSubmission.companyInfo ?? { legalName: '', taxId: '' },
            responses: result.latestSubmission.responses ?? {},
            documentLinks: result.latestSubmission.documentLinks ?? { w9: '', coi: '', banking: '' },
            bankingDetails: result.latestSubmission.bankingDetails ?? { accountName: '', lastFour: '' },
          });
        }
      })
      .catch(() => {});
  }, [token, submitSuccess]);

  async function reloadDashboard() {
    if (!token) return;
    setLoading(true);
    try {
      const result = await api.vendorPortal.dashboard(token);
      setData(result as VendorPortalData);
    } catch (dashboardError: any) {
      setError(dashboardError.message || 'Failed to load portal data.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <EmptyPortalState
        icon={<ShieldCheck className="h-10 w-10" />}
        title="Vendor Portal Access Required"
        description="Use the secure access link sent by your buyer. If your link expired, contact the buyer and request a fresh portal token."
      />
    );
  }

  if (loading) {
    return (
      <PortalShell vendorName="Loading portal">
        <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
          <div className="flex items-center gap-3 rounded-full border border-border/70 bg-card/80 px-5 py-3 text-sm">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Loading vendor portal...
          </div>
        </div>
      </PortalShell>
    );
  }

  if (error) {
    return (
      <EmptyPortalState
        icon={<ShieldCheck className="h-10 w-10" />}
        title="Access Denied"
        description={`${error}. Please contact your buyer for a new access link.`}
      />
    );
  }

  if (!data) return null;

  const { vendor, purchaseOrders, invoices: invoiceList, stats } = data;
  const vendorContact = (vendor.contactInfo as Record<string, string | undefined> | null) ?? {};

  const tabs: Array<{ key: PortalTab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'pos', label: `Purchase Orders (${purchaseOrders.length})` },
    { key: 'invoices', label: `Invoices (${invoiceList.length})` },
    { key: 'onboarding', label: 'Onboarding' },
    { key: 'catalog', label: `Catalog & Pricing (${catalogData?.items.length ?? 0})` },
  ];

  async function submitPriceProposal(event: FormEvent) {
    event.preventDefault();
    setProposalSaving(true);
    setError('');
    setBulkUploadMessage('');
    try {
      await api.vendorPortal.submitPriceProposal(token, {
        itemId: proposalForm.itemId,
        proposedPrice: parseFloat(proposalForm.proposedPrice),
        effectiveDate: proposalForm.effectiveDate
          ? new Date(proposalForm.effectiveDate).toISOString()
          : undefined,
        note: proposalForm.note || undefined,
      });
      setProposalForm({ itemId: '', proposedPrice: '', effectiveDate: '', note: '' });
      setCatalogData(await api.vendorPortal.catalog(token));
    } catch (proposalError: any) {
      setError(proposalError.message || 'Failed to submit price proposal.');
    } finally {
      setProposalSaving(false);
    }
  }

  async function handleBulkCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setProposalSaving(true);
    setError('');
    setBulkUploadMessage('');
    try {
      const raw = await file.text();
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        throw new Error('CSV must include a header row and at least one data row.');
      }

      const headers = parseCsvLine(lines[0]).map((value) => value.toLowerCase());
      const rows = lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
        const proposedPrice = Number(row.proposedprice ?? row.proposed_price ?? '');
        if (!Number.isFinite(proposedPrice)) {
          throw new Error(`Invalid proposed price in row: ${line}`);
        }

        return {
          itemId: row.itemid || row.item_id || undefined,
          sku: row.sku || undefined,
          proposedPrice,
          effectiveDate: row.effectivedate || row.effective_date || undefined,
          note: row.note || undefined,
        };
      });

      const result = await api.vendorPortal.submitBulkPriceProposals(token, rows);
      setCatalogData(await api.vendorPortal.catalog(token));
      setBulkUploadMessage(`${result.createdCount} proposal(s) created, ${result.errorCount} error(s).`);
    } catch (uploadError: any) {
      setError(uploadError.message || 'Failed to import CSV proposals.');
    } finally {
      event.target.value = '';
      setProposalSaving(false);
    }
  }

  async function saveOnboarding(submit: boolean) {
    if (!token || !onboardingData?.questionnaire) return;
    setOnboardingSaving(true);
    setOnboardingMessage('');
    setError('');
    try {
      await api.vendorPortal.submitOnboarding(token, {
        questionnaireId: onboardingData.questionnaire.id,
        companyInfo: onboardingForm.companyInfo,
        responses: onboardingForm.responses,
        documentLinks: onboardingForm.documentLinks,
        bankingDetails: onboardingForm.bankingDetails,
        submit,
      });
      const refreshed = await api.vendorPortal.onboarding(token);
      setOnboardingData(refreshed);
      setOnboardingMessage(submit ? 'Onboarding submitted for buyer review.' : 'Draft saved.');
    } catch (saveError: any) {
      setError(saveError.message || 'Failed to save onboarding.');
    } finally {
      setOnboardingSaving(false);
    }
  }

  return (
    <PortalShell vendorName={vendor.name} onSubmitInvoice={() => setShowInvoiceModal(true)}>
      <div className="space-y-6">
        {submitSuccess ? (
          <Alert variant="success">
            <AlertDescription>
              Invoice submitted successfully. It will be matched against your purchase order.
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2 rounded-[26px] border border-border/70 bg-card/70 p-2 shadow-[0_18px_60px_-38px_rgba(15,23,42,0.35)]">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'bg-slate-950 text-slate-50 shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' ? (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <VendorStatCard
                icon={<ClipboardCheck className="h-5 w-5" />}
                label="Total Purchase Orders"
                value={String(stats.totalPOs)}
                tone="bg-sky-50 text-sky-700"
              />
              <VendorStatCard
                icon={<ReceiptText className="h-5 w-5" />}
                label="Total Invoiced"
                value={fmt(stats.totalInvoiced)}
                tone="bg-emerald-50 text-emerald-700"
              />
              <VendorStatCard
                icon={<CreditCard className="h-5 w-5" />}
                label="Pending Payment"
                value={fmt(stats.pendingPayment)}
                tone="bg-amber-50 text-amber-700"
              />
            </div>

            <Card className="rounded-[28px]">
              <CardHeader>
                <CardTitle className="text-xl">Your account</CardTitle>
                <CardDescription>Reference details your buyer is using for PO and invoice operations.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {vendor.taxId ? (
                  <Field label="Tax ID">
                    <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm text-foreground">
                      {vendor.taxId}
                    </div>
                  </Field>
                ) : null}
                {vendor.paymentTerms ? (
                  <Field label="Payment Terms">
                    <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm text-foreground">
                      {vendor.paymentTerms}
                    </div>
                  </Field>
                ) : null}
                {vendorContact.email ? (
                  <Field label="Contact Email">
                    <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm text-foreground">
                      {vendorContact.email}
                    </div>
                  </Field>
                ) : null}
                {vendorContact.phone ? (
                  <Field label="Phone">
                    <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm text-foreground">
                      {vendorContact.phone}
                    </div>
                  </Field>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {activeTab === 'pos' ? (
          <Card className="overflow-hidden rounded-[28px]">
            <CardHeader>
              <CardTitle className="text-xl">Purchase orders</CardTitle>
              <CardDescription>Orders issued to your company, including received and partially received work.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {purchaseOrders.length === 0 ? (
                <div className="px-6 py-14 text-center text-sm text-muted-foreground">
                  No purchase orders found.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>PO Number</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Issued Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchaseOrders.map((po: any) => (
                      <TableRow key={po.id}>
                        <TableCell className="font-semibold text-foreground">{po.internalNumber}</TableCell>
                        <TableCell>
                          <StatusBadge value={po.status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{fmt(po.totalAmount, po.currency)}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(po.issuedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : null}

        {activeTab === 'invoices' ? (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button type="button" onClick={() => setShowInvoiceModal(true)} className="gap-2">
                <ReceiptText className="h-4 w-4" />
                Submit New Invoice
              </Button>
            </div>
            <Card className="overflow-hidden rounded-[28px]">
              <CardHeader>
                <CardTitle className="text-xl">Invoice submissions</CardTitle>
                <CardDescription>Track invoice intake, match status, and buyer-side processing.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {invoiceList.length === 0 ? (
                  <div className="px-6 py-14 text-center text-sm text-muted-foreground">
                    No invoices submitted yet.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Your Ref</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Match</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoiceList.map((invoice: any) => (
                        <TableRow key={invoice.id}>
                          <TableCell className="font-semibold text-foreground">{invoice.internalNumber}</TableCell>
                          <TableCell className="text-muted-foreground">{invoice.invoiceNumber}</TableCell>
                          <TableCell>
                            <StatusBadge value={invoice.status} />
                          </TableCell>
                          <TableCell>
                            {invoice.matchStatus ? (
                              <StatusBadge value={invoice.matchStatus} />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {fmt(invoice.totalAmount, invoice.currency)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{fmtDate(invoice.invoiceDate)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {activeTab === 'onboarding' ? (
          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="rounded-[28px]">
              <CardHeader>
                <CardTitle className="text-xl">Supplier onboarding questionnaire</CardTitle>
                <CardDescription>
                  Complete the current questionnaire and keep document links and banking support current.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <Field label="Legal company name">
                  <Input
                    value={onboardingForm.companyInfo.legalName ?? ''}
                    onChange={(event) =>
                      setOnboardingForm((current: any) => ({
                        ...current,
                        companyInfo: { ...current.companyInfo, legalName: event.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Tax ID / registration number">
                  <Input
                    value={onboardingForm.companyInfo.taxId ?? ''}
                    onChange={(event) =>
                      setOnboardingForm((current: any) => ({
                        ...current,
                        companyInfo: { ...current.companyInfo, taxId: event.target.value },
                      }))
                    }
                  />
                </Field>
                {(onboardingData?.questionnaire?.questions ?? []).map((question: any) => (
                  <Field key={question.id} label={`${question.label}${question.required ? ' *' : ''}`}>
                    {question.type === 'yes_no' ? (
                      <Select
                        value={onboardingForm.responses?.[question.id] ?? ''}
                        onChange={(event) =>
                          setOnboardingForm((current: any) => ({
                            ...current,
                            responses: { ...current.responses, [question.id]: event.target.value },
                          }))
                        }
                      >
                        <option value="">Select...</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </Select>
                    ) : question.type === 'long_text' ? (
                      <Textarea
                        rows={4}
                        value={onboardingForm.responses?.[question.id] ?? ''}
                        onChange={(event) =>
                          setOnboardingForm((current: any) => ({
                            ...current,
                            responses: { ...current.responses, [question.id]: event.target.value },
                          }))
                        }
                      />
                    ) : (
                      <Input
                        type={question.type === 'date' ? 'date' : 'text'}
                        value={onboardingForm.responses?.[question.id] ?? ''}
                        onChange={(event) =>
                          setOnboardingForm((current: any) => ({
                            ...current,
                            responses: { ...current.responses, [question.id]: event.target.value },
                          }))
                        }
                      />
                    )}
                  </Field>
                ))}
                <Field label="W-9 link or upload reference">
                  <Input
                    value={onboardingForm.documentLinks.w9 ?? ''}
                    onChange={(event) =>
                      setOnboardingForm((current: any) => ({
                        ...current,
                        documentLinks: { ...current.documentLinks, w9: event.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Certificate of insurance link">
                  <Input
                    value={onboardingForm.documentLinks.coi ?? ''}
                    onChange={(event) =>
                      setOnboardingForm((current: any) => ({
                        ...current,
                        documentLinks: { ...current.documentLinks, coi: event.target.value },
                      }))
                    }
                  />
                </Field>
                <Field label="Banking support document link">
                  <Input
                    value={onboardingForm.documentLinks.banking ?? ''}
                    onChange={(event) =>
                      setOnboardingForm((current: any) => ({
                        ...current,
                        documentLinks: { ...current.documentLinks, banking: event.target.value },
                      }))
                    }
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Bank account name">
                    <Input
                      value={onboardingForm.bankingDetails.accountName ?? ''}
                      onChange={(event) =>
                        setOnboardingForm((current: any) => ({
                          ...current,
                          bankingDetails: { ...current.bankingDetails, accountName: event.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Account last four">
                    <Input
                      value={onboardingForm.bankingDetails.lastFour ?? ''}
                      onChange={(event) =>
                        setOnboardingForm((current: any) => ({
                          ...current,
                          bankingDetails: { ...current.bankingDetails, lastFour: event.target.value },
                        }))
                      }
                    />
                  </Field>
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => saveOnboarding(false)} disabled={onboardingSaving}>
                    Save Draft
                  </Button>
                  <Button type="button" onClick={() => saveOnboarding(true)} disabled={onboardingSaving}>
                    {onboardingSaving ? 'Submitting...' : 'Submit for Review'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-5">
              <Card className="rounded-[28px]">
                <CardHeader>
                  <CardTitle className="text-xl">Current status</CardTitle>
                  <CardDescription>Buyer review, risk scoring, and the latest submission state.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-background/70 px-4 py-3">
                    <span>Status</span>
                    <Badge variant="outline">{String(vendor.onboardingStatus ?? 'not_started').replace(/_/g, ' ')}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-background/70 px-4 py-3">
                    <span>Risk score</span>
                    <span className="font-medium text-foreground">{vendor.onboardingRiskScore ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-background/70 px-4 py-3">
                    <span>Risk level</span>
                    <StatusBadge value={String(vendor.onboardingRiskLevel ?? 'low')} />
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-background/70 px-4 py-3">
                    <span>Last submitted</span>
                    <span className="text-foreground">
                      {vendor.onboardingLastSubmittedAt
                        ? new Date(vendor.onboardingLastSubmittedAt).toLocaleString()
                        : '—'}
                    </span>
                  </div>
                  {onboardingMessage ? (
                    <Alert variant="success">
                      <AlertDescription>{onboardingMessage}</AlertDescription>
                    </Alert>
                  ) : null}
                  {onboardingData?.latestSubmission?.reviewNote ? (
                    <Alert variant="warning">
                      <AlertDescription>
                        Buyer note: {onboardingData.latestSubmission.reviewNote}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="rounded-[28px]">
                <CardHeader>
                  <CardTitle className="text-xl">Review coverage</CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-6 text-muted-foreground">
                  Buyers review your questionnaire answers, tax forms, insurance documents, and banking
                  support before issuing new purchase orders.
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}

        {activeTab === 'catalog' ? (
          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <Card className="overflow-hidden rounded-[28px]">
              <CardHeader>
                <CardTitle className="text-xl">Buyer catalog</CardTitle>
                <CardDescription>Assigned catalog items and their current commercial terms.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {!catalogData || catalogData.items.length === 0 ? (
                  <div className="px-6 py-14 text-center text-sm text-muted-foreground">
                    No catalog items are assigned to your company yet.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Item</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Current Price</TableHead>
                        <TableHead>Category</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {catalogData.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-semibold text-foreground">{item.name}</TableCell>
                          <TableCell className="text-muted-foreground">{item.sku ?? '—'}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {fmt(item.unitPrice, item.currency)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{item.category ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-5">
              <Card className="rounded-[28px]">
                <CardHeader>
                  <CardTitle className="text-xl">Submit price update</CardTitle>
                  <CardDescription>Propose a price change for a specific catalog item.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={submitPriceProposal} className="grid gap-4">
                    <Field label="Catalog item">
                      <Select
                        required
                        value={proposalForm.itemId}
                        onChange={(event) =>
                          setProposalForm((current) => ({ ...current, itemId: event.target.value }))
                        }
                      >
                        <option value="">Select catalog item</option>
                        {(catalogData?.items ?? []).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Proposed unit price">
                      <Input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={proposalForm.proposedPrice}
                        onChange={(event) =>
                          setProposalForm((current) => ({ ...current, proposedPrice: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Effective date">
                      <Input
                        type="date"
                        value={proposalForm.effectiveDate}
                        onChange={(event) =>
                          setProposalForm((current) => ({ ...current, effectiveDate: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Reason for the price update">
                      <Textarea
                        rows={4}
                        value={proposalForm.note}
                        onChange={(event) =>
                          setProposalForm((current) => ({ ...current, note: event.target.value }))
                        }
                      />
                    </Field>
                    <Button type="submit" disabled={proposalSaving}>
                      {proposalSaving ? 'Submitting...' : 'Submit Proposal'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="rounded-[28px]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <FileSpreadsheet className="h-5 w-5 text-sky-700" />
                    Bulk CSV Upload
                  </CardTitle>
                  <CardDescription>
                    Upload a CSV with `itemId` or `sku`, `proposedPrice`, and optional `effectiveDate` and `note` columns.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border/80 bg-background/60 px-4 py-4 text-sm text-muted-foreground hover:bg-muted/20">
                    <Upload className="h-4 w-4" />
                    <span>Choose CSV file</span>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleBulkCsvUpload}
                      disabled={proposalSaving}
                      className="hidden"
                    />
                  </label>
                  {bulkUploadMessage ? (
                    <Alert variant="success">
                      <AlertDescription>{bulkUploadMessage}</AlertDescription>
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="rounded-[28px]">
                <CardHeader>
                  <CardTitle className="text-xl">Proposal history</CardTitle>
                  <CardDescription>Recent supplier-submitted price proposals and buyer outcomes.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {!catalogData || catalogData.proposals.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                      No price proposals submitted yet.
                    </div>
                  ) : (
                    catalogData.proposals.map((proposal) => (
                      <div key={proposal.id} className="rounded-[22px] border border-border/70 bg-background/70 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <div className="font-semibold text-foreground">{proposal.item?.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {fmt(proposal.currentPrice, proposal.item?.currency ?? 'USD')} {'->'}{' '}
                              {fmt(proposal.proposedPrice, proposal.item?.currency ?? 'USD')}
                            </div>
                          </div>
                          <StatusBadge value={proposal.status} />
                        </div>
                        {proposal.note ? (
                          <div className="mt-3 text-sm text-muted-foreground">{proposal.note}</div>
                        ) : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}
      </div>

      {showInvoiceModal ? (
        <SubmitInvoiceModal
          token={token}
          purchaseOrders={purchaseOrders}
          onClose={() => setShowInvoiceModal(false)}
          onSuccess={() => {
            setShowInvoiceModal(false);
            setSubmitSuccess(true);
            setActiveTab('invoices');
            setData(null);
            void reloadDashboard();
          }}
        />
      ) : null}
    </PortalShell>
  );
}

export default function VendorPortalPage() {
  return (
    <Suspense
      fallback={
        <PortalShell vendorName="Loading portal">
          <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
            <div className="flex items-center gap-3 rounded-full border border-border/70 bg-card/80 px-5 py-3 text-sm">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          </div>
        </PortalShell>
      }
    >
      <VendorPortalContent />
    </Suspense>
  );
}
