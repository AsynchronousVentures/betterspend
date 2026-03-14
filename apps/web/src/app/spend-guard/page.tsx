'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Select } from '../../components/ui/select';

type SpendGuardAlert = {
  id: string;
  alertType: string;
  severity: 'low' | 'medium' | 'high';
  recordType: string;
  recordId: string;
  details: Record<string, any>;
  status: 'open' | 'dismissed' | 'escalated';
  note?: string | null;
  createdAt: string;
};

const statusOptions = ['open', 'dismissed', 'escalated', 'all'] as const;

export default function SpendGuardPage() {
  const [status, setStatus] = useState<(typeof statusOptions)[number]>('open');
  const [alerts, setAlerts] = useState<SpendGuardAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function load(nextStatus = status) {
    setLoading(true);
    try {
      const data = await api.spendGuard.list(nextStatus);
      setAlerts(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(status);
  }, [status]);

  async function updateAlert(id: string, nextStatus: 'dismissed' | 'escalated') {
    setBusyId(id);
    setMessage('');
    try {
      await api.spendGuard.update(id, { status: nextStatus });
      await load(status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update alert');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      {message ? (
        <Alert variant="warning">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <PageHeader
        title="Spend Guard"
        description="Review duplicate invoices, split requisitions, and off-hours submissions before they turn into losses."
        actions={
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as (typeof statusOptions)[number])}
            className="min-w-[180px]"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        }
      />

      {loading ? (
        <Card>
          <CardContent className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
            Loading alerts...
          </CardContent>
        </Card>
      ) : alerts.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="rounded-full bg-muted p-4">
              <ShieldAlert className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">No spend guard alerts</p>
              <p className="mt-1 text-sm text-muted-foreground">No alerts matched the current filter.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {alerts.map((alert) => (
            <Card key={alert.id} className="overflow-hidden">
              <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      value={
                        alert.severity === 'high'
                          ? 'exception'
                          : alert.severity === 'medium'
                            ? 'pending'
                            : 'partial_match'
                      }
                      label={alert.severity.toUpperCase()}
                    />
                    <CardTitle className="text-base capitalize">{alert.alertType.replace(/_/g, ' ')}</CardTitle>
                    <StatusBadge value={alert.status} />
                  </div>
                  <CardDescription>
                    {alert.recordType} · {alert.details.invoiceNumber ?? alert.details.requisitionNumber ?? alert.recordId}
                  </CardDescription>
                  <div className="text-xs text-muted-foreground">{new Date(alert.createdAt).toLocaleString()}</div>
                </div>
                {alert.status === 'open' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={busyId === alert.id}
                      onClick={() => updateAlert(alert.id, 'dismissed')}
                    >
                      Dismiss
                    </Button>
                    <Button disabled={busyId === alert.id} onClick={() => updateAlert(alert.id, 'escalated')}>
                      Escalate
                    </Button>
                  </div>
                ) : null}
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg border border-border/70 bg-muted/40 p-4 text-xs leading-6 text-muted-foreground">
                  {JSON.stringify(alert.details, null, 2)}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
