'use client';

import { useEffect, useState } from 'react';
import { Building2, Pencil, Plus, Rows3, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

const EMPTY_FORM = {
  name: '',
  code: '',
  currency: 'USD',
  glAccountPrefix: '',
  taxId: '',
};

export default function EntitiesPage() {
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  async function load() {
    setLoading(true);
    try {
      setEntities(await api.entities.list(true));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function setField(key: keyof typeof EMPTY_FORM, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await api.entities.update(editingId, form);
      } else {
        await api.entities.create(form);
      }
      resetForm();
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(id: string) {
    try {
      await api.entities.remove(id);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Entities"
        description="Manage legal entities, subsidiaries, and divisions inside one BetterSpend org."
        actions={
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <Building2 className="h-4 w-4" />
            {entities.length} configured
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.9fr)]">
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">{editingId ? 'Edit entity' : 'Add entity'}</CardTitle>
            <CardDescription>Set the legal code, currency, GL prefix, and tax identity for each operating entity.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <div className="md:col-span-2 xl:col-span-1">
                  <label className="mb-2 block text-sm font-medium text-foreground">Entity name</label>
                  <Input required value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder="Acme Holdings LLC" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Code</label>
                  <Input required value={form.code} onChange={(event) => setField('code', event.target.value.toUpperCase())} placeholder="ACME-US" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Currency</label>
                  <Input required value={form.currency} onChange={(event) => setField('currency', event.target.value.toUpperCase())} placeholder="USD" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">GL account prefix</label>
                  <Input value={form.glAccountPrefix} onChange={(event) => setField('glAccountPrefix', event.target.value)} placeholder="1000" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Tax ID</label>
                  <Input value={form.taxId} onChange={(event) => setField('taxId', event.target.value)} placeholder="12-3456789" />
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={saving}>
                  <Plus className="h-4 w-4" />
                  {saving ? 'Saving...' : editingId ? 'Update Entity' : 'Add Entity'}
                </Button>
                {editingId ? (
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-[24px]">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-xl">Entity registry</CardTitle>
              <CardDescription>Review active entities, archive old ones, and jump into edits without leaving the list.</CardDescription>
            </div>
            <div className="hidden items-center gap-2 rounded-full bg-muted/60 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground md:inline-flex">
              <Rows3 className="h-4 w-4" />
              {loading ? 'Loading' : `${entities.length} rows`}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                Loading entities...
              </div>
            ) : entities.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                No entities created yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>GL Prefix</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entities.map((entity) => (
                    <TableRow key={entity.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{entity.name}</div>
                      </TableCell>
                      <TableCell>
                        <code className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">{entity.code}</code>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{entity.currency}</TableCell>
                      <TableCell className="text-muted-foreground">{entity.glAccountPrefix ?? '—'}</TableCell>
                      <TableCell>
                        <StatusBadge value={entity.isActive ? 'active' : 'inactive'} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingId(entity.id);
                              setForm({
                                name: entity.name ?? '',
                                code: entity.code ?? '',
                                currency: entity.currency ?? 'USD',
                                glAccountPrefix: entity.glAccountPrefix ?? '',
                                taxId: entity.taxId ?? '',
                              });
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          {entity.isActive ? (
                            <Button type="button" variant="outline" size="sm" onClick={() => handleArchive(entity.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                              Archive
                            </Button>
                          ) : null}
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
    </div>
  );
}
