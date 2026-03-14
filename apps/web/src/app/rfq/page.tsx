'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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
import { Textarea } from '../../components/ui/textarea';

interface RfqSummary {
  id: string;
  number: string;
  title: string;
  status: string;
  dueDate?: string;
  currency: string;
  createdAt: string;
  requester?: { name: string; email: string };
  awardedVendor?: { id: string; name: string };
  invitationCount: number;
  responseCount: number;
}

interface Vendor {
  id: string;
  name: string;
}

function statusVariant(status: string) {
  if (status === 'awarded') return 'success';
  if (status === 'open') return 'outline';
  if (status === 'draft') return 'warning';
  if (status === 'cancelled') return 'destructive';
  return 'secondary';
}

function formatMoney(amount: string | number, currency = 'USD') {
  return Number(amount).toLocaleString('en-US', { style: 'currency', currency });
}

export default function RfqPage() {
  const [rfqs, setRfqs] = useState<RfqSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'responses'>('overview');
  const [responseSort, setResponseSort] = useState<'price' | 'supplier' | 'delivery'>('price');
  const [rejectDrafts, setRejectDrafts] = useState<Record<string, string>>({});
  const [awardingId, setAwardingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    dueDate: '',
    notes: '',
    currency: 'USD',
  });
  const [lines, setLines] = useState([
    { description: '', quantity: 1, unitOfMeasure: 'each', targetPrice: '' },
  ]);
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    void loadRfqs();
    api.vendors.list().then((v: any[]) => setVendors(v)).catch(() => {});
  }, []);

  async function loadRfqs() {
    setLoading(true);
    try {
      const data = await (api as any).rfq.list();
      setRfqs(data);
    } catch {
      setError('Failed to load RFQs');
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: string) {
    setSelected(id);
    setDetailLoading(true);
    setDetailTab('overview');
    try {
      const data = await (api as any).rfq.get(id);
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function showSuccess(message: string) {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(''), 4500);
  }

  async function handleCreate() {
    if (!form.title || lines.some((line) => !line.description || !line.quantity)) {
      setError('Title and at least one line item are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await (api as any).rfq.create({
        ...form,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitOfMeasure: line.unitOfMeasure,
          targetPrice: line.targetPrice ? Number(line.targetPrice) : undefined,
        })),
        vendorIds: selectedVendors,
      });
      setShowNew(false);
      setForm({ title: '', description: '', dueDate: '', notes: '', currency: 'USD' });
      setLines([{ description: '', quantity: 1, unitOfMeasure: 'each', targetPrice: '' }]);
      setSelectedVendors([]);
      await loadRfqs();
      showSuccess('RFQ created');
    } catch {
      setError('Failed to create RFQ');
    } finally {
      setSaving(false);
    }
  }

  async function handleOpen(id: string) {
    try {
      await (api as any).rfq.open(id);
      await loadRfqs();
      if (selected === id) await loadDetail(id);
    } catch {
      setError('Failed to open RFQ');
    }
  }

  async function handleClose(id: string) {
    try {
      await (api as any).rfq.close(id);
      await loadRfqs();
      if (selected === id) await loadDetail(id);
    } catch {
      setError('Failed to close RFQ');
    }
  }

  async function handleAward(responseId: string) {
    if (!detail) return;
    if (!window.confirm('Award this response and create a draft purchase order from it?')) return;
    setAwardingId(responseId);
    setError('');
    try {
      const result = await (api as any).rfq.award(detail.id, responseId);
      setDetail(result.rfq);
      await loadRfqs();
      showSuccess(`Awarded response and created draft PO ${result.purchaseOrderNumber}.`);
    } catch (e: any) {
      setError(e.message || 'Failed to award response');
    } finally {
      setAwardingId(null);
    }
  }

  async function handleReject(responseId: string) {
    if (!detail) return;
    const reason = rejectDrafts[responseId]?.trim();
    if (!reason) {
      setError('A rejection reason is required');
      return;
    }
    setRejectingId(responseId);
    setError('');
    try {
      const result = await (api as any).rfq.reject(detail.id, responseId, reason);
      setDetail(result);
      await loadRfqs();
      setRejectDrafts((current) => ({ ...current, [responseId]: '' }));
      showSuccess('Response rejected');
    } catch (e: any) {
      setError(e.message || 'Failed to reject response');
    } finally {
      setRejectingId(null);
    }
  }

  const addLine = () =>
    setLines([...lines, { description: '', quantity: 1, unitOfMeasure: 'each', targetPrice: '' }]);
  const removeLine = (index: number) => setLines(lines.filter((_, idx) => idx !== index));

  const sortedResponses = detail?.responses
    ? [...detail.responses].sort((a: any, b: any) => {
        if (responseSort === 'supplier') return (a.vendor?.name ?? '').localeCompare(b.vendor?.name ?? '');
        if (responseSort === 'delivery') {
          const aLead = Math.min(
            ...(a.lines ?? []).map((line: any) => line.leadTimeDays ?? Number.MAX_SAFE_INTEGER),
          );
          const bLead = Math.min(
            ...(b.lines ?? []).map((line: any) => line.leadTimeDays ?? Number.MAX_SAFE_INTEGER),
          );
          return aLead - bLead;
        }
        return Number(a.totalAmount) - Number(b.totalAmount);
      })
    : [];

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="RFQ / e-Sourcing"
        description="Invite vendors to compete, compare responses, and convert awarded quotes into draft purchase orders."
        actions={
          <Button type="button" onClick={() => setShowNew(true)}>
            New RFQ
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {successMsg ? (
        <Alert variant="success">
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div>
          {loading ? (
            <Card className="rounded-lg">
              <CardContent className="px-6 py-12 text-center text-sm text-muted-foreground">
                Loading...
              </CardContent>
            </Card>
          ) : rfqs.length === 0 ? (
            <Card className="rounded-lg">
              <CardContent className="px-6 py-12 text-center">
                <div className="text-base font-medium text-foreground">No RFQs yet</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Create one to start sourcing competitively.
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {rfqs.map((rfq) => (
                <Card
                  key={rfq.id}
                  className={`cursor-pointer rounded-lg transition-colors ${
                    selected === rfq.id ? 'border-primary shadow-lg' : ''
                  }`}
                  onClick={() => void loadDetail(rfq.id)}
                >
                  <CardContent className="space-y-3 p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-xs text-muted-foreground">{rfq.number}</span>
                      <Badge variant={statusVariant(rfq.status) as any}>{rfq.status.toUpperCase()}</Badge>
                      {rfq.dueDate ? (
                        <span className="ml-auto text-xs text-muted-foreground">
                          Due: {new Date(rfq.dueDate).toLocaleDateString()}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-base font-semibold text-foreground">{rfq.title}</div>
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span>{rfq.invitationCount} vendors invited</span>
                      <span>{rfq.responseCount} responses</span>
                      {rfq.awardedVendor ? (
                        <span className="font-semibold text-emerald-700">
                          Awarded: {rfq.awardedVendor.name}
                        </span>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {selected ? (
          <Card className="rounded-lg">
            <CardContent className="max-h-[80vh] space-y-4 overflow-y-auto p-5">
              {detailLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Loading...</div>
              ) : detail ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-xs text-muted-foreground">{detail.number}</div>
                      <div className="mt-1 text-xl font-semibold text-foreground">{detail.title}</div>
                    </div>
                    <Button type="button" variant="ghost" onClick={() => { setSelected(null); setDetail(null); }}>
                      Close
                    </Button>
                  </div>

                  {detail.description ? (
                    <p className="text-sm text-muted-foreground">{detail.description}</p>
                  ) : null}

                  <div className="flex flex-wrap gap-3">
                    {detail.status === 'draft' ? (
                      <Button type="button" onClick={() => void handleOpen(detail.id)}>
                        Open for Bids
                      </Button>
                    ) : null}
                    {detail.status === 'open' ? (
                      <Button type="button" variant="outline" onClick={() => void handleClose(detail.id)}>
                        Close RFQ
                      </Button>
                    ) : null}
                  </div>

                  <div className="flex gap-2">
                    {[
                      { key: 'overview', label: 'Overview' },
                      { key: 'responses', label: `Responses (${detail.responses?.length ?? 0})` },
                    ].map((tab) => (
                      <Button
                        key={tab.key}
                        type="button"
                        size="sm"
                        variant={detailTab === tab.key ? 'default' : 'outline'}
                        onClick={() => setDetailTab(tab.key as 'overview' | 'responses')}
                      >
                        {tab.label}
                      </Button>
                    ))}
                  </div>

                  {detailTab === 'overview' ? (
                    <div className="space-y-5">
                      <div>
                        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Line Items ({detail.lines?.length ?? 0})
                        </div>
                        <div className="space-y-2">
                          {detail.lines?.map((line: any, index: number) => (
                            <div key={line.id} className="flex justify-between rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm">
                              <span className="text-foreground">
                                {index + 1}. {line.description}
                              </span>
                              <span className="text-muted-foreground">
                                {line.quantity} {line.unitOfMeasure}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Invited Vendors ({detail.invitations?.length ?? 0})
                        </div>
                        <div className="space-y-2">
                          {detail.invitations?.map((invitation: any) => (
                            <div key={invitation.id} className="flex items-center justify-between rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm">
                              <span className="text-foreground">{invitation.vendor?.name ?? '—'}</span>
                              <span className={invitation.respondedAt ? 'text-emerald-700' : 'text-muted-foreground'}>
                                {invitation.respondedAt ? 'Responded' : 'Pending'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Evaluate Responses ({sortedResponses.length})
                        </div>
                        <Select
                          value={responseSort}
                          onChange={(event) =>
                            setResponseSort(event.target.value as 'price' | 'supplier' | 'delivery')
                          }
                          className="w-40"
                        >
                          <option value="price">Sort by price</option>
                          <option value="supplier">Sort by supplier</option>
                          <option value="delivery">Sort by delivery</option>
                        </Select>
                      </div>

                      {sortedResponses.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No responses received yet.</div>
                      ) : (
                        sortedResponses.map((response: any, index: number) => {
                          const bestPrice = Math.min(...sortedResponses.map((item: any) => Number(item.totalAmount)));
                          const responseLead = Math.min(
                            ...(response.lines ?? []).map((line: any) => line.leadTimeDays ?? Number.MAX_SAFE_INTEGER),
                          );
                          const bestLead = Math.min(
                            ...sortedResponses.map((item: any) =>
                              Math.min(...(item.lines ?? []).map((line: any) => line.leadTimeDays ?? Number.MAX_SAFE_INTEGER)),
                            ),
                          );
                          const priceScore =
                            bestPrice > 0
                              ? Math.max(0, 100 - (((Number(response.totalAmount) - bestPrice) / bestPrice) * 100))
                              : 100;
                          const deliveryScore =
                            Number.isFinite(responseLead) && Number.isFinite(bestLead)
                              ? Math.max(0, 100 - Math.max(responseLead - bestLead, 0) * 5)
                              : 60;
                          const rejectValue = rejectDrafts[response.id] ?? '';

                          return (
                            <div
                              key={response.id}
                              className={`rounded-lg border p-4 ${
                                response.awarded ? 'border-emerald-300 bg-emerald-50/60' : 'border-border/70 bg-background/70'
                              }`}
                            >
                              <div className="grid gap-3 md:grid-cols-3">
                                <div>
                                  <div className="text-sm font-semibold text-foreground">{response.vendor?.name}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    Rank #{index + 1} by {responseSort}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Quoted Price
                                  </div>
                                  <div className="mt-1 text-sm font-semibold text-foreground">
                                    {formatMoney(response.totalAmount, detail.currency ?? 'USD')}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Lead Time
                                  </div>
                                  <div className="mt-1 text-sm font-semibold text-foreground">
                                    {Number.isFinite(responseLead) ? `${responseLead} days` : 'Not provided'}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-4 grid gap-3 md:grid-cols-3">
                                <MetricCard label="Price Score" value={String(Math.round(priceScore))} />
                                <MetricCard label="Delivery Score" value={String(Math.round(deliveryScore))} />
                                <MetricCard label="Status" value={response.awarded ? 'Awarded' : response.status} />
                              </div>

                              <div className="mt-4 space-y-2">
                                {(response.lines ?? []).map((line: any) => (
                                  <div key={line.id} className="flex justify-between gap-3 border-b border-border/70 pb-2 text-xs last:border-b-0 last:pb-0">
                                    <span className="text-foreground">
                                      {line.rfqLine?.description} ({line.rfqLine?.quantity} {line.rfqLine?.unitOfMeasure})
                                    </span>
                                    <span className="text-muted-foreground">
                                      {formatMoney(line.unitPrice, detail.currency ?? 'USD')} / {line.rfqLine?.unitOfMeasure ?? 'ea'}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              <div className="mt-4 space-y-3">
                                <Input
                                  value={rejectValue}
                                  onChange={(event) =>
                                    setRejectDrafts((current) => ({ ...current, [response.id]: event.target.value }))
                                  }
                                  placeholder="Reject reason"
                                />
                                <div className="flex flex-wrap gap-2">
                                  {!response.awarded && detail.status !== 'awarded' ? (
                                    <Button
                                      type="button"
                                      onClick={() => handleAward(response.id)}
                                      disabled={!!awardingId || response.status === 'rejected'}
                                    >
                                      {awardingId === response.id ? 'Awarding...' : 'Award'}
                                    </Button>
                                  ) : null}
                                  {!response.awarded &&
                                  response.status !== 'rejected' &&
                                  detail.status !== 'awarded' ? (
                                    <Button
                                      type="button"
                                      variant="destructive"
                                      onClick={() => handleReject(response.id)}
                                      disabled={rejectingId === response.id}
                                    >
                                      {rejectingId === response.id ? 'Rejecting...' : 'Reject'}
                                    </Button>
                                  ) : null}
                                  {response.awarded ? (
                                    <Button asChild variant="outline">
                                      <Link href="/purchase-orders">Review purchase orders</Link>
                                    </Button>
                                  ) : null}
                                </div>
                              </div>

                              {response.notes ? (
                                <div className="mt-3 text-xs text-muted-foreground">{response.notes}</div>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {showNew ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border/70 bg-background p-6 shadow-[0_30px_100px_-40px_rgba(15,23,42,0.6)]">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-foreground">New RFQ</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Define scope, invite vendors, and collect competitive quotes.
                </p>
              </div>
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>
                Close
              </Button>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Field label="Title">
                  <Input
                    value={form.title}
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                    placeholder="Q2 Office Supplies"
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Description">
                  <Textarea
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    rows={3}
                    placeholder="Scope and requirements..."
                  />
                </Field>
              </div>
              <Field label="Response Due Date">
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                />
              </Field>
              <Field label="Currency">
                <Select
                  value={form.currency}
                  onChange={(event) => setForm({ ...form, currency: event.target.value })}
                  className="w-full"
                >
                  <option>USD</option>
                  <option>EUR</option>
                  <option>GBP</option>
                  <option>CAD</option>
                </Select>
              </Field>
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Line Items
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  Add Line
                </Button>
              </div>
              <div className="space-y-3">
                {lines.map((line, index) => (
                  <div key={index} className="grid gap-3 rounded-lg border border-border/70 bg-background/70 p-4 md:grid-cols-[3fr_1fr_1fr_1fr_auto]">
                    <Input
                      placeholder="Description"
                      value={line.description}
                      onChange={(event) => {
                        const next = [...lines];
                        next[index] = { ...next[index], description: event.target.value };
                        setLines(next);
                      }}
                    />
                    <Input
                      type="number"
                      placeholder="Qty"
                      value={String(line.quantity)}
                      min={0.01}
                      step={0.01}
                      onChange={(event) => {
                        const next = [...lines];
                        next[index] = { ...next[index], quantity: Number(event.target.value) };
                        setLines(next);
                      }}
                    />
                    <Input
                      placeholder="UOM"
                      value={line.unitOfMeasure}
                      onChange={(event) => {
                        const next = [...lines];
                        next[index] = { ...next[index], unitOfMeasure: event.target.value };
                        setLines(next);
                      }}
                    />
                    <Input
                      type="number"
                      placeholder="Target $"
                      value={line.targetPrice}
                      onChange={(event) => {
                        const next = [...lines];
                        next[index] = { ...next[index], targetPrice: event.target.value };
                        setLines(next);
                      }}
                    />
                    <Button type="button" variant="ghost" onClick={() => removeLine(index)} disabled={lines.length === 1}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {vendors.length > 0 ? (
              <div className="mt-6">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Invite Vendors
                </div>
                <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto rounded-lg border border-border/70 p-3">
                  {vendors.map((vendor) => {
                    const isSelected = selectedVendors.includes(vendor.id);
                    return (
                      <button
                        key={vendor.id}
                        type="button"
                        onClick={() =>
                          setSelectedVendors(
                            isSelected
                              ? selectedVendors.filter((id) => id !== vendor.id)
                              : [...selectedVendors, vendor.id],
                          )
                        }
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-muted/20 text-muted-foreground'
                        }`}
                      >
                        {vendor.name}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{selectedVendors.length} selected</div>
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowNew(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating...' : 'Create RFQ'}
              </Button>
            </div>
          </div>
        </div>
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
