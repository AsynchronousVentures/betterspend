'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

type Alert = {
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
  const [alerts, setAlerts] = useState<Alert[]>([]);
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
    <div style={{ padding: '2rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: COLORS.textPrimary }}>
            Spend Guard
          </h1>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: COLORS.textMuted }}>
            Review duplicate invoices, split requisitions, and off-hours submissions before they
            turn into losses.
          </p>
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as (typeof statusOptions)[number])}
          style={{
            padding: '0.625rem 0.75rem',
            borderRadius: '6px',
            border: `1px solid ${COLORS.inputBorder}`,
            background: COLORS.white,
          }}
        >
          {statusOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {message && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: `1px solid ${COLORS.accentAmber}`,
            background: COLORS.accentAmberLight,
            color: COLORS.accentAmberDark,
          }}
        >
          {message}
        </div>
      )}

      <div style={{ display: 'grid', gap: '1rem' }}>
        {loading ? (
          <div style={{ color: COLORS.textMuted }}>Loading alerts...</div>
        ) : alerts.length === 0 ? (
          <div
            style={{
              background: COLORS.cardBg,
              border: `1px solid ${COLORS.cardBorder}`,
              borderRadius: '8px',
              padding: '1.5rem',
              boxShadow: SHADOWS.card,
              color: COLORS.textMuted,
            }}
          >
            No spend guard alerts for this filter.
          </div>
        ) : (
          alerts.map((alert) => {
            const badgeColor =
              alert.severity === 'high'
                ? { bg: COLORS.accentRedLight, fg: COLORS.accentRedDark }
                : alert.severity === 'medium'
                  ? { bg: COLORS.accentAmberLight, fg: COLORS.accentAmberDark }
                  : { bg: COLORS.accentBlueLight, fg: COLORS.accentBlueDark };
            return (
              <div
                key={alert.id}
                style={{
                  background: COLORS.cardBg,
                  border: `1px solid ${COLORS.cardBorder}`,
                  borderRadius: '8px',
                  padding: '1rem 1.25rem',
                  boxShadow: SHADOWS.card,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    alignItems: 'flex-start',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        marginBottom: '0.35rem',
                      }}
                    >
                      <span
                        style={{
                          padding: '0.15rem 0.5rem',
                          borderRadius: '999px',
                          background: badgeColor.bg,
                          color: badgeColor.fg,
                          fontSize: '0.75rem',
                          fontWeight: 700,
                        }}
                      >
                        {alert.severity.toUpperCase()}
                      </span>
                      <span
                        style={{ fontSize: '0.9rem', fontWeight: 600, color: COLORS.textPrimary }}
                      >
                        {alert.alertType.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: COLORS.textSecondary }}>
                      {alert.recordType} ·{' '}
                      {alert.details.invoiceNumber ??
                        alert.details.requisitionNumber ??
                        alert.recordId}
                    </div>
                    <div
                      style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginTop: '0.25rem' }}
                    >
                      {new Date(alert.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {alert.status === 'open' && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        disabled={busyId === alert.id}
                        onClick={() => updateAlert(alert.id, 'dismissed')}
                        style={{
                          padding: '0.5rem 0.75rem',
                          borderRadius: '6px',
                          border: `1px solid ${COLORS.inputBorder}`,
                          background: COLORS.white,
                          cursor: 'pointer',
                        }}
                      >
                        Dismiss
                      </button>
                      <button
                        disabled={busyId === alert.id}
                        onClick={() => updateAlert(alert.id, 'escalated')}
                        style={{
                          padding: '0.5rem 0.75rem',
                          borderRadius: '6px',
                          border: 'none',
                          background: COLORS.textPrimary,
                          color: COLORS.white,
                          cursor: 'pointer',
                        }}
                      >
                        Escalate
                      </button>
                    </div>
                  )}
                </div>
                <pre
                  style={{
                    margin: '1rem 0 0',
                    padding: '0.875rem',
                    background: COLORS.contentBg,
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    overflowX: 'auto',
                    color: COLORS.textSecondary,
                  }}
                >
                  {JSON.stringify(alert.details, null, 2)}
                </pre>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
