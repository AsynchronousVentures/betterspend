'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
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

interface Vendor {
  id: string;
  name: string;
}

interface LineItem {
  description: string;
  qty: string;
  uom: string;
  unitPrice: string;
  taxCodeId: string;
  taxInclusive: boolean;
}

interface TaxCode {
  id: string;
  code: string;
  ratePercent: string;
}

interface ComplianceResult {
  status: 'compliant' | 'deviation' | 'no_contract' | 'exempt';
  deltaPercent: number | null;
  contractId: string | null;
  contractedUnitPrice: number | null;
  contractNumber?: string | null;
  deviationAction?: string;
  deviationThreshold?: number;
}

const EMPTY_LINE: LineItem = {
  description: '',
  qty: '1',
  uom: 'each',
  unitPrice: '0',
  taxCodeId: '',
  taxInclusive: false,
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function ComplianceBadge({
  result,
  deviationThreshold,
}: {
  result: ComplianceResult | null | undefined;
  deviationThreshold: number;
}) {
  if (!result) return null;

  if (result.status === 'no_contract') {
    return <Badge variant="secondary">No contract</Badge>;
  }

  if (result.status === 'compliant') {
    return <Badge variant="success">Contract: {formatCurrency(result.contractedUnitPrice ?? 0)}</Badge>;
  }

  if (result.status === 'deviation') {
    const delta = result.deltaPercent ?? 0;
    const exceeded = delta > deviationThreshold;
    const isBlock = result.deviationAction === 'block';
    return (
      <Badge variant={exceeded && isBlock ? 'destructive' : 'warning'}>
        Contract: {formatCurrency(result.contractedUnitPrice ?? 0)} (+{delta.toFixed(1)}%)
      </Badge>
    );
  }

  return <Badge variant="outline">Exempt</Badge>;
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [currency, setCurrency] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([{ ...EMPTY_LINE }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [lineCompliance, setLineCompliance] = useState<Array<ComplianceResult | null>>([null]);
  const [deviationThreshold, setDeviationThreshold] = useState(5);
  const [deviationAction, setDeviationAction] = useState('warn');
  const debounceTimers = useRef<Array<ReturnType<typeof setTimeout> | null>>([null]);

  useEffect(() => {
    Promise.allSettled([
      api.vendors.list(),
      api.taxCodes.list(),
      api.settings.getAll(),
      api.exchangeRates.getBaseCurrency(),
    ])
      .then(([vendorsResult, taxCodesResult, settingsResult, currencyResult]) => {
        if (vendorsResult.status === 'fulfilled') {
          const data = vendorsResult.value;
          const list: Vendor[] = Array.isArray(data) ? data : (data as any).data ?? [];
          setVendors(list);
          if (list.length > 0) setVendorId(list[0].id);
        }

        if (taxCodesResult.status === 'fulfilled') {
          const data = taxCodesResult.value;
          setTaxCodes(Array.isArray(data) ? data : []);
        }

        if (settingsResult.status === 'fulfilled') {
          const all = settingsResult.value;
          const threshold = parseFloat(all.contract_price_deviation_threshold || '5');
          const action = all.contract_price_deviation_action || 'warn';
          if (!isNaN(threshold)) setDeviationThreshold(threshold);
          setDeviationAction(action);
        }

        if (currencyResult.status === 'fulfilled') {
          const orgBaseCurrency = currencyResult.value?.baseCurrency || 'USD';
          setBaseCurrency(orgBaseCurrency);
          setCurrency(orgBaseCurrency);
        }
      })
      .catch(() => {})
      .finally(() => setVendorsLoading(false));
  }, []);

  const runComplianceCheck = useCallback((lineIdx: number, vid: string, price: number, desc: string) => {
    if (!vid || Number.isNaN(price) || price <= 0) {
      setLineCompliance((prev) => {
        const next = [...prev];
        next[lineIdx] = null;
        return next;
      });
      return;
    }

    if (debounceTimers.current[lineIdx]) {
      clearTimeout(debounceTimers.current[lineIdx]!);
    }

    debounceTimers.current[lineIdx] = setTimeout(async () => {
      try {
        const result = await api.purchaseOrders.checkCompliance({
          vendorId: vid,
          unitPrice: price,
          description: desc || undefined,
        });
        setLineCompliance((prev) => {
          const next = [...prev];
          next[lineIdx] = result;
          return next;
        });
        if (result.deviationThreshold != null) setDeviationThreshold(result.deviationThreshold);
        if (result.deviationAction) setDeviationAction(result.deviationAction);
      } catch {
        // noop
      }
    }, 600);
  }, []);

  useEffect(() => {
    if (!vendorId) return;
    lines.forEach((line, idx) => {
      const price = parseFloat(line.unitPrice);
      if (!Number.isNaN(price) && price > 0) {
        runComplianceCheck(idx, vendorId, price, line.description);
      }
    });
  }, [vendorId, lines, runComplianceCheck]);

  function getLineTotal(line: LineItem) {
    const raw = (parseFloat(line.qty) || 0) * (parseFloat(line.unitPrice) || 0);
    const taxCode = taxCodes.find((entry) => entry.id === line.taxCodeId);
    if (!taxCode) return raw;
    const rate = parseFloat(taxCode.ratePercent || '0') / 100;
    return line.taxInclusive ? raw : raw * (1 + rate);
  }

  const total = lines.reduce((sum, line) => sum + getLineTotal(line), 0);

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
    setLineCompliance((prev) => [...prev, null]);
    debounceTimers.current.push(null);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
    setLineCompliance((prev) => prev.filter((_, i) => i !== idx));
    debounceTimers.current = debounceTimers.current.filter((_, i) => i !== idx);
  }

  function updateLine(idx: number, field: keyof LineItem, value: string) {
    const updatedLines = lines.map((line, i) => (i === idx ? { ...line, [field]: value } : line));
    setLines(updatedLines);

    if (field === 'unitPrice' || field === 'description') {
      const updatedLine = updatedLines[idx];
      const price = parseFloat(updatedLine.unitPrice);
      if (vendorId) {
        runComplianceCheck(idx, vendorId, price, updatedLine.description);
      }
    }
  }

  const hasBlockingDeviation =
    deviationAction === 'block' &&
    lineCompliance.some((c) => c?.status === 'deviation' && (c.deltaPercent ?? 0) > deviationThreshold);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!vendorId) {
      setError('Please select a vendor.');
      return;
    }
    if (lines.length === 0) {
      setError('At least one line item is required.');
      return;
    }
    if (hasBlockingDeviation) {
      setError(
        'One or more line items exceed the contract price deviation threshold. Please correct the prices or contact your administrator.',
      );
      return;
    }

    setSubmitting(true);
    try {
      await api.purchaseOrders.create({
        vendorId,
        paymentTerms: paymentTerms.trim() || undefined,
        currency,
        exchangeRate: parseFloat(exchangeRate || '1') || 1,
        notes: notes.trim() || undefined,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: parseFloat(line.qty) || 1,
          unitOfMeasure: line.uom || 'each',
          unitPrice: parseFloat(line.unitPrice) || 0,
          taxCodeId: line.taxCodeId || undefined,
          taxInclusive: line.taxInclusive,
        })),
      });
      router.push('/purchase-orders');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="New Purchase Order"
        description="Create a purchase order with tax-aware line items and contract deviation checks."
        actions={
          <Button asChild variant="outline">
            <Link href="/purchase-orders">Back to Purchase Orders</Link>
          </Button>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">Details</CardTitle>
            <CardDescription>Vendor, commercial terms, base currency, and internal notes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Vendor">
              {vendorsLoading ? (
                <div className="text-sm text-muted-foreground">Loading vendors...</div>
              ) : vendors.length === 0 ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    No vendors found.{' '}
                    <Link href="/vendors/new" className="underline underline-offset-4">
                      Create a vendor
                    </Link>{' '}
                    first.
                  </AlertDescription>
                </Alert>
              ) : (
                <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full" required>
                  <option value="">Select vendor</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Payment Terms">
                <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Net 30" />
              </Field>
              <Field label="Currency">
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                />
              </Field>
              <Field label={`Exchange Rate to ${baseCurrency}`}>
                <Input
                  type="number"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  min="0"
                  step="0.000001"
                />
              </Field>
            </div>

            <div className="text-sm text-muted-foreground">
              Organization base currency is {baseCurrency}. Use `1` when the PO is already in {baseCurrency}.
            </div>

            <Field label="Notes">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional internal notes"
                rows={3}
              />
            </Field>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-xl">Line Items</CardTitle>
              <CardDescription>Tax-aware lines with contract compliance checks per item.</CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={addLine}>
              Add Line
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Tax Code</TableHead>
                  <TableHead>Tax Mode</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="text-right">Remove</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, idx) => {
                  const lineTotal = getLineTotal(line);
                  const compliance = lineCompliance[idx];
                  return (
                    <TableRow key={idx}>
                      <TableCell className="min-w-[260px]">
                        <div className="space-y-2">
                          <Input
                            type="text"
                            value={line.description}
                            onChange={(e) => updateLine(idx, 'description', e.target.value)}
                            placeholder="Item description"
                          />
                          {compliance ? (
                            <ComplianceBadge result={compliance} deviationThreshold={deviationThreshold} />
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={line.qty}
                          min="0"
                          step="any"
                          onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          value={line.uom}
                          onChange={(e) => updateLine(idx, 'uom', e.target.value)}
                          placeholder="each"
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={line.unitPrice}
                          min="0"
                          step="any"
                          onChange={(e) => updateLine(idx, 'unitPrice', e.target.value)}
                          className="w-32"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={line.taxCodeId}
                          onChange={(e) => updateLine(idx, 'taxCodeId', e.target.value)}
                          className="w-40"
                        >
                          <option value="">No tax</option>
                          {taxCodes.map((taxCode) => (
                            <option key={taxCode.id} value={taxCode.id}>
                              {taxCode.code} ({taxCode.ratePercent}%)
                            </option>
                          ))}
                        </Select>
                      </TableCell>
                      <TableCell>
                        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={line.taxInclusive}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((entry, i) =>
                                  i === idx ? { ...entry, taxInclusive: e.target.checked } : entry,
                                ),
                              )
                            }
                            className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
                          />
                          Inclusive
                        </label>
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {formatCurrency(lineTotal)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => removeLine(idx)}
                          disabled={lines.length === 1}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="mt-4 flex justify-end">
              <div className="rounded-lg border border-border/70 bg-muted/20 px-5 py-3 text-right">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Total
                </div>
                <div className="mt-1 text-2xl font-semibold text-foreground">{formatCurrency(total)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {hasBlockingDeviation ? (
          <Alert variant="destructive">
            <AlertDescription>
              One or more line prices exceed the contract deviation threshold ({deviationThreshold}%).
              Submission is blocked.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={submitting || vendorsLoading || hasBlockingDeviation}>
            {submitting ? 'Saving...' : 'Create Purchase Order'}
          </Button>
          <Button asChild variant="outline">
            <Link href="/purchase-orders">Cancel</Link>
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
