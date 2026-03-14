'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { api } from '../../../lib/api';
import Breadcrumbs from '../../../components/breadcrumbs';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

function formatCurrency(amount: string | number | null, currency = 'USD') {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(pct, 100);
  const colorClass = pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full ${colorClass}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export default function BudgetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [budget, setBudget] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', totalAmount: '' });
  const [saving, setSaving] = useState(false);
  const [id, setId] = useState('');
  const [addPeriodOpen, setAddPeriodOpen] = useState(false);
  const [periodForm, setPeriodForm] = useState({ periodStart: '', periodEnd: '', allocatedAmount: '' });
  const [periodSaving, setPeriodSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      api.budgets
        .get(pid)
        .then((data) => {
          setBudget(data);
          setEditForm({ name: data.name, totalAmount: String(data.totalAmount) });
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.budgets.update(id, {
        name: editForm.name,
        totalAmount: parseFloat(editForm.totalAmount),
      });
      setBudget(updated);
      setEditing(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPeriod() {
    if (!periodForm.periodStart || !periodForm.periodEnd || !periodForm.allocatedAmount) return;
    setPeriodSaving(true);
    try {
      const updated = await api.budgets.addPeriod(id, {
        periodStart: periodForm.periodStart,
        periodEnd: periodForm.periodEnd,
        allocatedAmount: parseFloat(periodForm.allocatedAmount),
      });
      setBudget(updated);
      setAddPeriodOpen(false);
      setPeriodForm({ periodStart: '', periodEnd: '', allocatedAmount: '' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPeriodSaving(false);
    }
  }

  async function handleRemovePeriod(periodId: string) {
    if (!confirm('Remove this period?')) return;
    try {
      const updated = await api.budgets.removePeriod(id, periodId);
      setBudget(updated);
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading...</div>;
  if (!budget) return <div className="p-8 text-sm text-rose-700">Budget not found.</div>;

  const total = parseFloat(budget.totalAmount ?? '0');
  const spent = parseFloat(budget.spentAmount ?? '0');
  const remaining = total - spent;
  const pct = total > 0 ? (spent / total) * 100 : 0;

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs items={[{ label: 'Budgets', href: '/budgets' }, { label: budget.name }]} />
      <Link href="/budgets" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Budgets
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
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">{budget.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {budget.budgetType?.replace('_', ' ')} · FY{budget.fiscalYear} · {budget.currency}
          </p>
        </div>
        <Button variant={editing ? 'outline' : 'default'} onClick={() => setEditing(!editing)}>
          <Pencil className="h-4 w-4" />
          {editing ? 'Cancel' : 'Edit'}
        </Button>
      </div>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Edit Budget</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-foreground">Name</label>
              <Input value={editForm.name} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">Total Budget Amount</label>
              <Input type="number" min="0" step="0.01" value={editForm.totalAmount} onChange={(event) => setEditForm((current) => ({ ...current, totalAmount: event.target.value }))} />
            </div>
            <div className="md:col-span-2 flex gap-3">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: 'Total Budget', value: formatCurrency(total, budget.currency), tone: 'text-foreground' },
          { label: 'Spent', value: formatCurrency(spent, budget.currency), tone: pct > 90 ? 'text-rose-700' : 'text-muted-foreground' },
          { label: 'Remaining', value: formatCurrency(remaining, budget.currency), tone: remaining < 0 ? 'text-rose-700' : 'text-emerald-700' },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="space-y-2 p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{card.label}</div>
              <div className={`text-3xl font-semibold tracking-[-0.04em] ${card.tone}`}>{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>Budget Utilization</span>
            <span className={pct > 90 ? 'text-rose-700' : 'text-foreground'}>{pct.toFixed(1)}%</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ProgressBar pct={pct} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Budget Periods ({budget.periods?.length ?? 0})</CardTitle>
          <Button size="sm" onClick={() => setAddPeriodOpen(!addPeriodOpen)}>
            <Plus className="h-4 w-4" />
            {addPeriodOpen ? 'Cancel' : 'Add Period'}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {addPeriodOpen ? (
            <div className="grid gap-4 border-b border-border/70 bg-muted/20 p-5 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Period Start</label>
                <Input type="date" value={periodForm.periodStart} onChange={(event) => setPeriodForm((current) => ({ ...current, periodStart: event.target.value }))} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Period End</label>
                <Input type="date" value={periodForm.periodEnd} onChange={(event) => setPeriodForm((current) => ({ ...current, periodEnd: event.target.value }))} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Allocated Amount</label>
                <Input type="number" min="0" step="0.01" value={periodForm.allocatedAmount} onChange={(event) => setPeriodForm((current) => ({ ...current, allocatedAmount: event.target.value }))} placeholder="0.00" />
              </div>
              <div className="md:col-span-3">
                <Button onClick={handleAddPeriod} disabled={periodSaving}>
                  {periodSaving ? 'Adding...' : 'Add Period'}
                </Button>
              </div>
            </div>
          ) : null}

          {budget.periods && budget.periods.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Period Start</TableHead>
                  <TableHead>Period End</TableHead>
                  <TableHead>Allocated</TableHead>
                  <TableHead>Spent</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead>Utilization</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {budget.periods.map((period: any) => {
                  const alloc = parseFloat(period.allocatedAmount ?? period.amount ?? '0');
                  const periodSpent = parseFloat(period.spentAmount ?? '0');
                  const periodPct = alloc > 0 ? (periodSpent / alloc) * 100 : 0;
                  return (
                    <TableRow key={period.id}>
                      <TableCell className="text-muted-foreground">{new Date(period.periodStart).toLocaleDateString()}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(period.periodEnd).toLocaleDateString()}</TableCell>
                      <TableCell className="font-medium text-foreground">{formatCurrency(alloc, budget.currency)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatCurrency(periodSpent, budget.currency)}</TableCell>
                      <TableCell className={alloc - periodSpent < 0 ? 'text-rose-700' : 'text-emerald-700'}>
                        {formatCurrency(alloc - periodSpent, budget.currency)}
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <ProgressBar pct={periodPct} />
                          </div>
                          <span className="text-xs text-muted-foreground">{periodPct.toFixed(0)}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => handleRemovePeriod(period.id)}>
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">No budget periods. Add one above.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
