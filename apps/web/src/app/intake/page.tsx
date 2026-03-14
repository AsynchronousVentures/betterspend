'use client';

import { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { api } from '../../lib/api';
import { StatusBadge } from '../../components/status-badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';

export default function IntakePage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    sourceEmail: '',
    subject: '',
    body: '',
  });

  async function load() {
    setLoading(true);
    api.emailIntake.list().then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.emailIntake.create(form);
      setForm({ sourceEmail: '', subject: '', body: '' });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscard(id: string) {
    await api.emailIntake.discard(id).catch(() => {});
    await load();
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground">Intake Queue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          First-pass email intake review for forwarded quotes, invoice emails, and purchase requests.
        </p>
      </div>

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
              onChange={(event) => setForm((current) => ({ ...current, sourceEmail: event.target.value }))}
              placeholder="sender@vendor.com"
            />
            <Input
              required
              value={form.subject}
              onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
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
          {loading ? (
            <div className="p-8 text-sm text-muted-foreground">Loading intake items...</div>
          ) : items.length === 0 ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
              <div className="rounded-full bg-muted p-4"><Inbox className="h-6 w-6 text-muted-foreground" /></div>
              <div>
                <p className="text-base font-semibold text-foreground">No intake items yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Add a forwarded item above to start triage.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {items.map((item) => (
                <div key={item.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">{item.subject}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{item.sourceEmail}</div>
                    </div>
                    <StatusBadge value={item.detectedType === 'invoice' ? 'partial_match' : item.detectedType === 'requisition' ? 'approved' : 'pending'} label={item.detectedType} className="capitalize" />
                  </div>
                  <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {item.body.slice(0, 280)}
                    {item.body.length > 280 ? '...' : ''}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>Status: {item.status.replace(/_/g, ' ')}</span>
                    <span>Vendor: {item.extractedVendorName ?? '—'}</span>
                    <span>Total: {item.extractedTotal ? `${item.extractedCurrency ?? 'USD'} ${item.extractedTotal}` : '—'}</span>
                  </div>
                  {item.status === 'pending_review' ? (
                    <div className="mt-4">
                      <Button type="button" variant="outline" onClick={() => handleDiscard(item.id)}>
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
