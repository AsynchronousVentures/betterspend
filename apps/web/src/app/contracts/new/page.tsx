'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { api } from '../../../lib/api';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';

const CONTRACT_TYPES = [
  { value: 'msa', label: 'MSA — Master Service Agreement' },
  { value: 'sow', label: 'SOW — Statement of Work' },
  { value: 'nda', label: 'NDA — Non-Disclosure Agreement' },
  { value: 'sla', label: 'SLA — Service Level Agreement' },
  { value: 'purchase_agreement', label: 'Purchase Agreement' },
  { value: 'framework', label: 'Framework Agreement' },
  { value: 'other', label: 'Other' },
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR', 'MXN'];

export default function NewContractPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '',
    type: 'msa',
    vendorId: '',
    startDate: '',
    endDate: '',
    totalValue: '',
    currency: 'USD',
    paymentTerms: '',
    autoRenew: false,
    renewalNoticeDays: '',
    terms: '',
    internalNotes: '',
  });

  useEffect(() => {
    api.vendors.list().then(setVendors).catch(() => {});
  }, []);

  function set(key: string, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        title: form.title,
        type: form.type,
        vendorId: form.vendorId || undefined,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        totalValue: form.totalValue ? Number(form.totalValue) : undefined,
        currency: form.currency,
        paymentTerms: form.paymentTerms || undefined,
        autoRenew: form.autoRenew,
        terms: form.terms || undefined,
        internalNotes: form.internalNotes || undefined,
      };
      if (form.autoRenew && form.renewalNoticeDays) payload.renewalNoticeDays = Number(form.renewalNoticeDays);
      const created = await api.contracts.create(payload);
      router.push(`/contracts/${created.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create contract');
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Link href="/contracts" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Contracts
      </Link>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit} className="mx-auto max-w-4xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">New Contract</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <section className="space-y-4">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Basic Information</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-foreground">Title *</label>
                  <Input required value={form.title} onChange={(event) => set('title', event.target.value)} placeholder="e.g. Software Licensing Agreement 2026" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Contract Type *</label>
                  <Select required value={form.type} onChange={(event) => set('type', event.target.value)} className="w-full">
                    {CONTRACT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Vendor</label>
                  <Select value={form.vendorId} onChange={(event) => set('vendorId', event.target.value)} className="w-full">
                    <option value="">— Select vendor —</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Dates & Value</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Start Date</label>
                  <Input type="date" value={form.startDate} onChange={(event) => set('startDate', event.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">End Date</label>
                  <Input type="date" value={form.endDate} onChange={(event) => set('endDate', event.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Total Value</label>
                  <Input type="number" min="0" step="0.01" value={form.totalValue} onChange={(event) => set('totalValue', event.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Currency</label>
                  <Select value={form.currency} onChange={(event) => set('currency', event.target.value)} className="w-full">
                    {CURRENCIES.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Terms & Renewal</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Payment Terms</label>
                  <Select value={form.paymentTerms} onChange={(event) => set('paymentTerms', event.target.value)} className="w-full">
                    <option value="">— Select terms —</option>
                    {['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Due on Receipt', '2/10 Net 30'].map((term) => (
                      <option key={term} value={term}>
                        {term}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-3 text-sm font-medium text-foreground">
                    <input type="checkbox" checked={form.autoRenew} onChange={(event) => set('autoRenew', event.target.checked)} />
                    Auto-Renew
                  </label>
                </div>
                {form.autoRenew ? (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Renewal Notice (days)</label>
                    <Input type="number" min="1" value={form.renewalNoticeDays} onChange={(event) => set('renewalNoticeDays', event.target.value)} placeholder="e.g. 30" />
                  </div>
                ) : null}
              </div>
            </section>

            <section className="space-y-4">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Contract Details</div>
              <div className="grid gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Terms & Conditions</label>
                  <Textarea rows={6} value={form.terms} onChange={(event) => set('terms', event.target.value)} placeholder="Enter contract terms and conditions..." />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Internal Notes</label>
                  <Textarea rows={3} value={form.internalNotes} onChange={(event) => set('internalNotes', event.target.value)} placeholder="Internal notes not shared with the vendor..." />
                </div>
              </div>
            </section>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={saving}>
                <Plus className="h-4 w-4" />
                {saving ? 'Creating...' : 'Create Contract'}
              </Button>
              <Button asChild variant="outline">
                <Link href="/contracts">Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
