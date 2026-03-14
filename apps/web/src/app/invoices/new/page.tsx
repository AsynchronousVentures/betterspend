'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileScan, Plus, ReceiptText, Upload } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { Alert, AlertDescription } from '../../../components/ui/alert';
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
import { Badge } from '../../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

interface PO {
  id: string;
  number: string;
  vendorId: string;
  vendor: { id: string; name: string } | null;
  currency?: string | null;
  exchangeRate?: string | number | null;
  lines: Array<{ id: string; lineNumber: string; description: string; quantity: string; unitPrice: string }>;
}

interface InvoiceLine {
  poLineId: string;
  lineNumber: number;
  description: string;
  quantity: string;
  unitPrice: string;
  taxCodeId: string;
  taxInclusive: boolean;
}

interface TaxCode {
  id: string;
  code: string;
  ratePercent: string;
}

interface OcrExtractedLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

interface OcrJob {
  id: string;
  status: string;
  extractedData?: {
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    dueDate?: string | null;
    lines?: OcrExtractedLine[];
  } | null;
}

export default function NewInvoicePage() {
  const router = useRouter();
  const [pos, setPOs] = useState<PO[]>([]);
  const [selectedPO, setSelectedPO] = useState<PO | null>(null);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [currency, setCurrency] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Promise.allSettled([api.purchaseOrders.list(), api.exchangeRates.getBaseCurrency()])
      .then(([poResult, currencyResult]) => {
        if (poResult.status === 'fulfilled') {
          const data = poResult.value;
          const arr = Array.isArray(data) ? data : (data as any).data ?? [];
          setPOs(arr);
        }

        if (currencyResult.status === 'fulfilled') {
          const orgBaseCurrency = currencyResult.value?.baseCurrency || 'USD';
          setBaseCurrency(orgBaseCurrency);
          setCurrency(orgBaseCurrency);
        }
      })
      .catch(() => {});

    api.taxCodes
      .list()
      .then((data) => setTaxCodes(Array.isArray(data) ? data : []))
      .catch(() => {});

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handlePOChange(poId: string) {
    if (!poId) {
      setSelectedPO(null);
      setLines([]);
      setVendorId('');
      setCurrency(baseCurrency);
      setExchangeRate('1');
      return;
    }

    const po = (await api.purchaseOrders.get(poId)) as PO;
    setSelectedPO(po);
    setVendorId(po.vendor?.id ?? po.vendorId);
    setCurrency((po.currency || baseCurrency).toUpperCase());
    setExchangeRate(String(po.exchangeRate ?? '1'));
    setLines(
      (po.lines ?? []).map((line, index) => ({
        poLineId: line.id,
        lineNumber: index + 1,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxCodeId: '',
        taxInclusive: false,
      })),
    );
  }

  function updateLine(index: number, patch: Partial<InvoiceLine>) {
    setLines((prev) => prev.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        poLineId: '',
        lineNumber: prev.length + 1,
        description: '',
        quantity: '1',
        unitPrice: '0',
        taxCodeId: '',
        taxInclusive: false,
      },
    ]);
  }

  function removeLine(index: number) {
    setLines((prev) =>
      prev
        .filter((_, lineIndex) => lineIndex !== index)
        .map((line, lineIndex) => ({ ...line, lineNumber: lineIndex + 1 })),
    );
  }

  function getLineTotal(line: InvoiceLine) {
    const raw = parseFloat(line.quantity || '0') * parseFloat(line.unitPrice || '0');
    const taxCode = taxCodes.find((entry) => entry.id === line.taxCodeId);
    if (!taxCode) return raw;
    const rate = parseFloat(taxCode.ratePercent || '0') / 100;
    return line.taxInclusive ? raw : raw * (1 + rate);
  }

  const subtotal = lines.reduce((sum, line) => sum + getLineTotal(line), 0);

  async function handleOcrUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setOcrLoading(true);
    setOcrStatus('Reading file...');

    try {
      const base64Data: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] ?? result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setOcrStatus('Extracting...');
      const storageKey = `inline/${Date.now()}-${file.name}`;
      const job = (await api.ocr.createJob({
        filename: file.name,
        contentType: file.type,
        storageKey,
        base64Data,
      })) as OcrJob;

      pollRef.current = setInterval(async () => {
        const updated = (await api.ocr.getJob(job.id).catch(() => null)) as OcrJob | null;
        if (!updated) return;

        if (updated.status === 'done') {
          if (pollRef.current) clearInterval(pollRef.current);
          setOcrStatus('Done: fields pre-populated below');
          setOcrLoading(false);
          applyOcrData(updated);
        } else if (updated.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setOcrStatus('Extraction failed. Fill the invoice manually.');
          setOcrLoading(false);
        }
      }, 1500);
    } catch {
      setOcrStatus('Upload failed');
      setOcrLoading(false);
    }
  }

  function applyOcrData(job: OcrJob) {
    const data = job.extractedData;
    if (!data) return;
    if (data.invoiceNumber) setInvoiceNumber(data.invoiceNumber);
    if (data.invoiceDate) setInvoiceDate(data.invoiceDate.split('T')[0]);
    if (data.dueDate) setDueDate(data.dueDate.split('T')[0]);
    if (data.lines?.length) {
      setLines(
        data.lines.map((line, index) => ({
          poLineId: '',
          lineNumber: index + 1,
          description: line.description,
          quantity: String(line.quantity),
          unitPrice: String(line.unitPrice),
          taxCodeId: '',
          taxInclusive: false,
        })),
      );
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const invoice = (await api.invoices.create({
        purchaseOrderId: selectedPO?.id || undefined,
        vendorId,
        invoiceNumber,
        invoiceDate,
        currency,
        exchangeRate: parseFloat(exchangeRate || '1') || 1,
        dueDate: dueDate || undefined,
        lines: lines.map((line) => ({
          poLineId: line.poLineId || undefined,
          taxCodeId: line.taxCodeId || undefined,
          taxInclusive: line.taxInclusive,
          lineNumber: line.lineNumber,
          description: line.description,
          quantity: parseFloat(line.quantity),
          unitPrice: parseFloat(line.unitPrice),
        })),
      })) as any;
      router.push(`/invoices/${invoice.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Failed to create invoice.');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Create Invoice"
        description="Capture a standalone invoice or preload from a purchase order, with OCR-assisted extraction for PDFs and images."
        actions={
          <Button asChild variant="outline">
            <Link href="/invoices">Cancel</Link>
          </Button>
        }
      />

      <Card className="rounded-[24px] border-sky-200/70 bg-sky-50/80">
        <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-900">
              <FileScan className="h-4 w-4" />
              Upload Invoice (OCR)
            </div>
            <div className="text-sm text-sky-800">
              Upload a PDF or image to auto-extract invoice fields and line items.
            </div>
            {ocrStatus ? (
              <Badge variant="outline" className="border-sky-200 bg-white text-sky-900">
                {ocrStatus}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={handleOcrUpload}
            />
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={ocrLoading}
            >
              <Upload className="h-4 w-4" />
              {ocrLoading ? 'Processing...' : 'Choose File'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Invoice Details</CardTitle>
            <CardDescription>
              Link the invoice to a purchase order when applicable. PO-linked invoices inherit currency defaults.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Link to Purchase Order">
              <Select onChange={(event) => void handlePOChange(event.target.value)} value={selectedPO?.id ?? ''} className="w-full">
                <option value="">No PO (standalone invoice)</option>
                {pos.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.number} - {po.vendor?.name ?? 'Unknown'}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Vendor Invoice Number">
              <Input
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
                required
                placeholder="INV-20240115"
              />
            </Field>

            <Field label="Invoice Date">
              <Input
                type="date"
                value={invoiceDate}
                onChange={(event) => setInvoiceDate(event.target.value)}
                required
              />
            </Field>

            <Field label="Due Date">
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </Field>

            <Field label="Currency">
              <Input
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                maxLength={3}
              />
            </Field>

            <Field label={`Exchange Rate to ${baseCurrency}`}>
              <Input
                type="number"
                min="0"
                step="0.000001"
                value={exchangeRate}
                onChange={(event) => setExchangeRate(event.target.value)}
              />
            </Field>

            <div className="md:col-span-2 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              Organization base currency is {baseCurrency}. Linked purchase orders default invoice currency and exchange rate.
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[24px]">
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-xl">Line Items</CardTitle>
              <CardDescription>
                Add invoice lines manually or start from PO/OCR imported data.
              </CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={addLine}>
              <Plus className="h-4 w-4" />
              Add Line
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="text-right">Remove</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      No lines yet. Add a line or select a PO above.
                    </TableCell>
                  </TableRow>
                ) : (
                  lines.map((line, index) => (
                    <TableRow key={index}>
                      <TableCell className="align-top text-muted-foreground">{index + 1}</TableCell>
                      <TableCell className="space-y-3">
                        <Input
                          value={line.description}
                          onChange={(event) => updateLine(index, { description: event.target.value })}
                          required
                        />
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                          <Select
                            value={line.taxCodeId}
                            onChange={(event) => updateLine(index, { taxCodeId: event.target.value })}
                            className="w-full"
                          >
                            <option value="">No tax code</option>
                            {taxCodes.map((taxCode) => (
                              <option key={taxCode.id} value={taxCode.id}>
                                {taxCode.code} ({taxCode.ratePercent}%)
                              </option>
                            ))}
                          </Select>
                          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={line.taxInclusive}
                              onChange={(event) => updateLine(index, { taxInclusive: event.target.checked })}
                              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
                            />
                            Tax inclusive
                          </label>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.quantity}
                          onChange={(event) => updateLine(index, { quantity: event.target.value })}
                          required
                        />
                      </TableCell>
                      <TableCell className="align-top">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                          required
                        />
                      </TableCell>
                      <TableCell className="align-top font-medium text-foreground">
                        ${getLineTotal(line).toFixed(2)}
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <Button type="button" variant="ghost" onClick={() => removeLine(index)}>
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            <div className="mt-4 flex justify-end">
              <div className="rounded-2xl border border-border/70 bg-muted/20 px-5 py-3 text-right">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Total
                </div>
                <div className="mt-1 text-2xl font-semibold text-foreground">
                  ${subtotal.toFixed(2)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={loading || !invoiceNumber || lines.length === 0}>
            <ReceiptText className="h-4 w-4" />
            {loading ? 'Creating...' : 'Create Invoice'}
          </Button>
          <Button asChild variant="outline">
            <Link href="/invoices">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
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
