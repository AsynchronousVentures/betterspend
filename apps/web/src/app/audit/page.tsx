'use client';

import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

const ENTITY_COLORS: Record<string, string> = {
  requisition: COLORS.accentBlueLight,
  purchase_order: COLORS.accentGreenLight,
  invoice: '#fef9c3',
  goods_receipt: COLORS.accentPurpleLight,
  budget: '#fff7ed',
  vendor: '#f0f9ff',
  user: COLORS.accentRedLight,
};

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  created: { bg: '#dcfce7', text: '#15803d' },
  updated: { bg: COLORS.accentBlueLight, text: '#1d4ed8' },
  deleted: { bg: '#fee2e2', text: COLORS.accentRedDark },
  approved: { bg: '#d1fae5', text: COLORS.accentGreenDark },
  rejected: { bg: '#fee2e2', text: COLORS.accentRedDark },
  issued: { bg: '#fef9c3', text: '#ca8a04' },
  cancelled: { bg: '#fee2e2', text: COLORS.accentRedDark },
};

const ENTITY_TYPES = ['requisition', 'purchase_order', 'invoice', 'goods_receipt', 'budget', 'vendor', 'user'];

async function downloadCsv(type: string) {
  const { api } = await import('../../lib/api');
  const res = await api.export.download(type);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `export-${type}-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AuditPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEntity, setFilterEntity] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function handleExportCsv() {
    setExporting(true);
    try { await downloadCsv('audit-log'); } finally { setExporting(false); }
  }

  useEffect(() => {
    load();
  }, [filterEntity]);

  async function load() {
    setLoading(true);
    try {
      const data = await api.audit.list({ entityType: filterEntity || undefined, limit: 200 });
      setEntries(data);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.textPrimary }}>Audit Log</h1>
          <p style={{ color: COLORS.textSecondary, fontSize: '0.875rem', marginTop: '0.25rem' }}>Immutable record of all system actions</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={handleExportCsv}
            disabled={exporting}
            style={{ padding: '0.5rem 1rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', background: COLORS.cardBg, cursor: exporting ? 'not-allowed' : 'pointer', fontSize: '0.875rem', color: COLORS.textSecondary, fontWeight: 500 }}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <button onClick={load} style={{ padding: '0.5rem 1rem', border: `1px solid ${COLORS.border}`, borderRadius: '6px', background: COLORS.cardBg, cursor: 'pointer', fontSize: '0.875rem' }}>
            Refresh
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary }}>Entity type:</label>
        <select
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
          style={{ padding: '0.4rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem' }}
        >
          <option value="">All</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: '0.875rem', color: COLORS.textSecondary }}>{entries.length} entries</span>
      </div>

      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: '8px', overflow: 'hidden', boxShadow: SHADOWS.card }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted }}>Loading...</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted }}>No audit entries found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                  {['Time', 'Entity', 'Action', 'Entity ID', 'User', ''].map((h) => (
                    <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: COLORS.textSecondary, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => {
                  const ac = ACTION_COLORS[entry.action] || { bg: COLORS.contentBg, text: COLORS.textSecondary };
                  const ec = ENTITY_COLORS[entry.entityType] || COLORS.hoverBg;
                  const isExpanded = expanded === entry.id;
                  const hasChanges = entry.changes && Object.keys(entry.changes).length > 0;
                  return (
                    <>
                      <tr
                        key={entry.id}
                        style={{ borderBottom: `1px solid ${COLORS.contentBg}`, cursor: hasChanges ? 'pointer' : 'default' }}
                        onClick={() => hasChanges && setExpanded(isExpanded ? null : entry.id)}
                      >
                        <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {new Date(entry.createdAt).toLocaleString()}
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{ background: ec, padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', color: COLORS.textSecondary }}>
                            {entry.entityType.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{ background: ac.bg, color: ac.text, padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                            {entry.action}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.75rem', color: COLORS.textMuted }}>
                          {entry.entityId.slice(0, 8)}...
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: COLORS.textSecondary, fontSize: '0.8rem' }}>
                          {entry.userId ? entry.userId.slice(0, 8) + '...' : '—'}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: COLORS.textMuted, fontSize: '0.8rem' }}>
                          {hasChanges && <span>{isExpanded ? '▲' : '▼'}</span>}
                        </td>
                      </tr>
                      {isExpanded && hasChanges && (
                        <tr key={`${entry.id}-detail`} style={{ background: COLORS.hoverBg, borderBottom: `1px solid ${COLORS.contentBg}` }}>
                          <td colSpan={6} style={{ padding: '0.75rem 1rem' }}>
                            <pre style={{ fontSize: '0.8rem', color: COLORS.textSecondary, margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: COLORS.contentBg, padding: '0.75rem', borderRadius: '6px' }}>
                              {JSON.stringify(entry.changes, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
