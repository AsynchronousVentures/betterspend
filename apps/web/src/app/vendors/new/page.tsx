'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { api } from '../../../lib/api';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';

export default function NewVendorPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    code: '',
    taxId: '',
    paymentTerms: 'Net 30',
    status: 'active',
    contactName: '',
    email: '',
    phone: '',
    street: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  });

  function set(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const vendor = await api.vendors.create({
        name: form.name,
        code: form.code || undefined,
        taxId: form.taxId || undefined,
        paymentTerms: form.paymentTerms || undefined,
        status: form.status,
        contactInfo: {
          contactName: form.contactName || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
        },
        address: {
          street: form.street || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          postalCode: form.postalCode || undefined,
          country: form.country || undefined,
        },
      });
      router.push(`/vendors/${vendor.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Link href="/vendors" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Vendors
      </Link>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit} className="mx-auto max-w-4xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">New Vendor</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <section className="space-y-4">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Basic Info</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-foreground">Name *</label>
                  <Input required value={form.name} onChange={(event) => set('name', event.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Code</label>
                  <Input value={form.code} onChange={(event) => set('code', event.target.value.toUpperCase())} placeholder="ACME" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Tax ID</label>
                  <Input value={form.taxId} onChange={(event) => set('taxId', event.target.value)} placeholder="12-3456789" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Payment Terms</label>
                  <Select value={form.paymentTerms} onChange={(event) => set('paymentTerms', event.target.value)} className="w-full">
                    {['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Due on Receipt', '2/10 Net 30'].map((term) => (
                      <option key={term} value={term}>
                        {term}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Status</label>
                  <Select value={form.status} onChange={(event) => set('status', event.target.value)} className="w-full">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="blocked">Blocked</option>
                  </Select>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Contact</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Contact Name</label>
                  <Input value={form.contactName} onChange={(event) => set('contactName', event.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Email</label>
                  <Input type="email" value={form.email} onChange={(event) => set('email', event.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Phone</label>
                  <Input value={form.phone} onChange={(event) => set('phone', event.target.value)} />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Address</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-foreground">Street</label>
                  <Input value={form.street} onChange={(event) => set('street', event.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">City</label>
                  <Input value={form.city} onChange={(event) => set('city', event.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">State / Province</label>
                  <Input value={form.state} onChange={(event) => set('state', event.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Postal Code</label>
                  <Input value={form.postalCode} onChange={(event) => set('postalCode', event.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Country</label>
                  <Input value={form.country} onChange={(event) => set('country', event.target.value)} placeholder="US" />
                </div>
              </div>
            </section>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={saving}>
                <Plus className="h-4 w-4" />
                {saving ? 'Creating...' : 'Create Vendor'}
              </Button>
              <Button asChild variant="outline">
                <Link href="/vendors">Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
