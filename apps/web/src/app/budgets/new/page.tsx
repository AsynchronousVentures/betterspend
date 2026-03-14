'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { api } from '../../../lib/api';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';

const CURRENT_YEAR = new Date().getFullYear();

export default function NewBudgetPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [form, setForm] = useState({
    name: '',
    fiscalYear: String(CURRENT_YEAR),
    totalAmount: '',
    currency: 'USD',
    exchangeRate: '1',
    budgetType: 'department',
    departmentId: '',
    projectId: '',
    glAccount: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.departments.list(), api.projects.list(), api.exchangeRates.getBaseCurrency()])
      .then(([departmentRows, projectRows, org]) => {
        setDepartments(departmentRows);
        setProjects(projectRows);
        const currency = org?.baseCurrency || 'USD';
        setBaseCurrency(currency);
        setForm((current) => ({ ...current, currency }));
      })
      .catch(() => {});
  }, []);

  function set(key: string, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const parsedYear = parseInt(form.fiscalYear, 10);
    const parsedAmount = parseFloat(form.totalAmount);
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      setError('Invalid amount');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        fiscalYear: parsedYear,
        totalAmount: parsedAmount,
        currency: form.currency.trim().toUpperCase() || 'USD',
        exchangeRate: parseFloat(form.exchangeRate || '1') || 1,
      };
      if (form.budgetType === 'department' && form.departmentId) payload.departmentId = form.departmentId;
      else if (form.budgetType === 'project' && form.projectId) payload.projectId = form.projectId;
      else if (form.budgetType === 'gl_account' && form.glAccount) payload.glAccount = form.glAccount;

      await api.budgets.create(payload);
      router.push('/budgets');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Link href="/budgets" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Budgets
      </Link>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">New Budget</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <section className="space-y-4">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Budget Details</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-foreground">Name *</label>
                  <Input required value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="e.g. Engineering FY2026" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Fiscal Year *</label>
                  <Input required type="number" min={2000} max={2100} value={form.fiscalYear} onChange={(event) => set('fiscalYear', event.target.value)} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Total Amount *</label>
                  <Input required type="number" min={0} step="any" value={form.totalAmount} onChange={(event) => set('totalAmount', event.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Currency</label>
                  <Input maxLength={3} value={form.currency} onChange={(event) => set('currency', event.target.value.toUpperCase())} />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Exchange Rate to {baseCurrency}</label>
                  <Input type="number" min="0" step="0.000001" value={form.exchangeRate} onChange={(event) => set('exchangeRate', event.target.value)} />
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                Budget base currency is {baseCurrency}. Use `1` when the budget is already denominated in {baseCurrency}.
              </div>
            </section>

            <section className="space-y-4">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Budget Scope</div>
              <div className="grid gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Budget Type *</label>
                  <Select value={form.budgetType} onChange={(event) => set('budgetType', event.target.value)} className="w-full">
                    <option value="department">Department</option>
                    <option value="project">Project</option>
                    <option value="gl_account">GL Account</option>
                  </Select>
                </div>

                {form.budgetType === 'department' ? (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Department</label>
                    <Select value={form.departmentId} onChange={(event) => set('departmentId', event.target.value)} className="w-full">
                      <option value="">Select department...</option>
                      {departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name} ({department.code})
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}

                {form.budgetType === 'project' ? (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Project</label>
                    <Select value={form.projectId} onChange={(event) => set('projectId', event.target.value)} className="w-full">
                      <option value="">Select project...</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name} ({project.code})
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}

                {form.budgetType === 'gl_account' ? (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">GL Account Code</label>
                    <Input value={form.glAccount} onChange={(event) => set('glAccount', event.target.value)} placeholder="e.g. 6000" />
                  </div>
                ) : null}
              </div>
            </section>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={submitting}>
                <Plus className="h-4 w-4" />
                {submitting ? 'Saving...' : 'Create Budget'}
              </Button>
              <Button asChild variant="outline">
                <Link href="/budgets">Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
