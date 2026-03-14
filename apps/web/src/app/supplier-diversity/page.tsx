'use client';

import { useEffect, useState } from 'react';
import { Leaf, ShieldCheck, Sprout, Users2 } from 'lucide-react';
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

const DIVERSITY_LABELS: Record<string, string> = {
  minority_owned: 'Minority-Owned',
  women_owned: 'Women-Owned',
  veteran_owned: 'Veteran-Owned',
  small_business: 'Small Business',
  lgbtq_owned: 'LGBTQ+-Owned',
  disability_owned: 'Disability-Owned',
  hub_zone: 'HUBZone',
  indigenous_owned: 'Indigenous-Owned',
};

const ESG_COLORS: Record<string, string> = {
  'A+': 'border-emerald-200 bg-emerald-100 text-emerald-800',
  A: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  'B+': 'border-sky-200 bg-sky-100 text-sky-800',
  B: 'border-sky-200 bg-sky-100 text-sky-800',
  C: 'border-amber-200 bg-amber-100 text-amber-800',
  D: 'border-rose-200 bg-rose-100 text-rose-800',
};

const CERT_LABELS: Record<string, string> = {
  iso14001: 'ISO 14001',
  b_corp: 'B Corp',
  fair_trade: 'Fair Trade',
  fsc: 'FSC Certified',
  leed: 'LEED',
  energy_star: 'Energy Star',
};

export default function SupplierDiversityPage() {
  const [summary, setSummary] = useState<any>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [sum, vendorList] = await Promise.all([
        fetch('/api/v1/vendors/diversity/summary', {
          headers: { 'x-org-id': '00000000-0000-0000-0000-000000000001' },
        }).then((response) => response.json()),
        api.vendors.list(),
      ]);
      setSummary(sum);
      setVendors(vendorList as any[]);
    } catch {
      setMessage('Failed to load supplier diversity data.');
    } finally {
      setLoading(false);
    }
  }

  function startEdit(vendor: any) {
    setEditingId(vendor.id);
    setEditForm({
      diversityCategories: (vendor.diversityCategories as string[]) ?? [],
      esgRating: vendor.esgRating ?? '',
      carbonFootprintTons: vendor.carbonFootprintTons ?? '',
      sustainabilityCertifications: (vendor.sustainabilityCertifications as string[]) ?? [],
      esgNotes: vendor.esgNotes ?? '',
    });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      await fetch(`/api/v1/vendors/${id}/esg`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': '00000000-0000-0000-0000-000000000001',
        },
        body: JSON.stringify({
          ...editForm,
          esgRating: editForm.esgRating || undefined,
          carbonFootprintTons: editForm.carbonFootprintTons || undefined,
        }),
      });
      setEditingId(null);
      setMessage('ESG data saved.');
      load();
    } catch {
      setMessage('Save failed.');
    } finally {
      setSaving(false);
    }
  }

  function toggleCategory(category: string) {
    const categories: string[] = editForm.diversityCategories ?? [];
    setEditForm({
      ...editForm,
      diversityCategories: categories.includes(category)
        ? categories.filter((current: string) => current !== category)
        : [...categories, category],
    });
  }

  function toggleCertification(certification: string) {
    const certs: string[] = editForm.sustainabilityCertifications ?? [];
    setEditForm({
      ...editForm,
      sustainabilityCertifications: certs.includes(certification)
        ? certs.filter((current: string) => current !== certification)
        : [...certs, certification],
    });
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Supplier Diversity & ESG"
        description="Track diversity certifications, ESG ratings, and sustainability signals across the vendor base."
        actions={
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <Leaf className="h-4 w-4" />
            Supplier insights
          </div>
        }
      />

      {message ? (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {summary && !loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Users2} label="Total Vendors" value={String(summary.totalVendors)} tone="text-sky-700" />
          <StatCard icon={Sprout} label="Diverse Suppliers" value={String(summary.diverseVendors)} tone="text-violet-700" />
          <StatCard icon={ShieldCheck} label="Diversity Rate" value={`${summary.diversityRate}%`} tone="text-emerald-700" />
          <StatCard icon={Leaf} label="ESG Rated" value={String(summary.esgRatedVendors)} tone="text-amber-700" />
        </div>
      ) : null}

      {summary && Object.keys(summary.diversityBreakdown ?? {}).length > 0 ? (
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Diversity Category Breakdown</CardTitle>
            <CardDescription>High-level distribution of registered diverse supplier categories.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {Object.entries(summary.diversityBreakdown).map(([category, count]: any) => (
                <Badge
                  key={category}
                  variant="outline"
                  className="gap-2 border-violet-200 bg-violet-50 px-3 py-1 text-violet-800"
                >
                  {DIVERSITY_LABELS[category] ?? category}
                  <span className="rounded-full bg-violet-700 px-2 py-0.5 text-[10px] font-bold text-white">
                    {count}
                  </span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">All Vendors</CardTitle>
          <CardDescription>Maintain diversity categories, ESG scores, certifications, and carbon disclosures by vendor.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Diversity Categories</TableHead>
                  <TableHead>ESG Rating</TableHead>
                  <TableHead>Certifications</TableHead>
                  <TableHead>Carbon (tons/yr)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((vendor) => {
                  const categories = (vendor.diversityCategories as string[]) ?? [];
                  const certs = (vendor.sustainabilityCertifications as string[]) ?? [];
                  const isEditing = editingId === vendor.id;
                  return (
                    <TableRow key={vendor.id}>
                      <TableCell className="font-medium text-foreground">{vendor.name}</TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="flex flex-wrap gap-2">
                            {Object.keys(DIVERSITY_LABELS).map((category) => (
                              <button
                                key={category}
                                type="button"
                                onClick={() => toggleCategory(category)}
                                className={`rounded-full border px-3 py-1 text-xs ${
                                  editForm.diversityCategories?.includes(category)
                                    ? 'border-violet-700 bg-violet-700 text-white'
                                    : 'border-border/70 bg-muted/20 text-muted-foreground'
                                }`}
                              >
                                {DIVERSITY_LABELS[category]}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {categories.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              categories.map((category) => (
                                <Badge
                                  key={category}
                                  variant="outline"
                                  className="border-violet-200 bg-violet-50 text-violet-800"
                                >
                                  {DIVERSITY_LABELS[category] ?? category}
                                </Badge>
                              ))
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Select
                            value={editForm.esgRating}
                            onChange={(event) =>
                              setEditForm({ ...editForm, esgRating: event.target.value })
                            }
                            className="w-full"
                          >
                            <option value="">Not Rated</option>
                            {['A+', 'A', 'B+', 'B', 'C', 'D'].map((rating) => (
                              <option key={rating}>{rating}</option>
                            ))}
                          </Select>
                        ) : vendor.esgRating ? (
                          <Badge
                            variant="outline"
                            className={ESG_COLORS[vendor.esgRating] ?? 'border-slate-200 bg-slate-100 text-slate-700'}
                          >
                            {vendor.esgRating}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="flex flex-wrap gap-2">
                            {Object.keys(CERT_LABELS).map((certification) => (
                              <button
                                key={certification}
                                type="button"
                                onClick={() => toggleCertification(certification)}
                                className={`rounded-full border px-3 py-1 text-xs ${
                                  editForm.sustainabilityCertifications?.includes(certification)
                                    ? 'border-emerald-700 bg-emerald-700 text-white'
                                    : 'border-border/70 bg-muted/20 text-muted-foreground'
                                }`}
                              >
                                {CERT_LABELS[certification]}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {certs.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              certs.map((certification) => (
                                <Badge
                                  key={certification}
                                  variant="outline"
                                  className="border-emerald-200 bg-emerald-50 text-emerald-800"
                                >
                                  {CERT_LABELS[certification] ?? certification}
                                </Badge>
                              ))
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            type="number"
                            value={editForm.carbonFootprintTons}
                            onChange={(event) =>
                              setEditForm({
                                ...editForm,
                                carbonFootprintTons: event.target.value,
                              })
                            }
                            className="w-28"
                            placeholder="0"
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {vendor.carbonFootprintTons ?? '—'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => saveEdit(vendor.id)}
                              disabled={saving}
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button type="button" size="sm" variant="outline" onClick={() => startEdit(vendor)}>
                            Edit ESG
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <Card className="rounded-[24px]">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
          <div className="rounded-full border border-border/70 bg-muted/30 p-2">
            <Icon className="h-4 w-4 text-foreground" />
          </div>
        </div>
        <div className={`text-3xl font-semibold tracking-[-0.03em] ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
