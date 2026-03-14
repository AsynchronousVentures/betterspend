'use client';

import { useEffect, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Field, InlineNotice } from '../../components/settings-ui';
import { Input } from '../../components/ui/input';

type ExchangeRate = {
  id?: string;
  fromCurrency?: string;
  toCurrency?: string;
  rate?: string | number;
  isManual?: boolean;
  fetchedAt?: string | null;
};

export default function CurrenciesPage() {
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);
  const [rateForm, setRateForm] = useState({ fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' });
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState({
    baseCurrency: 'USD',
    rateForm: { fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' },
    editingRateId: null as string | null,
  });

  const isDirty =
    baseCurrency !== snapshot.baseCurrency ||
    JSON.stringify(rateForm) !== JSON.stringify(snapshot.rateForm) ||
    editingRateId !== snapshot.editingRateId;

  function confirmLeaveIfDirty() {
    return window.confirm('You have unsaved changes. Are you sure you want to leave?');
  }

  async function refreshExchangeRateSettings() {
    const [base, rates] = await Promise.all([
      api.exchangeRates.getBaseCurrency(),
      api.exchangeRates.list(),
    ]);
    setBaseCurrency(base.baseCurrency ?? 'USD');
    setExchangeRates(rates);
    setSnapshot({
      baseCurrency: base.baseCurrency ?? 'USD',
      rateForm: { fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' },
      editingRateId: null,
    });
  }

  useEffect(() => {
    refreshExchangeRateSettings().catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('/currencies')) return;
      if (!confirmLeaveIfDirty()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const currentUrl = window.location.pathname + window.location.search;
    const handlePopState = () => {
      if (confirmLeaveIfDirty()) return;
      window.history.pushState(null, '', currentUrl);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleDocumentClick, true);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleDocumentClick, true);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isDirty]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const parsedRate = Number(rateForm.rate);
      if (!/^[A-Z]{3}$/.test(baseCurrency.trim().toUpperCase())) {
        throw new Error('Base currency must be a 3-letter currency code');
      }
      if (!/^[A-Z]{3}$/.test(rateForm.fromCurrency.trim().toUpperCase())) {
        throw new Error('From currency must be a 3-letter currency code');
      }
      if (!/^[A-Z]{3}$/.test(rateForm.toCurrency.trim().toUpperCase())) {
        throw new Error('To currency must be a 3-letter currency code');
      }
      if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
        throw new Error('Exchange rate must be greater than zero');
      }

      await api.exchangeRates.updateBaseCurrency(baseCurrency.trim().toUpperCase());
      if (editingRateId) {
        await api.exchangeRates.update(editingRateId, {
          fromCurrency: rateForm.fromCurrency.trim().toUpperCase(),
          toCurrency: rateForm.toCurrency.trim().toUpperCase(),
          rate: parsedRate,
          isManual: true,
        });
      } else {
        await api.exchangeRates.create({
          fromCurrency: rateForm.fromCurrency.trim().toUpperCase(),
          toCurrency: rateForm.toCurrency.trim().toUpperCase(),
          rate: parsedRate,
          isManual: true,
        });
      }
      await refreshExchangeRateSettings();
      setEditingRateId(null);
      setRateForm({ fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' });
      setMessage(editingRateId ? 'Exchange rate updated.' : 'Base currency and exchange rate saved.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRate(id: string) {
    if (!window.confirm('Delete this exchange rate?')) return;
    setError('');
    setMessage('');
    setSaving(true);
    try {
      await api.exchangeRates.remove(id);
      await refreshExchangeRateSettings();
      if (editingRateId === id) {
        setEditingRateId(null);
        setRateForm({ fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' });
      }
      setMessage('Exchange rate deleted.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleEditRate(rate: ExchangeRate) {
    setEditingRateId(rate.id ?? null);
    setRateForm({
      fromCurrency: rate.fromCurrency ?? 'EUR',
      toCurrency: rate.toCurrency ?? 'USD',
      rate: Number(rate.rate).toString(),
    });
    setError('');
    setMessage(`Editing ${rate.fromCurrency} -> ${rate.toCurrency}.`);
  }

  function handleCancelRateEdit() {
    setEditingRateId(null);
    setRateForm({ fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' });
    setError('');
    setMessage('Exchange rate editor reset.');
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Currencies"
        description="Manage the organization base currency and saved manual exchange-rate overrides."
      />

      <form onSubmit={handleSave}>
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ArrowRightLeft className="h-5 w-5" />
              Currency Controls
            </CardTitle>
            <CardDescription>
              This page preserves the existing exchange-rate workflow, but keeps it out of System Info.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Organization Base Currency">
                <Input maxLength={3} value={baseCurrency} onChange={(event) => setBaseCurrency(event.target.value.toUpperCase())} />
              </Field>
              <Field label="Rate">
                <Input type="number" min="0" step="0.00000001" value={rateForm.rate} onChange={(event) => setRateForm((current) => ({ ...current, rate: event.target.value }))} />
                <p className="mt-2 text-xs text-muted-foreground">
                  {editingRateId ? 'Editing an existing exchange rate.' : 'Create or override a saved manual rate pair.'}
                </p>
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="From Currency">
                <Input maxLength={3} value={rateForm.fromCurrency} onChange={(event) => setRateForm((current) => ({ ...current, fromCurrency: event.target.value.toUpperCase() }))} />
              </Field>
              <Field label="To Currency">
                <Input maxLength={3} value={rateForm.toCurrency} onChange={(event) => setRateForm((current) => ({ ...current, toCurrency: event.target.value.toUpperCase() }))} />
              </Field>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">Saved Exchange Rates</div>
                {editingRateId ? (
                  <Button type="button" variant="outline" size="sm" onClick={handleCancelRateEdit}>
                    Cancel Edit
                  </Button>
                ) : null}
              </div>
              <div className="rounded-lg border border-border/70">
                {exchangeRates.length === 0 ? (
                  <div className="px-4 py-5 text-sm text-muted-foreground">No exchange rates configured yet.</div>
                ) : (
                  exchangeRates.map((rate, index) => (
                    <div
                      key={`${rate.fromCurrency}-${rate.toCurrency}-${rate.id ?? index}`}
                      className={`grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center ${
                        index < exchangeRates.length - 1 ? 'border-b border-border/70' : ''
                      }`}
                    >
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {rate.fromCurrency} {'->'} {rate.toCurrency}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {rate.isManual ? 'Manual override' : 'Imported'}
                        </div>
                      </div>
                      <div className="font-mono text-sm text-muted-foreground">
                        {Number(rate.rate).toFixed(6)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {rate.fetchedAt ? new Date(rate.fetchedAt).toLocaleString() : 'Unknown'}
                      </div>
                      <div className="flex gap-2 md:justify-end">
                        <Button type="button" size="sm" onClick={() => handleEditRate(rate)}>
                          Edit
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => rate.id && handleDeleteRate(rate.id)}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <InlineNotice error={error} success={message} />
            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : editingRateId ? 'Update Exchange Rate' : 'Save Currency Settings'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
