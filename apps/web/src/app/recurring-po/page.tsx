'use client';

import Link from 'next/link';
import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileClock,
  PauseCircle,
  PlayCircle,
  Plus,
  Repeat2,
  Rocket,
  Trash2,
  X,
} from 'lucide-react';
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
import { Textarea } from '../../components/ui/textarea';

interface RecurringPoLine {
  description: string;
  quantity: number;
  unitPrice: number;
  unitOfMeasure: string;
}

interface RecurringPo {
  id: string;
  title: string;
  description?: string;
  frequency: string;
  dayOfMonth?: number;
  nextRunAt: string;
  lastRunAt?: string;
  active: boolean;
  totalAmount: string;
  currency: string;
  lines: RecurringPoLine[];
  glAccount?: string;
  notes?: string;
  runCount: number;
  maxRuns?: number;
  vendor?: { id: string; name: string } | null;
  createdAt: string;
  upcomingRuns?: string[];
  historyCount?: number;
  recentHistory?: Array<{
    id: string;
    number: string;
    status: string;
    totalAmount: string;
    currency: string;
    createdAt: string;
  }>;
}

interface Vendor {
  id: string;
  name: string;
}

const FREQ_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annually',
};

const EMPTY_LINE: RecurringPoLine = { description: '', quantity: 1, unitPrice: 0, unitOfMeasure: 'each' };

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtCurrency(amount: string | number, currency = 'USD') {
  return Number(amount).toLocaleString('en-US', { style: 'currency', currency });
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`grid gap-2 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning';
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-emerald-50 text-emerald-700'
      : tone === 'warning'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-sky-50 text-sky-700';

  return (
    <Card className="rounded-lg border-border/70">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${toneClass}`}>{icon}</div>
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold tracking-[-0.03em] text-foreground">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="rounded-[28px] border-dashed border-border/80 bg-card/80">
      <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
          <Repeat2 className="h-8 w-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">
            No recurring schedules yet
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            Create a recurring purchase order schedule to automate repeat buys, preview upcoming runs,
            and keep generated draft POs tied back to the original cadence.
          </p>
        </div>
        <Button type="button" onClick={onCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          New Recurring PO
        </Button>
      </CardContent>
    </Card>
  );
}

export default function RecurringPoPage() {
  const [schedules, setSchedules] = useState<RecurringPo[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, RecurringPo>>({});

  const [form, setForm] = useState({
    title: '',
    description: '',
    vendorId: '',
    frequency: 'monthly' as 'weekly' | 'monthly' | 'quarterly' | 'annually',
    dayOfMonth: 1,
    currency: 'USD',
    glAccount: '',
    notes: '',
    maxRuns: '',
    startDate: '',
  });
  const [lines, setLines] = useState<RecurringPoLine[]>([{ ...EMPTY_LINE }]);

  useEffect(() => {
    void loadSchedules();
    api.vendors
      .list()
      .then((list: any[]) => setVendors(list as Vendor[]))
      .catch(() => {});
  }, []);

  async function loadSchedules() {
    setLoading(true);
    setError('');
    try {
      const data = await api.recurringPo.list();
      setSchedules(data as RecurringPo[]);
    } catch {
      setError('Failed to load recurring PO schedules.');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm({
      title: '',
      description: '',
      vendorId: '',
      frequency: 'monthly',
      dayOfMonth: 1,
      currency: 'USD',
      glAccount: '',
      notes: '',
      maxRuns: '',
      startDate: '',
    });
    setLines([{ ...EMPTY_LINE }]);
  }

  function closeModal() {
    setShowNew(false);
    resetForm();
    setError('');
  }

  async function handleCreate() {
    if (!form.title.trim()) {
      setError('Title is required.');
      return;
    }
    if (lines.some((line) => !line.description.trim())) {
      setError('All line items need a description.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
      await api.recurringPo.create({
        title: form.title,
        description: form.description || undefined,
        vendorId: form.vendorId || undefined,
        frequency: form.frequency,
        dayOfMonth: ['monthly', 'quarterly', 'annually'].includes(form.frequency) ? form.dayOfMonth : undefined,
        totalAmount: total,
        currency: form.currency,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitOfMeasure: line.unitOfMeasure,
        })),
        glAccount: form.glAccount || undefined,
        notes: form.notes || undefined,
        maxRuns: form.maxRuns ? Number(form.maxRuns) : undefined,
        startDate: form.startDate || undefined,
      });
      closeModal();
      await loadSchedules();
      showSuccess('Recurring PO schedule created.');
    } catch (e: any) {
      setError(e.message || 'Failed to create recurring PO.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(rpo: RecurringPo) {
    try {
      await api.recurringPo.update(rpo.id, { active: !rpo.active });
      await loadSchedules();
      if (expandedId === rpo.id) {
        await loadDetails(rpo.id, true);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to update schedule.');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this recurring PO schedule?')) return;
    try {
      await api.recurringPo.delete(id);
      await loadSchedules();
      if (expandedId === id) {
        setExpandedId(null);
      }
      showSuccess('Recurring PO schedule deleted.');
    } catch (e: any) {
      setError(e.message || 'Failed to delete schedule.');
    }
  }

  async function handleRunNow(id: string) {
    if (!confirm('Run this recurring PO now and create a draft purchase order?')) return;
    setRunningId(id);
    setError('');
    try {
      const result = await api.recurringPo.run(id);
      await loadSchedules();
      await loadDetails(id, true);
      showSuccess(`Draft PO created: ${result.purchaseOrderNumber}`);
    } catch (e: any) {
      setError(e.message || 'Failed to trigger run.');
    } finally {
      setRunningId(null);
    }
  }

  async function handleSkipNext(rpo: RecurringPo) {
    if (!confirm(`Skip the next scheduled run on ${fmtDate(rpo.nextRunAt)}?`)) return;
    setError('');
    try {
      const result = await api.recurringPo.skipNext(rpo.id);
      await loadSchedules();
      showSuccess(`Skipped ${fmtDate(result.skippedRunAt)}. Next run is now ${fmtDate(result.nextRunAt)}.`);
      if (expandedId === rpo.id) {
        await loadDetails(rpo.id, true);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to skip next run.');
    }
  }

  async function loadDetails(id: string, force = false) {
    if (!force && detailsById[id]) return;
    setDetailLoadingId(id);
    try {
      const detail = await api.recurringPo.get(id);
      setDetailsById((current) => ({ ...current, [id]: detail as RecurringPo }));
    } catch (e: any) {
      setError(e.message || 'Failed to load schedule details.');
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function toggleExpanded(id: string) {
    const nextExpanded = expandedId === id ? null : id;
    setExpandedId(nextExpanded);
    if (nextExpanded) {
      await loadDetails(id);
    }
  }

  function showSuccess(message: string) {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(''), 4000);
  }

  function addLine() {
    setLines((current) => [...current, { ...EMPTY_LINE }]);
  }

  function removeLine(index: number) {
    if (lines.length <= 1) return;
    setLines((current) => current.filter((_, lineIndex) => lineIndex !== index));
  }

  function updateLine(index: number, field: keyof RecurringPoLine, value: string | number) {
    setLines((current) => {
      const next = [...current];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  const computedTotal = useMemo(
    () => lines.reduce((sum, line) => sum + (line.quantity || 0) * (line.unitPrice || 0), 0),
    [lines],
  );

  const activeSchedules = schedules.filter((schedule) => schedule.active).length;
  const pausedSchedules = schedules.length - activeSchedules;
  const totalScheduledSpend = schedules.reduce((sum, schedule) => sum + Number(schedule.totalAmount || 0), 0);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Recurring Purchase Orders"
        description="Automate repeat purchases with schedule controls, upcoming run previews, and generated PO history."
        actions={
          <Button
            type="button"
            onClick={() => {
              setShowNew(true);
              setError('');
            }}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            New Recurring PO
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {successMsg ? (
        <Alert>
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={<Repeat2 className="h-5 w-5" />}
          label="Active Schedules"
          value={`${activeSchedules} active`}
          tone="success"
        />
        <StatCard
          icon={<PauseCircle className="h-5 w-5" />}
          label="Paused Schedules"
          value={`${pausedSchedules} paused`}
          tone="warning"
        />
        <StatCard
          icon={<CalendarClock className="h-5 w-5" />}
          label="Scheduled Spend"
          value={fmtCurrency(totalScheduledSpend)}
        />
      </section>

      {loading ? (
        <Card className="rounded-[28px]">
          <CardContent className="px-6 py-14 text-center text-sm text-muted-foreground">
            Loading recurring schedules...
          </CardContent>
        </Card>
      ) : schedules.length === 0 ? (
        <EmptyState
          onCreate={() => {
            setShowNew(true);
            setError('');
          }}
        />
      ) : (
        <Card className="overflow-hidden rounded-[28px] border-border/70 bg-card/95">
          <CardHeader className="border-b border-border/70 pb-4">
            <CardTitle className="text-xl tracking-[-0.03em]">Schedule inventory</CardTitle>
            <CardDescription>
              Pause, run, or inspect any recurring PO schedule without leaving the queue.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Title</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Runs</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => {
                  const paused = !schedule.active;
                  const expanded = expandedId === schedule.id;
                  const detail = detailsById[schedule.id];

                  return (
                    <Fragment key={schedule.id}>
                      <TableRow className={paused ? 'opacity-65' : undefined}>
                        <TableCell className="min-w-[240px]">
                          <div className="space-y-1">
                            <div className={`font-semibold ${paused ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                              {schedule.title}
                            </div>
                            {schedule.description ? (
                              <div className="text-sm text-muted-foreground">{schedule.description}</div>
                            ) : null}
                            {schedule.historyCount ? (
                              <div className="text-xs text-muted-foreground">
                                {schedule.historyCount} generated PO{schedule.historyCount === 1 ? '' : 's'}
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {schedule.vendor?.name || '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {FREQ_LABELS[schedule.frequency] ?? schedule.frequency}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium text-foreground">{fmtDate(schedule.nextRunAt)}</div>
                            {schedule.upcomingRuns && schedule.upcomingRuns.length > 1 ? (
                              <div className="text-xs text-muted-foreground">
                                +{Math.max(schedule.upcomingRuns.length - 1, 0)} more scheduled
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(schedule.lastRunAt)}</TableCell>
                        <TableCell className="font-medium text-foreground">
                          {schedule.runCount}
                          {schedule.maxRuns ? `/${schedule.maxRuns}` : ''}
                        </TableCell>
                        <TableCell className="font-semibold text-foreground">
                          {fmtCurrency(schedule.totalAmount, schedule.currency)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={paused ? 'warning' : 'success'}>{paused ? 'Paused' : 'Active'}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              className="gap-1.5"
                              disabled={!!runningId || paused}
                              onClick={() => handleRunNow(schedule.id)}
                            >
                              <Rocket className="h-3.5 w-3.5" />
                              {runningId === schedule.id ? 'Running...' : 'Run'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={paused}
                              onClick={() => handleSkipNext(schedule)}
                            >
                              Skip Next
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className={paused ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50' : 'border-amber-200 text-amber-700 hover:bg-amber-50'}
                              onClick={() => handleToggleActive(schedule)}
                            >
                              {paused ? (
                                <>
                                  <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
                                  Resume
                                </>
                              ) : (
                                <>
                                  <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
                                  Pause
                                </>
                              )}
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => void toggleExpanded(schedule.id)}>
                              {expanded ? (
                                <>
                                  <ChevronUp className="mr-1.5 h-3.5 w-3.5" />
                                  Hide
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
                                  Details
                                </>
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="border-rose-200 text-rose-700 hover:bg-rose-50"
                              onClick={() => handleDelete(schedule.id)}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expanded ? (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={9} className="p-5">
                            {detailLoadingId === schedule.id && !detail ? (
                              <div className="text-sm text-muted-foreground">Loading schedule details...</div>
                            ) : detail ? (
                              <div className="grid gap-5">
                                <div className="grid gap-4 xl:grid-cols-3">
                                  <StatCard
                                    icon={<Clock3 className="h-5 w-5" />}
                                    label="Next Run"
                                    value={fmtDate(detail.nextRunAt)}
                                  />
                                  <StatCard
                                    icon={<FileClock className="h-5 w-5" />}
                                    label="Last Run"
                                    value={fmtDate(detail.lastRunAt)}
                                  />
                                  <StatCard
                                    icon={<Repeat2 className="h-5 w-5" />}
                                    label="Generated POs"
                                    value={String(detail.historyCount ?? 0)}
                                    tone="success"
                                  />
                                </div>

                                <div className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
                                  <Card className="rounded-lg">
                                    <CardHeader>
                                      <CardTitle className="text-base">Upcoming runs</CardTitle>
                                      <CardDescription>Preview the next execution dates on this schedule.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="grid gap-3">
                                      {(detail.upcomingRuns ?? []).length === 0 ? (
                                        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                                          No future runs scheduled.
                                        </div>
                                      ) : (
                                        (detail.upcomingRuns ?? []).map((runAt, index) => (
                                          <div
                                            key={runAt}
                                            className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-background/80 px-4 py-3"
                                          >
                                            <div className="font-medium text-foreground">{fmtDate(runAt)}</div>
                                            <div className="text-xs text-muted-foreground">
                                              {index === 0 ? 'Next scheduled run' : `Run ${detail.runCount + index + 1}`}
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </CardContent>
                                  </Card>

                                  <Card className="rounded-lg">
                                    <CardHeader>
                                      <CardTitle className="text-base">Generated PO history</CardTitle>
                                      <CardDescription>Recent purchase orders created from this schedule.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="grid gap-3">
                                      {(detail.recentHistory ?? []).length === 0 ? (
                                        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                                          No purchase orders have been created from this schedule yet.
                                        </div>
                                      ) : (
                                        (detail.recentHistory ?? []).map((po) => (
                                          <div key={po.id} className="rounded-lg border border-border/70 bg-background/80 px-4 py-3">
                                            <div className="flex items-center justify-between gap-4">
                                              <Link
                                                href={`/purchase-orders/${po.id}`}
                                                className="font-semibold text-sky-700 transition-colors hover:text-sky-800"
                                              >
                                                {po.number}
                                              </Link>
                                              <span className="text-xs text-muted-foreground">{fmtDate(po.createdAt)}</span>
                                            </div>
                                            <div className="mt-2 flex items-center justify-between gap-4">
                                              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                                                {po.status}
                                              </span>
                                              <span className="font-medium text-foreground">
                                                {fmtCurrency(po.totalAmount, po.currency)}
                                              </span>
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </CardContent>
                                  </Card>
                                </div>
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {showNew ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 px-4 py-10"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-5xl rounded-[30px] border border-border/70 bg-card p-6 shadow-[0_30px_90px_-48px_rgba(15,23,42,0.55)] md:p-8"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">
                  New Recurring PO
                </h2>
                <p className="text-sm text-muted-foreground">
                  Define the vendor, cadence, and line items that should generate draft purchase orders automatically.
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={closeModal} aria-label="Close modal">
                <X className="h-5 w-5" />
              </Button>
            </div>

            {error ? (
              <Alert variant="destructive" className="mb-6">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-6">
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle className="text-base">Schedule configuration</CardTitle>
                  <CardDescription>Set the cadence, owner context, and schedule constraints.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <Field label="Title" className="md:col-span-2">
                    <Input
                      value={form.title}
                      onChange={(event) => setForm({ ...form, title: event.target.value })}
                      placeholder="Monthly Office Supplies"
                    />
                  </Field>
                  <Field label="Description" className="md:col-span-2">
                    <Textarea
                      value={form.description}
                      onChange={(event) => setForm({ ...form, description: event.target.value })}
                      placeholder="Optional notes for why this schedule exists."
                      className="min-h-[96px]"
                    />
                  </Field>
                  <Field label="Vendor">
                    <Select value={form.vendorId} onChange={(event) => setForm({ ...form, vendorId: event.target.value })}>
                      <option value="">None</option>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Currency">
                    <Select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="CAD">CAD</option>
                    </Select>
                  </Field>
                  <Field label="Frequency">
                    <Select
                      value={form.frequency}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          frequency: event.target.value as 'weekly' | 'monthly' | 'quarterly' | 'annually',
                        })
                      }
                    >
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annually">Annually</option>
                    </Select>
                  </Field>
                  {['monthly', 'quarterly', 'annually'].includes(form.frequency) ? (
                    <Field label="Day of Month">
                      <Input
                        type="number"
                        min={1}
                        max={28}
                        value={form.dayOfMonth}
                        onChange={(event) => setForm({ ...form, dayOfMonth: Number(event.target.value) })}
                      />
                    </Field>
                  ) : null}
                  <Field label="First Run Date">
                    <Input
                      type="date"
                      value={form.startDate}
                      onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                    />
                  </Field>
                  <Field label="Max Runs">
                    <Input
                      type="number"
                      min={1}
                      value={form.maxRuns}
                      onChange={(event) => setForm({ ...form, maxRuns: event.target.value })}
                      placeholder="Unlimited"
                    />
                  </Field>
                  <Field label="GL Account">
                    <Input
                      value={form.glAccount}
                      onChange={(event) => setForm({ ...form, glAccount: event.target.value })}
                      placeholder="6200"
                    />
                  </Field>
                  <Field label="Notes" className="md:col-span-2">
                    <Textarea
                      value={form.notes}
                      onChange={(event) => setForm({ ...form, notes: event.target.value })}
                      placeholder="Internal notes for approvers or finance."
                    />
                  </Field>
                </CardContent>
              </Card>

              <Card className="rounded-lg">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base">Line items</CardTitle>
                    <CardDescription>These lines will be copied into each generated draft PO.</CardDescription>
                  </div>
                  <Button type="button" variant="outline" onClick={addLine} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add Line
                  </Button>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {lines.map((line, index) => (
                    <div
                      key={index}
                      className="grid gap-3 rounded-[22px] border border-border/70 bg-background/70 p-4 md:grid-cols-[2.4fr_0.8fr_0.95fr_0.9fr_auto]"
                    >
                      <Field label="Description">
                        <Input
                          value={line.description}
                          onChange={(event) => updateLine(index, 'description', event.target.value)}
                          placeholder="Item description"
                        />
                      </Field>
                      <Field label="Qty">
                        <Input
                          type="number"
                          min={0.01}
                          step={0.01}
                          value={line.quantity}
                          onChange={(event) => updateLine(index, 'quantity', Number(event.target.value))}
                        />
                      </Field>
                      <Field label="Unit Price">
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={line.unitPrice}
                          onChange={(event) => updateLine(index, 'unitPrice', Number(event.target.value))}
                        />
                      </Field>
                      <Field label="UOM">
                        <Input
                          value={line.unitOfMeasure}
                          onChange={(event) => updateLine(index, 'unitOfMeasure', event.target.value)}
                          placeholder="each"
                        />
                      </Field>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="outline"
                          className="border-rose-200 text-rose-700 hover:bg-rose-50"
                          disabled={lines.length === 1}
                          onClick={() => removeLine(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-end rounded-lg bg-muted/35 px-4 py-3 text-sm">
                    <span className="font-semibold text-foreground">Total: {fmtCurrency(computedTotal, form.currency)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="button" onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating...' : 'Create Schedule'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
