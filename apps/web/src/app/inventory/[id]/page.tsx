'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { api } from '../../../lib/api';
import Breadcrumbs from '../../../components/breadcrumbs';
import { StatusBadge } from '../../../components/status-badge';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Textarea } from '../../../components/ui/textarea';

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  receipt: 'Receipt',
  issue: 'Issue',
  adjustment: 'Adjustment',
  return: 'Return',
};

function fmtQty(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function InventoryItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState('');

  useEffect(() => {
    api.inventory
      .get(id)
      .then((data) => {
        setItem(data);
        setForm({
          name: data.name ?? '',
          description: data.description ?? '',
          unit: data.unit ?? 'each',
          reorderPoint: data.reorderPoint != null ? String(data.reorderPoint) : '',
          reorderQuantity: data.reorderQuantity != null ? String(data.reorderQuantity) : '',
          location: data.location ?? '',
        });
      })
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  function set(key: string, value: string) {
    setForm((current: any) => ({ ...current, [key]: value }));
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await api.inventory.update(id, {
        name: form.name,
        description: form.description || undefined,
        unit: form.unit || 'each',
        reorderPoint: form.reorderPoint !== '' ? Number(form.reorderPoint) : null,
        reorderQuantity: form.reorderQuantity !== '' ? Number(form.reorderQuantity) : null,
        location: form.location || null,
      });
      setItem((prev: any) => ({ ...prev, ...updated }));
      setEditing(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAdjust(event: FormEvent) {
    event.preventDefault();
    if (!adjustQty || isNaN(Number(adjustQty))) {
      setAdjustError('Please enter a valid quantity.');
      return;
    }
    setAdjusting(true);
    setAdjustError('');
    try {
      await api.inventory.adjust(id, { quantity: Number(adjustQty), notes: adjustNotes || undefined });
      const fresh = await api.inventory.get(id);
      setItem(fresh);
      setShowAdjust(false);
      setAdjustQty('');
      setAdjustNotes('');
    } catch (err: any) {
      setAdjustError(err.message);
    } finally {
      setAdjusting(false);
    }
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading...</div>;
  if (!item && error) {
    return (
      <div className="p-8">
        <Link href="/inventory" className="text-sm text-primary hover:underline">
          Back to Inventory
        </Link>
        <div className="mt-4 text-sm text-rose-700">{error}</div>
      </div>
    );
  }
  if (!item) return null;

  const movements: any[] = item.movements ?? [];

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs items={[{ label: 'Inventory', href: '/inventory' }, { label: item.name }]} />
      <Link href="/inventory" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Inventory
      </Link>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-sm font-semibold">
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{item.name}</h1>
            <span className="rounded-md bg-primary/10 px-2 py-1 font-mono text-xs font-semibold text-primary">{item.sku}</span>
            <StatusBadge value={item.stockStatus} label={item.stockStatus === 'ok' ? 'OK' : undefined} />
          </div>
          {item.description ? <p className="mt-3 text-sm text-muted-foreground">{item.description}</p> : null}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => { setShowAdjust(true); setAdjustError(''); }}>
            <Plus className="h-4 w-4" />
            Adjust Stock
          </Button>
          <Button variant={editing ? 'outline' : 'default'} onClick={() => setEditing(!editing)}>
            <Pencil className="h-4 w-4" />
            {editing ? 'Cancel Edit' : 'Edit'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {[
          { label: 'On Hand', value: fmtQty(item.quantityOnHand), unit: item.unit },
          { label: 'Reserved', value: fmtQty(item.quantityReserved), unit: item.unit },
          { label: 'Available', value: fmtQty(item.quantityAvailable), unit: item.unit },
          { label: 'Reorder Point', value: item.reorderPoint != null ? fmtQty(item.reorderPoint) : '—', unit: item.reorderPoint != null ? item.unit : '' },
          { label: 'Reorder Quantity', value: item.reorderQuantity != null ? fmtQty(item.reorderQuantity) : '—', unit: item.reorderQuantity != null ? item.unit : '' },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="space-y-2 p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{card.label}</div>
              <div className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{card.value}</div>
              {card.unit ? <div className="text-sm text-muted-foreground">{card.unit}</div> : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Edit Item</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium text-foreground">Name *</label>
                <Input value={form.name} onChange={(event) => set('name', event.target.value)} required />
              </div>
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium text-foreground">Description</label>
                <Textarea value={form.description} onChange={(event) => set('description', event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Unit</label>
                <Input value={form.unit} onChange={(event) => set('unit', event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Location</label>
                <Input value={form.location} onChange={(event) => set('location', event.target.value)} placeholder="Warehouse, shelf..." />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Reorder Point</label>
                <Input type="number" min="0" step="0.01" value={form.reorderPoint} onChange={(event) => set('reorderPoint', event.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Reorder Quantity</label>
                <Input type="number" min="0" step="0.01" value={form.reorderQuantity} onChange={(event) => set('reorderQuantity', event.target.value)} />
              </div>
              <div className="md:col-span-2 flex gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Movement History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {movements.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No movements recorded yet. Use &quot;Adjust Stock&quot; to record a manual adjustment.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Before</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((movement: any) => {
                  const qty = parseFloat(movement.quantity);
                  const isPositive = qty >= 0;
                  return (
                    <TableRow key={movement.id}>
                      <TableCell>
                        <StatusBadge value={movement.movementType === 'issue' ? 'exception' : movement.movementType === 'receipt' ? 'approved' : 'partial_match'} label={MOVEMENT_TYPE_LABELS[movement.movementType] ?? movement.movementType} />
                      </TableCell>
                      <TableCell className={isPositive ? 'text-right font-medium text-emerald-700' : 'text-right font-medium text-rose-700'}>
                        {isPositive ? '+' : ''}
                        {fmtQty(qty)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmtQty(parseFloat(movement.quantityBefore))}</TableCell>
                      <TableCell className="text-right font-medium text-foreground">{fmtQty(parseFloat(movement.quantityAfter))}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {movement.referenceType ? <span className="capitalize">{movement.referenceType.replace(/_/g, ' ')}</span> : '—'}
                      </TableCell>
                      <TableCell className="max-w-[220px] text-muted-foreground">
                        <span className="block truncate">{movement.notes ?? '—'}</span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(movement.createdAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {showAdjust ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowAdjust(false);
          }}
        >
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-lg">Adjust Stock</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                Current: <strong>{fmtQty(item.quantityOnHand)}</strong> {item.unit}. Enter a positive number to add stock, negative to remove.
              </p>
              {adjustError ? (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{adjustError}</AlertDescription>
                </Alert>
              ) : null}
              <form onSubmit={handleAdjust} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Quantity Change *</label>
                  <Input type="number" step="0.0001" value={adjustQty} onChange={(event) => setAdjustQty(event.target.value)} placeholder="e.g. 50 or -10" autoFocus required />
                  {adjustQty !== '' && !isNaN(Number(adjustQty)) ? (
                    <div className="mt-2 text-sm text-muted-foreground">
                      New quantity: <strong>{fmtQty(item.quantityOnHand + Number(adjustQty))}</strong> {item.unit}
                    </div>
                  ) : null}
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Notes</label>
                  <Input value={adjustNotes} onChange={(event) => setAdjustNotes(event.target.value)} placeholder="Reason for adjustment (optional)" />
                </div>
                <div className="flex gap-3">
                  <Button type="submit" className="flex-1" disabled={adjusting}>
                    {adjusting ? 'Saving...' : 'Apply Adjustment'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowAdjust(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
