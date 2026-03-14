'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bot, FileStack, Plus, Sparkles } from 'lucide-react';
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

interface CatalogItem {
  id: string;
  name: string;
  sku: string | null;
  unitPrice: string;
  unitOfMeasure: string;
  currency: string;
  vendor: { id: string; name: string } | null;
}

interface LineItem {
  description: string;
  qty: string;
  uom: string;
  unitPrice: string;
  vendorId: string;
  catalogItemId: string;
}

const EMPTY_LINE: LineItem = {
  description: '',
  qty: '1',
  uom: 'each',
  unitPrice: '0',
  vendorId: '',
  catalogItemId: '',
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function CatalogPicker({
  onSelect,
  currentDescription,
}: {
  currentDescription: string;
  onSelect: (item: CatalogItem) => void;
}) {
  const [query, setQuery] = useState(currentDescription);
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(currentDescription);
  }, [currentDescription]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function handleChange(value: string) {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    if (value.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const items = await api.catalog.search(value);
        setResults(items as CatalogItem[]);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  function pick(item: CatalogItem) {
    setQuery(item.name);
    setOpen(false);
    setResults([]);
    onSelect(item);
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        type="text"
        value={query}
        onChange={(event) => handleChange(event.target.value)}
        onFocus={() => query.length >= 2 && results.length > 0 && setOpen(true)}
        placeholder="Search catalog or type description"
      />
      {loading ? (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          ...
        </span>
      ) : null}
      {open && results.length > 0 ? (
        <div className="absolute top-full z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border/70 bg-background shadow-lg">
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={() => pick(item)}
              className="block w-full border-b border-border/50 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40"
            >
              <div className="font-medium text-foreground">{item.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {item.sku ? <span className="mr-2">SKU: {item.sku}</span> : null}
                <span className="font-medium text-foreground">
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: item.currency,
                  }).format(parseFloat(item.unitPrice))}{' '}
                  / {item.unitOfMeasure}
                </span>
                {item.vendor ? <span className="ml-2">· {item.vendor.name}</span> : null}
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NewRequisitionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [currency, setCurrency] = useState('USD');
  const [neededBy, setNeededBy] = useState('');
  const [templateBanner, setTemplateBanner] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMsg, setAiMsg] = useState('');

  const prefill = searchParams.get('catalogItemId')
    ? {
        catalogItemId: searchParams.get('catalogItemId') ?? '',
        description: searchParams.get('description') ?? '',
        unitPrice: searchParams.get('unitPrice') ?? '0',
        uom: searchParams.get('uom') ?? 'each',
        vendorId: searchParams.get('vendorId') ?? '',
      }
    : null;

  const [lines, setLines] = useState<LineItem[]>([
    prefill ? { ...EMPTY_LINE, ...prefill } : { ...EMPTY_LINE },
  ]);

  useEffect(() => {
    const templateId = searchParams.get('templateId');
    if (!templateId) return;
    api.requisitionTemplates
      .apply(templateId)
      .then((data: any) => {
        if (data?.title) setTitle(data.title);
        if (data?.description) setDescription(data.description);
        if (data?.priority) setPriority(data.priority);
        if (data?.currency) setCurrency(data.currency);
        if (data?.lines?.length) {
          setLines(
            data.lines.map((line: any) => ({
              description: line.description || '',
              qty: String(line.quantity || 1),
              uom: line.unitOfMeasure || 'each',
              unitPrice: String(line.unitPrice || 0),
              vendorId: line.vendorId || '',
              catalogItemId: line.catalogItemId || '',
            })),
          );
        }
        api.requisitionTemplates
          .get(templateId)
          .then((template: any) => {
            if (template?.name) setTemplateBanner(template.name);
          })
          .catch(() => setTemplateBanner('template'));
      })
      .catch(() => {});
  }, [searchParams]);

  const total = lines.reduce(
    (sum, line) => sum + (parseFloat(line.qty) || 0) * (parseFloat(line.unitPrice) || 0),
    0,
  );

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, lineIndex) => lineIndex !== index));
  }

  function updateLine(index: number, field: keyof LineItem, value: string) {
    setLines((prev) =>
      prev.map((line, lineIndex) => (lineIndex === index ? { ...line, [field]: value } : line)),
    );
  }

  function applyFromCatalog(index: number, item: CatalogItem) {
    setLines((prev) =>
      prev.map((line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              description: item.name,
              unitPrice: item.unitPrice,
              uom: item.unitOfMeasure,
              vendorId: item.vendor?.id ?? line.vendorId,
              catalogItemId: item.id,
            }
          : line,
      ),
    );
  }

  async function handleAiParse() {
    if (!aiText.trim()) return;
    setAiLoading(true);
    setAiMsg('');
    try {
      const response = await fetch('/api/v1/requisitions/ai-parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': '00000000-0000-0000-0000-000000000001',
        },
        body: JSON.stringify({ text: aiText }),
      });
      const parsed = await response.json();
      if (parsed.error) {
        setAiMsg(`Parse failed: ${parsed.error}`);
        return;
      }
      if (parsed.title) setTitle(parsed.title);
      if (parsed.description) setDescription(parsed.description);
      if (parsed.priority) setPriority(parsed.priority);
      if (parsed.neededBy) setNeededBy(parsed.neededBy.slice(0, 10));
      if (parsed.lines?.length) {
        setLines(
          parsed.lines.map((line: any) => ({
            description: line.description || '',
            qty: String(line.quantity || 1),
            uom: line.unitOfMeasure || 'each',
            unitPrice: String(line.unitPrice || 0),
            vendorId: '',
            catalogItemId: '',
          })),
        );
      }
      setAiMsg('Fields populated from your description. Review and adjust as needed.');
      setAiText('');
    } catch {
      setAiMsg('AI parsing failed. Please fill in the form manually.');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setSubmitting(true);
    try {
      await api.requisitions.create({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        currency,
        neededBy: neededBy || undefined,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: parseFloat(line.qty) || 1,
          unitOfMeasure: line.uom || 'each',
          unitPrice: parseFloat(line.unitPrice) || 0,
          vendorId: line.vendorId || undefined,
          catalogItemId: line.catalogItemId || undefined,
        })),
      });
      router.push('/requisitions');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="New Requisition"
        description="Create a request manually, from a template, or from an AI-assisted plain-language description."
        actions={
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href="/requisitions">Back to Requisitions</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/requisitions/templates">
                <FileStack className="h-4 w-4" />
                Browse Templates
              </Link>
            </Button>
          </div>
        }
      />

      {templateBanner ? (
        <Alert variant="success">
          <AlertDescription>
            Pre-filled from template <strong>{templateBanner}</strong>. Review and adjust the fields before creating.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-[24px] border-sky-200/70 bg-gradient-to-br from-sky-50 to-indigo-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-sky-700" />
            AI-Assisted Creation
          </CardTitle>
          <CardDescription>
            Describe what you need in plain language and BetterSpend will pre-fill the requisition.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={aiText}
            onChange={(event) => setAiText(event.target.value)}
            placeholder="I need 50 boxes of A4 paper and 10 printer cartridges for the office. These are urgent and needed by next Friday."
            rows={4}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handleAiParse} disabled={!aiText.trim() || aiLoading}>
              <Bot className="h-4 w-4" />
              {aiLoading ? 'Parsing...' : 'Parse with AI'}
            </Button>
            {aiMsg ? (
              <Badge
                variant="outline"
                className={
                  aiMsg.startsWith('Fields')
                    ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
                    : 'border-rose-200 bg-rose-100 text-rose-800'
                }
              >
                {aiMsg}
              </Badge>
            ) : null}
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
            <CardTitle className="text-xl">Details</CardTitle>
            <CardDescription>Set the header details and request urgency for this requisition.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Title">
              <Input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Office supplies Q1"
                required
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional notes or justification"
                rows={3}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Priority">
                <Select value={priority} onChange={(event) => setPriority(event.target.value)} className="w-full">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </Select>
              </Field>
              <Field label="Currency">
                <Input
                  type="text"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                  maxLength={3}
                />
              </Field>
              <Field label="Needed By">
                <Input
                  type="date"
                  value={neededBy}
                  onChange={(event) => setNeededBy(event.target.value)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[24px]">
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-xl">Line Items</CardTitle>
              <CardDescription>
                Search the catalog inline. Selecting an item auto-fills price, unit, and vendor context.
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
                  <TableHead>Description / Catalog</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="text-right">Remove</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => {
                  const lineTotal = (parseFloat(line.qty) || 0) * (parseFloat(line.unitPrice) || 0);
                  return (
                    <TableRow key={index}>
                      <TableCell className="min-w-[320px]">
                        <CatalogPicker
                          currentDescription={line.description}
                          onSelect={(item) => applyFromCatalog(index, item)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={line.qty}
                          min="0"
                          step="any"
                          onChange={(event) => updateLine(index, 'qty', event.target.value)}
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          value={line.uom}
                          onChange={(event) => updateLine(index, 'uom', event.target.value)}
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
                          onChange={(event) => updateLine(index, 'unitPrice', event.target.value)}
                          className="w-28"
                        />
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {formatCurrency(lineTotal)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => removeLine(index)}
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
              <div className="rounded-2xl border border-border/70 bg-muted/20 px-5 py-3 text-right">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Total
                </div>
                <div className="mt-1 text-2xl font-semibold text-foreground">
                  {formatCurrency(total)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Create Requisition'}
          </Button>
          <Button asChild variant="outline">
            <Link href="/requisitions">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewRequisitionPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 lg:p-8">
          <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
            Loading...
          </div>
        </div>
      }
    >
      <NewRequisitionContent />
    </Suspense>
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
