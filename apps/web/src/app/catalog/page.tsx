'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Tag } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
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

interface Vendor {
  id: string;
  name: string;
}

interface CatalogItem {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unitOfMeasure: string;
  unitPrice: string;
  currency: string;
  isActive: boolean;
  vendor: Vendor | null;
}

const EMPTY_FORM = {
  name: '',
  sku: '',
  description: '',
  category: '',
  unitOfMeasure: 'each',
  unitPrice: '',
  currency: 'USD',
  vendorId: '',
};

function formatPrice(price: string, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(parseFloat(price));
}

export default function CatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [pageError, setPageError] = useState('');
  const [priceProposals, setPriceProposals] = useState<any[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setPageError('');
    try {
      const [catalogItems, vendorList, categoryList, proposals] = await Promise.all([
        searchQ
          ? api.catalog.search(searchQ)
          : api.catalog.list({
              vendorId: filterVendor || undefined,
              category: filterCategory || undefined,
            }),
        api.vendors.list(),
        api.catalog.categories(),
        api.catalog.priceProposals('pending'),
      ]);
      setItems(catalogItems as CatalogItem[]);
      setVendors(vendorList as Vendor[]);
      setCategories(categoryList);
      setPriceProposals(proposals);
    } catch {
      setPageError('Failed to load catalog data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [filterCategory, filterVendor, searchQ]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const body = {
      name: form.name,
      sku: form.sku || undefined,
      description: form.description || undefined,
      category: form.category || undefined,
      unitOfMeasure: form.unitOfMeasure,
      unitPrice: parseFloat(form.unitPrice),
      currency: form.currency,
      vendorId: form.vendorId || undefined,
    };
    try {
      if (editId) await api.catalog.update(editId, body);
      else await api.catalog.create(body);
      setShowForm(false);
      setEditId(null);
      setForm(EMPTY_FORM);
      setFormError('');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(item: CatalogItem) {
    setForm({
      name: item.name,
      sku: item.sku ?? '',
      description: item.description ?? '',
      category: item.category ?? '',
      unitOfMeasure: item.unitOfMeasure,
      unitPrice: item.unitPrice,
      currency: item.currency,
      vendorId: item.vendor?.id ?? '',
    });
    setEditId(item.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this catalog item?')) return;
    await api.catalog.remove(id).catch(() => {});
    await load();
  }

  async function toggleActive(item: CatalogItem) {
    await api.catalog.update(item.id, { isActive: !item.isActive }).catch(() => {});
    await load();
  }

  async function reviewProposal(itemId: string, proposalId: string, status: 'approved' | 'rejected') {
    await api.catalog.reviewPriceProposal(itemId, proposalId, {
      status,
      reviewNote: reviewNotes[proposalId],
    });
    await load();
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Catalog"
        description="Managed product and service catalog for requisitions, supplier price updates, and item governance."
        actions={
          <Button
            type="button"
            onClick={() => {
              setShowForm(!showForm);
              setEditId(null);
              setForm(EMPTY_FORM);
            }}
          >
            <Plus className="h-4 w-4" />
            {showForm && !editId ? 'Cancel' : 'Add Item'}
          </Button>
        }
      />

      {pageError ? (
        <Alert variant="destructive">
          <AlertDescription>{pageError}</AlertDescription>
        </Alert>
      ) : null}

      {showForm ? (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">{editId ? 'Edit Item' : 'New Catalog Item'}</CardTitle>
            <CardDescription>Maintain item metadata, supplier reference, and pricing defaults.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="md:col-span-2">
                  <Field label="Name">
                    <Input
                      required
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                      placeholder="Item name"
                    />
                  </Field>
                </div>
                <Field label="SKU">
                  <Input
                    value={form.sku}
                    onChange={(event) => setForm({ ...form, sku: event.target.value })}
                    placeholder="OFF-PAPER-A4"
                  />
                </Field>
                <div className="md:col-span-3">
                  <Field label="Description">
                    <Input
                      value={form.description}
                      onChange={(event) => setForm({ ...form, description: event.target.value })}
                      placeholder="Brief description"
                    />
                  </Field>
                </div>
                <Field label="Category">
                  <Input
                    value={form.category}
                    onChange={(event) => setForm({ ...form, category: event.target.value })}
                    placeholder="Office Supplies"
                    list="categories-list"
                  />
                  <datalist id="categories-list">
                    {categories.map((category) => (
                      <option key={category} value={category} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Vendor">
                  <Select
                    value={form.vendorId}
                    onChange={(event) => setForm({ ...form, vendorId: event.target.value })}
                    className="w-full"
                  >
                    <option value="">No vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Unit of Measure">
                  <Input
                    value={form.unitOfMeasure}
                    onChange={(event) => setForm({ ...form, unitOfMeasure: event.target.value })}
                    placeholder="each"
                  />
                </Field>
                <Field label="Unit Price">
                  <Input
                    type="number"
                    required
                    min="0"
                    step="any"
                    value={form.unitPrice}
                    onChange={(event) => setForm({ ...form, unitPrice: event.target.value })}
                    placeholder="0.00"
                  />
                </Field>
                <Field label="Currency">
                  <Input
                    value={form.currency}
                    maxLength={3}
                    onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
                  />
                </Field>
              </div>

              {formError ? (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : editId ? 'Update Item' : 'Create Item'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setEditId(null);
                    setForm(EMPTY_FORM);
                    setFormError('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-lg">
        <CardContent className="flex flex-wrap items-center gap-3 p-6">
          <Input
            className="w-[220px]"
            placeholder="Search items..."
            value={searchQ}
            onChange={(event) => setSearchQ(event.target.value)}
          />
          <Select
            className="w-[180px]"
            value={filterCategory}
            onChange={(event) => {
              setFilterCategory(event.target.value);
              setSearchQ('');
            }}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
          <Select
            className="w-[180px]"
            value={filterVendor}
            onChange={(event) => {
              setFilterVendor(event.target.value);
              setSearchQ('');
            }}
          >
            <option value="">All vendors</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </Select>
          {filterCategory || filterVendor || searchQ ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFilterCategory('');
                setFilterVendor('');
                setSearchQ('');
              }}
            >
              Clear
            </Button>
          ) : null}
          <div className="ml-auto text-sm text-muted-foreground">{items.length} items</div>
        </CardContent>
      </Card>

      {priceProposals.length > 0 ? (
        <Card className="rounded-lg border-amber-200/70 bg-amber-50/60">
          <CardHeader>
            <CardTitle className="text-xl">Pending Supplier Price Updates</CardTitle>
            <CardDescription>{priceProposals.length} proposals waiting for buyer review.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {priceProposals.slice(0, 6).map((proposal) => (
              <div
                key={proposal.id}
                className="grid gap-3 rounded-lg border border-border/70 bg-background p-4 xl:grid-cols-[1.2fr_1fr_1fr_1.3fr_auto]"
              >
                <div>
                  <div className="font-medium text-foreground">{proposal.item?.name}</div>
                  <div className="text-sm text-muted-foreground">{proposal.vendor?.name}</div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {formatPrice(String(proposal.currentPrice), proposal.item?.currency ?? 'USD')} to{' '}
                  {formatPrice(String(proposal.proposedPrice), proposal.item?.currency ?? 'USD')}
                </div>
                <div className="text-sm text-muted-foreground">
                  Effective:{' '}
                  {proposal.effectiveDate
                    ? new Date(proposal.effectiveDate).toLocaleDateString()
                    : 'Immediate'}
                </div>
                <Input
                  value={reviewNotes[proposal.id] ?? ''}
                  onChange={(event) =>
                    setReviewNotes((current) => ({ ...current, [proposal.id]: event.target.value }))
                  }
                  placeholder="Review note"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    className="h-9"
                    onClick={() => reviewProposal(proposal.itemId, proposal.id, 'approved')}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-9"
                    onClick={() => reviewProposal(proposal.itemId, proposal.id, 'rejected')}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl">Catalog Items</CardTitle>
          <CardDescription>Browse, edit, deactivate, and requisition active catalog items.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center">
              <div className="text-base font-medium text-foreground">No catalog items</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Add items to the catalog to enable quick selection in requisitions.
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id} className={!item.isActive ? 'opacity-50' : undefined}>
                    <TableCell>
                      <div className="space-y-1">
                        <Link href={`/catalog/${item.id}`} className="font-medium text-foreground underline underline-offset-4">
                          {item.name}
                        </Link>
                        {item.description ? (
                          <div className="text-xs text-muted-foreground">{item.description}</div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.sku ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{item.category ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{item.vendor?.name ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{item.unitOfMeasure}</TableCell>
                    <TableCell className="font-medium text-foreground">
                      {formatPrice(item.unitPrice, item.currency)}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => void toggleActive(item)}
                        className={item.isActive ? 'text-sm font-semibold text-emerald-700' : 'text-sm font-semibold text-muted-foreground'}
                      >
                        {item.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {item.isActive ? (
                          <Button asChild size="sm" variant="outline">
                            <Link
                              href={`/requisitions/new?catalogItemId=${item.id}&description=${encodeURIComponent(item.name)}&unitPrice=${encodeURIComponent(item.unitPrice ?? '0')}&uom=${encodeURIComponent(item.unitOfMeasure ?? 'each')}${item.vendor?.id ? `&vendorId=${item.vendor.id}` : ''}`}
                            >
                              <Tag className="h-3.5 w-3.5" />
                              Req
                            </Link>
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" onClick={() => startEdit(item)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => void handleDelete(item.id)}>
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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
