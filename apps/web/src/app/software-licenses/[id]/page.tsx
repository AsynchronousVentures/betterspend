'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarClock,
  CircleDollarSign,
  UserRound,
  Users,
} from 'lucide-react';
import { api } from '../../../lib/api';
import Breadcrumbs from '../../../components/breadcrumbs';
import { PageHeader } from '../../../components/page-header';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';

function fmtCurrency(value: string | number | null | undefined, currency = 'USD') {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function statusTone(status: string) {
  if (status === 'renewal_due') return 'warning';
  if (status === 'expired') return 'destructive';
  if (status === 'active') return 'success';
  return 'secondary';
}

export default function SoftwareLicenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [id, setId] = useState('');
  const [license, setLicense] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState('');

  useEffect(() => {
    params.then(({ id: value }) => {
      setId(value);
      api.softwareLicenses
        .get(value)
        .then((data) => setLicense(data))
        .catch(() => setError('Failed to load software license.'))
        .finally(() => setLoading(false));
    });
  }, [params]);

  async function applyAction(action: 'renew' | 'renegotiate' | 'cancel') {
    if (!id) return;
    setActionLoading(action);
    setError('');
    try {
      const updated = await api.softwareLicenses.renewalAction(id, {
        action,
        note: actionNote || undefined,
      });
      setLicense(updated);
      setActionNote('');
    } catch {
      setError('Failed to apply renewal action.');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
          Loading software license...
        </div>
      </div>
    );
  }

  if (!license) {
    return (
      <div className="p-4 lg:p-8">
        <Alert variant="destructive">
          <AlertDescription>License not found.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const utilizationPct = license.seatCount
    ? (Number(license.seatsUsed) / Number(license.seatCount)) * 100
    : 0;
  const annualizedValue = Number(
    license.billingCycle === 'monthly'
      ? Number(license.seatCount) * Number(license.pricePerSeat) * 12
      : Number(license.seatCount) * Number(license.pricePerSeat),
  );
  const renewalOpenDate = license.renewalDate
    ? fmtDate(
        new Date(
          new Date(license.renewalDate).getTime() -
            Number(license.renewalLeadDays) * 24 * 60 * 60 * 1000,
        ).toISOString(),
      )
    : '—';

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <Breadcrumbs
        items={[
          { label: 'Software Licenses', href: '/software-licenses' },
          { label: license.productName },
        ]}
      />

      <PageHeader
        title={license.productName}
        description={`Managed by ${license.vendor?.name ?? 'Unknown vendor'} with renewal tracking, seat utilization, and renewal actions.`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={statusTone(license.status) as any} className="capitalize">
              {String(license.status).replace(/_/g, ' ')}
            </Badge>
            <Button asChild variant="outline">
              <Link href="/software-licenses">
                <ArrowLeft className="h-4 w-4" />
                Back to Licenses
              </Link>
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={Users}
          label="Seats"
          value={`${license.seatsUsed}/${license.seatCount}`}
          meta={`${utilizationPct.toFixed(1)}% utilized`}
          tone="text-sky-700"
        />
        <StatCard
          icon={CalendarClock}
          label="Renewal Date"
          value={fmtDate(license.renewalDate)}
          meta={license.autoRenews ? 'Auto-renews' : 'Manual renewal'}
          tone="text-amber-700"
        />
        <StatCard
          icon={CircleDollarSign}
          label="Annualized Value"
          value={fmtCurrency(annualizedValue, license.currency)}
          meta={`${fmtCurrency(license.pricePerSeat, license.currency)} per seat / ${license.billingCycle}`}
          tone="text-emerald-700"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_380px]">
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">License Details</CardTitle>
            <CardDescription>
              Core ownership, commercial, and contract metadata for this software agreement.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <DetailField label="Vendor" value={license.vendor?.name ?? '—'} />
              <DetailField
                label="Owner"
                value={license.owner?.name ?? license.owner?.email ?? '—'}
                icon={UserRound}
              />
              <DetailField label="Billing Cycle" value={license.billingCycle} />
              <DetailField label="Renewal Lead" value={`${license.renewalLeadDays} days`} />
              <DetailField
                label="Contract"
                value={
                  license.contract
                    ? `${license.contract.contractNumber} · ${license.contract.title}`
                    : '—'
                }
              />
              <DetailField label="Currency" value={license.currency} />
            </div>
            {license.notes ? (
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Notes
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                  {license.notes}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Renewal Timeline</CardTitle>
            <CardDescription>
              Review the planning window and take the next action for the upcoming term.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <TimelineCard
              label="Renewal review opens"
              value={renewalOpenDate}
              note="Based on the configured lead time."
            />
            <TimelineCard
              label="Renewal date"
              value={fmtDate(license.renewalDate)}
              note={license.autoRenews ? 'Auto-renewal on file.' : 'Manual approval required.'}
            />
            <TimelineCard
              label="Suggested action"
              value={
                utilizationPct < 70
                  ? 'Review downsize or renegotiate'
                  : license.autoRenews
                    ? 'Confirm auto-renewal coverage'
                    : 'Prepare manual renewal'
              }
              note="Driven by seat utilization and renewal settings."
            />

            <div className="space-y-3 rounded-2xl border border-border/70 bg-background/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Renewal Note
              </div>
              <textarea
                value={actionNote}
                onChange={(event) => setActionNote(event.target.value)}
                placeholder="Optional context for the renewal decision"
                rows={4}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() => applyAction('renew')}
                  disabled={!!actionLoading}
                >
                  {actionLoading === 'renew' ? 'Processing...' : 'Renew for Next Term'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => applyAction('renegotiate')}
                  disabled={!!actionLoading}
                >
                  {actionLoading === 'renegotiate'
                    ? 'Processing...'
                    : 'Start Renegotiation'}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => applyAction('cancel')}
                  disabled={!!actionLoading}
                >
                  {actionLoading === 'cancel' ? 'Processing...' : 'Prepare Cancellation'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
      </div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function TimelineCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-base font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{note}</div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  meta,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  meta: string;
  tone: string;
}) {
  return (
    <Card className="rounded-[24px] border-border/70 bg-card/95">
      <CardContent className="flex items-center gap-4 p-6">
        <div className={`rounded-2xl border border-current/10 bg-current/10 p-3 ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
          <div className="font-display text-2xl font-semibold tracking-[-0.04em] text-foreground">
            {value}
          </div>
          <div className="text-sm text-muted-foreground">{meta}</div>
        </div>
      </CardContent>
    </Card>
  );
}
