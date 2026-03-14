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
import { Textarea } from '../../../components/ui/textarea';

export default function NewInventoryItemPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    sku: '',
    name: '',
    description: '',
    unit: 'each',
    reorderPoint: '',
    reorderQuantity: '',
    location: '',
  });

  function set(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.sku.trim() || !form.name.trim()) {
      setError('SKU and Name are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const item = await api.inventory.create({
        sku: form.sku.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        unit: form.unit.trim() || 'each',
        reorderPoint: form.reorderPoint !== '' ? Number(form.reorderPoint) : undefined,
        reorderQuantity: form.reorderQuantity !== '' ? Number(form.reorderQuantity) : undefined,
        location: form.location.trim() || undefined,
      });
      router.push(`/inventory/${item.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Link href="/inventory" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Inventory
      </Link>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">New Inventory Item</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <section className="space-y-4">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Item Details</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">SKU *</label>
                  <Input required value={form.sku} onChange={(event) => set('sku', event.target.value)} placeholder="e.g. WIDGET-001" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Unit of Measure</label>
                  <Input value={form.unit} onChange={(event) => set('unit', event.target.value)} placeholder="each, kg, liter..." />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-foreground">Name *</label>
                  <Input required value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="Item name" />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-foreground">Description</label>
                  <Textarea value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="Optional description" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Reorder Point</label>
                  <Input type="number" min="0" step="0.01" value={form.reorderPoint} onChange={(event) => set('reorderPoint', event.target.value)} placeholder="Trigger reorder at this qty" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Reorder Quantity</label>
                  <Input type="number" min="0" step="0.01" value={form.reorderQuantity} onChange={(event) => set('reorderQuantity', event.target.value)} placeholder="How much to reorder" />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-foreground">Storage Location</label>
                  <Input value={form.location} onChange={(event) => set('location', event.target.value)} placeholder="e.g. Warehouse A, Shelf 3" />
                </div>
              </div>
            </section>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={saving}>
                <Plus className="h-4 w-4" />
                {saving ? 'Creating...' : 'Create Item'}
              </Button>
              <Button asChild variant="outline">
                <Link href="/inventory">Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
