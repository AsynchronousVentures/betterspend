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
import { Textarea } from '../../../components/ui/textarea';

function formatPrice(price: string | number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
    parseFloat(String(price || 0)),
  );
}

export default function CatalogItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    sku: '',
    description: '',
    category: '',
    unitOfMeasure: 'each',
    unitPrice: '',
    currency: 'USD',
  });

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.catalog
        .get(pid)
        .then((data) => {
          setItem(data);
          setForm({
            name: data.name || '',
            sku: data.sku || '',
            description: data.description || '',
            category: data.category || '',
            unitOfMeasure: data.unitOfMeasure || 'each',
            unitPrice: String(data.unitPrice || '0'),
            currency: data.currency || 'USD',
          });
        })
        .catch(() => setItem(null))
        .finally(() => setLoading(false));
    });
  }, [params]);

  function setField(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const updated = await api.catalog.update(id, {
        name: form.name,
        sku: form.sku || undefined,
        description: form.description || undefined,
        category: form.category || undefined,
        unitOfMeasure: form.unitOfMeasure,
        unitPrice: form.unitPrice,
        currency: form.currency,
      });
      setItem(updated);
      setEditing(false);
    } catch (err: any) {
      setError(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    setToggling(true);
    setError('');
    try {
      const updated = await api.catalog.update(id, { isActive: !item.isActive });
      setItem(updated);
    } catch (err: any) {
      setError(err.message ?? 'Status update failed');
    } finally {
      setToggling(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
          Loading catalog item...
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="p-4 lg:p-8">
        <Alert variant="destructive">
          <AlertDescription>
            Item not found.{' '}
            <Link href="/catalog" className="underline underline-offset-4">
              Back to catalog
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const price = formatPrice(item.unitPrice || '0', item.currency || 'USD');

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs items={[{ label: 'Catalog', href: '/catalog' }, { label: item.name }]} />

      <PageHeader
        title={item.name}
        description={item.sku ? `SKU ${item.sku}` : 'Catalog item details'}
        actions={
          <div className="flex flex-wrap gap-3">
            <Badge variant={item.isActive ? 'success' : 'secondary'}>
              {item.isActive ? 'Active' : 'Inactive'}
            </Badge>
            {item.isActive ? (
              <Button asChild>
                <Link
                  href={`/requisitions/new?catalogItemId=${item.id}&description=${encodeURIComponent(item.name)}&unitPrice=${encodeURIComponent(item.unitPrice ?? '0')}&uom=${encodeURIComponent(item.unitOfMeasure ?? 'each')}${item.vendor?.id ? `&vendorId=${item.vendor.id}` : ''}`}
                >
                  Create Requisition
                </Link>
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={toggleActive} disabled={toggling}>
              {toggling ? 'Updating...' : item.isActive ? 'Deactivate' : 'Activate'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing((current) => !current)}>
              {editing ? 'Cancel' : 'Edit'}
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {editing ? (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">Edit Catalog Item</CardTitle>
            <CardDescription>Update catalog metadata, pricing, and category details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Field label="Name">
                  <Input required value={form.name} onChange={(event) => setField('name', event.target.value)} />
                </Field>
              </div>
              <Field label="SKU">
                <Input value={form.sku} onChange={(event) => setField('sku', event.target.value)} />
              </Field>
              <Field label="Category">
                <Input value={form.category} onChange={(event) => setField('category', event.target.value)} />
              </Field>
              <div className="md:col-span-2">
                <Field label="Description">
                  <Textarea
                    value={form.description}
                    onChange={(event) => setField('description', event.target.value)}
                    rows={3}
                  />
                </Field>
              </div>
              <Field label="Unit of Measure">
                <Input
                  value={form.unitOfMeasure}
                  onChange={(event) => setField('unitOfMeasure', event.target.value)}
                />
              </Field>
              <Field label="Unit Price">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.unitPrice}
                  onChange={(event) => setField('unitPrice', event.target.value)}
                />
              </Field>
              <Field label="Currency">
                <Input
                  value={form.currency}
                  onChange={(event) => setField('currency', event.target.value.toUpperCase())}
                  maxLength={3}
                />
              </Field>
            </div>
            <div className="flex gap-3">
              <Button type="button" onClick={handleSave} disabled={saving || !form.name}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">Item Details</CardTitle>
            <CardDescription>Core catalog metadata, pricing, and vendor linkages.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Name" value={item.name} />
            <DetailField label="SKU" value={item.sku ?? '—'} />
            <DetailField label="Category" value={item.category ?? '—'} />
            <DetailField label="Unit of Measure" value={item.unitOfMeasure} />
            <DetailField label="Unit Price" value={price} />
            <DetailField label="Currency" value={item.currency} />
            {item.description ? (
              <div className="sm:col-span-2">
                <DetailField label="Description" value={item.description} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {item.vendor ? (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">Vendor</CardTitle>
            <CardDescription>Primary supplier associated with this catalog item.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={`/vendors/${item.vendor.id}`}
              className="font-medium text-foreground underline underline-offset-4"
            >
              {item.vendor.name}
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {item.priceProposals?.length ? (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">Supplier Price Proposal History</CardTitle>
            <CardDescription>Submitted, reviewed, and applied supplier price changes for this item.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {item.priceProposals.map((proposal: any) => (
              <div key={proposal.id} className="rounded-lg border border-border/70 bg-background/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-base font-semibold text-foreground">
                    {formatPrice(proposal.currentPrice, item.currency || 'USD')} to{' '}
                    {formatPrice(proposal.proposedPrice, item.currency || 'USD')}
                  </div>
                  <Badge
                    variant={
                      proposal.status === 'approved'
                        ? 'success'
                        : proposal.status === 'rejected'
                          ? 'destructive'
                          : 'warning'
                    }
                  >
                    {proposal.status}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                  <div>Supplier: {proposal.vendor?.name ?? '—'}</div>
                  <div>
                    Submitted:{' '}
                    {proposal.submittedAt ? new Date(proposal.submittedAt).toLocaleDateString() : '—'}
                  </div>
                  <div>
                    Effective:{' '}
                    {proposal.effectiveDate ? new Date(proposal.effectiveDate).toLocaleDateString() : 'Immediate'}
                  </div>
                  <div>Reviewed by: {proposal.reviewer?.name ?? 'Pending review'}</div>
                </div>
                {proposal.note ? (
                  <div className="mt-3 text-sm text-muted-foreground">Supplier note: {proposal.note}</div>
                ) : null}
                {proposal.reviewNote ? (
                  <div className="mt-2 text-sm text-muted-foreground">Review note: {proposal.reviewNote}</div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
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

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/70 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}
