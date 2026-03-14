'use client';

import { useEffect, useState } from 'react';
import { BellRing, Plus, Power, Truck, Trash2, Webhook } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

const ALL_EVENTS = [
  'requisition.created',
  'requisition.approved',
  'requisition.rejected',
  'purchase_order.created',
  'purchase_order.issued',
  'purchase_order.cancelled',
  'invoice.created',
  'invoice.matched',
  'invoice.approved',
  'receiving.created',
  'budget.exceeded',
];

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<any | null>(null);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [form, setForm] = useState({ url: '', events: [] as string[], secret: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      setEndpoints(await api.webhooks.list());
    } catch (err: any) {
      setError(err.message ?? 'Unable to load webhooks.');
    } finally {
      setLoading(false);
    }
  }

  function setField(key: 'url' | 'secret', value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await api.webhooks.create({
        url: form.url,
        events: form.events,
        secret: form.secret || undefined,
      });
      setShowForm(false);
      setForm({ url: '', events: [], secret: '' });
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(endpoint: any) {
    try {
      await api.webhooks.update(endpoint.id, { isActive: !endpoint.isActive });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this webhook endpoint?')) return;
    try {
      await api.webhooks.remove(id);
      if (selectedEndpoint?.id === id) setSelectedEndpoint(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function viewDeliveries(endpoint: any) {
    setSelectedEndpoint(endpoint);
    try {
      setDeliveries(await api.webhooks.deliveries(endpoint.id));
    } catch (err: any) {
      setError(err.message);
    }
  }

  function toggleEvent(eventName: string) {
    setForm((current) => ({
      ...current,
      events: current.events.includes(eventName)
        ? current.events.filter((value) => value !== eventName)
        : [...current.events, eventName],
    }));
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Webhooks"
        description="Register downstream listeners for procurement lifecycle events, rotate secrets, and inspect delivery attempts."
        actions={
          <Button type="button" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />
            New Endpoint
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">Endpoint setup</CardTitle>
            <CardDescription>Use a dedicated endpoint URL and optional HMAC secret. Leaving the event list empty subscribes the endpoint to every supported event.</CardDescription>
          </CardHeader>
          <CardContent>
            {showForm ? (
              <div className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">URL</label>
                  <Input value={form.url} onChange={(event) => setField('url', event.target.value)} placeholder="https://example.com/webhook" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-foreground">Secret</label>
                  <Input value={form.secret} onChange={(event) => setField('secret', event.target.value)} placeholder="Optional HMAC secret" />
                </div>
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-foreground">Events</label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_EVENTS.map((eventName) => (
                      <button
                        key={eventName}
                        type="button"
                        onClick={() => toggleEvent(eventName)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          form.events.includes(eventName)
                            ? 'border-sky-200 bg-sky-50 text-sky-700'
                            : 'border-border/70 bg-background text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        {eventName}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">No event tags selected means this endpoint receives every event.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" disabled={saving || !form.url} onClick={handleSave}>
                    <Plus className="h-4 w-4" />
                    {saving ? 'Saving...' : 'Save Endpoint'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
                <Webhook className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">Webhook registry is ready</div>
                <p className="mt-2 text-sm text-muted-foreground">Create a new endpoint to stream procurement events into automation, alerts, or external ledgers.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">Endpoint registry</CardTitle>
            <CardDescription>Enable, disable, or delete endpoints and open delivery history for the ones currently in service.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {loading ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                Loading endpoints...
              </div>
            ) : endpoints.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                No webhook endpoints yet.
              </div>
            ) : (
              endpoints.map((endpoint) => (
                <div key={endpoint.id} className="rounded-lg border border-border/70 bg-background/80 p-5 shadow-[0_18px_48px_-36px_rgba(15,23,42,0.35)]">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="break-all text-sm font-semibold text-foreground">{endpoint.url}</div>
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge value={endpoint.isActive ? 'active' : 'inactive'} />
                        {(endpoint.events.length === 0 ? ['All events'] : endpoint.events).map((eventName: string) => (
                          <Badge key={eventName} variant="outline" className="border-border/80 bg-muted/40 text-muted-foreground">
                            {eventName}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => viewDeliveries(endpoint)}>
                        <Truck className="h-3.5 w-3.5" />
                        Deliveries
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => handleToggleActive(endpoint)}>
                        <Power className="h-3.5 w-3.5" />
                        {endpoint.isActive ? 'Disable' : 'Enable'}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => handleDelete(endpoint.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {selectedEndpoint ? (
        <Card className="rounded-lg">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-xl">Delivery history</CardTitle>
              <CardDescription>{selectedEndpoint.url}</CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={() => setSelectedEndpoint(null)}>
              Close
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {deliveries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                No deliveries yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Response</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell className="font-mono text-xs text-foreground">{delivery.eventType}</TableCell>
                      <TableCell>
                        <StatusBadge value={delivery.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{delivery.attempts}</TableCell>
                      <TableCell className="text-muted-foreground">{delivery.responseStatus || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{new Date(delivery.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
