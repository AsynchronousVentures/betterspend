'use client';

import { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { api, loadFailureState } from '../../lib/api';
import { ListState } from '../../components/resource-state';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';

export default function IntakePage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    sourceEmail: '',
    subject: '',
    body: '',
  });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.emailIntake.list();
      setItems(Array.isArray(data) ? data : []);
    } catch (loadFailure) {
      setLoadError(loadFailure);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.emailIntake.create(form);
      setForm({ sourceEmail: '', subject: '', body: '' });
      await load();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : 'Could not add the intake item.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscard(id: string) {
    setError('');
    try {
      await api.emailIntake.discard(id);
      await load();
    } catch (discardError) {
      setError(
        discardError instanceof Error ? discardError.message : 'Could not discard the intake item.',
      );
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">Intake Queue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          First-pass email intake review for forwarded quotes, invoice emails, and purchase
          requests.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Intake Item</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4">
            <Input
              required
              type="email"
              value={form.sourceEmail}
              onChange={(event) =>
                setForm((current) => ({ ...current, sourceEmail: event.target.value }))
              }
              placeholder="sender@vendor.com"
            />
            <Input
              required
              value={form.subject}
              onChange={(event) =>
                setForm((current) => ({ ...current, subject: event.target.value }))
              }
              placeholder="Subject"
            />
            <Textarea
              required
              rows={6}
              value={form.body}
              onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
              placeholder="Paste the forwarded email body or quote text here"
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? 'Adding...' : 'Add to Intake Queue'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Pending Review</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading || loadError || items.length === 0 ? (
            <ListState
              state={loading ? 'loading' : loadError ? loadFailureState(loadError) : 'empty'}
              loadingLabel="Loading intake items..."
              emptyTitle="No intake items yet"
              emptyDescription="Forward an email or add one above to start triage."
              icon={Inbox}
              onRetry={() => void load()}
            />
          ) : (
            <div className="divide-y divide-border/70">
              {items.map((item) => (
                <div key={item.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">{item.subject}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{item.sourceEmail}</div>
                    </div>
                    <StatusBadge
                      value={
                        item.detectedType === 'invoice'
                          ? 'partial_match'
                          : item.detectedType === 'requisition'
                            ? 'approved'
                            : 'pending'
                      }
                      label={item.detectedType}
                      className="capitalize"
                    />
                  </div>
                  <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {item.body.slice(0, 280)}
                    {item.body.length > 280 ? '...' : ''}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>Status: {item.status.replace(/_/g, ' ')}</span>
                    <span>Vendor: {item.extractedVendorName ?? '—'}</span>
                    <span>
                      Total:{' '}
                      {item.extractedTotal
                        ? `${item.extractedCurrency ?? 'USD'} ${item.extractedTotal}`
                        : '—'}
                    </span>
                  </div>
                  {item.status === 'pending_review' ? (
                    <div className="mt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleDiscard(item.id)}
                      >
                        Discard
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
