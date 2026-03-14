'use client';

import { useEffect, useMemo, useState } from 'react';
import { Percent, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

interface TaxCode {
  id: string;
  name: string;
  code: string;
  ratePercent: string;
  taxType: 'VAT' | 'GST' | 'SALES_TAX' | 'EXEMPT';
  isRecoverable: boolean;
  glAccountCode?: string | null;
}

const DEFAULT_FORM = {
  name: '',
  code: '',
  ratePercent: '0',
  taxType: 'VAT' as TaxCode['taxType'],
  isRecoverable: true,
  glAccountCode: '',
};

export default function TaxCodesPage() {
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const records = await api.taxCodes.list();
    setTaxCodes(Array.isArray(records) ? records : []);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const formTitle = useMemo(() => (editingId ? 'Update Tax Code' : 'Create Tax Code'), [editingId]);

  function setField(key: keyof typeof DEFAULT_FORM, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        name: form.name,
        code: form.code.toUpperCase(),
        ratePercent: parseFloat(form.ratePercent || '0'),
        taxType: form.taxType,
        isRecoverable: form.isRecoverable,
        glAccountCode: form.glAccountCode || undefined,
      };

      if (editingId) {
        await api.taxCodes.update(editingId, payload);
        setMessage('Tax code updated.');
      } else {
        await api.taxCodes.create(payload);
        setMessage('Tax code created.');
      }

      setForm(DEFAULT_FORM);
      setEditingId(null);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to save tax code');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setError('');
    setMessage('');
    try {
      await api.taxCodes.remove(id);
      if (editingId === id) {
        setEditingId(null);
        setForm(DEFAULT_FORM);
      }
      setMessage('Tax code removed.');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to delete tax code');
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Tax Codes"
        description="Define recoverable and non-recoverable tax treatments for purchase orders, invoice matching, and budget impact calculations."
        actions={
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <Percent className="h-4 w-4" />
            {taxCodes.length} configured
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert variant="success">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)]">
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">{editingId ? 'Edit tax code' : 'Create tax code'}</CardTitle>
            <CardDescription>Capture the rate, tax type, GL mapping, and whether tax should consume budget or stay net-only.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Name</label>
                  <Input required value={form.name} onChange={(event) => setField('name', event.target.value)} />
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Code</label>
                    <Input required value={form.code} onChange={(event) => setField('code', event.target.value.toUpperCase())} />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Rate %</label>
                    <Input required type="number" min="0" step="0.01" value={form.ratePercent} onChange={(event) => setField('ratePercent', event.target.value)} />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Tax type</label>
                    <Select value={form.taxType} onChange={(event) => setField('taxType', event.target.value as TaxCode['taxType'])} className="w-full">
                      <option value="VAT">VAT</option>
                      <option value="GST">GST</option>
                      <option value="SALES_TAX">Sales Tax</option>
                      <option value="EXEMPT">Exempt</option>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">GL account</label>
                    <Input value={form.glAccountCode} onChange={(event) => setField('glAccountCode', event.target.value)} />
                  </div>
                </div>
                <label className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-foreground">
                  <input type="checkbox" checked={form.isRecoverable} onChange={(event) => setField('isRecoverable', event.target.checked)} />
                  Recoverable for budget consumption
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={saving}>
                  <Plus className="h-4 w-4" />
                  {saving ? 'Saving...' : formTitle}
                </Button>
                {editingId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingId(null);
                      setForm(DEFAULT_FORM);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Tax code library</CardTitle>
            <CardDescription>Keep tax treatment readable for finance ops and ensure downstream matching uses the right budget and ledger assumptions.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {taxCodes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                No tax codes yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Budget Impact</TableHead>
                    <TableHead>GL</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taxCodes.map((taxCode) => (
                    <TableRow key={taxCode.id}>
                      <TableCell>
                        <code className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-foreground">{taxCode.code}</code>
                      </TableCell>
                      <TableCell className="font-medium text-foreground">{taxCode.name}</TableCell>
                      <TableCell className="text-muted-foreground">{taxCode.ratePercent}%</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-border/80 bg-muted/40 text-muted-foreground">
                          {taxCode.taxType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={taxCode.isRecoverable ? 'success' : 'warning'}>
                          {taxCode.isRecoverable ? 'Net only' : 'Gross incl. tax'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{taxCode.glAccountCode || '—'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingId(taxCode.id);
                              setForm({
                                name: taxCode.name,
                                code: taxCode.code,
                                ratePercent: String(taxCode.ratePercent),
                                taxType: taxCode.taxType,
                                isRecoverable: taxCode.isRecoverable,
                                glAccountCode: taxCode.glAccountCode || '',
                              });
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => handleDelete(taxCode.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
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
    </div>
  );
}
