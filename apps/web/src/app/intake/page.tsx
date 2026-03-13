'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';

const cardStyle: React.CSSProperties = {
  background: COLORS.cardBg,
  border: `1px solid ${COLORS.border}`,
  borderRadius: '10px',
  boxShadow: SHADOWS.card,
};

function typeBadge(type: string) {
  if (type === 'invoice') return { bg: '#dbeafe', text: '#1d4ed8' };
  if (type === 'requisition') return { bg: '#dcfce7', text: '#15803d' };
  return { bg: '#fef3c7', text: '#92400e' };
}

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
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
    <div style={{ padding: '2rem', display: 'grid', gap: '1.25rem' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: COLORS.textPrimary }}>Intake Queue</h1>
        <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: COLORS.textSecondary }}>
          First-pass email intake review for forwarded quotes, invoice emails, and purchase requests.
        </p>
      </div>

      <form onSubmit={handleCreate} style={{ ...cardStyle, padding: '1rem' }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: COLORS.textPrimary, marginBottom: '0.85rem' }}>
          Add Intake Item
        </div>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <input
            required
            type="email"
            value={form.sourceEmail}
            onChange={(event) => setForm((current) => ({ ...current, sourceEmail: event.target.value }))}
            placeholder="sender@vendor.com"
            style={{ width: '100%', padding: '0.65rem 0.8rem', borderRadius: '8px', border: `1px solid ${COLORS.inputBorder}`, boxSizing: 'border-box' }}
          />
          <input
            required
            value={form.subject}
            onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
            placeholder="Subject"
            style={{ width: '100%', padding: '0.65rem 0.8rem', borderRadius: '8px', border: `1px solid ${COLORS.inputBorder}`, boxSizing: 'border-box' }}
          />
          <textarea
            required
            rows={6}
            value={form.body}
            onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
            placeholder="Paste the forwarded email body or quote text here"
            style={{ width: '100%', padding: '0.75rem 0.8rem', borderRadius: '8px', border: `1px solid ${COLORS.inputBorder}`, boxSizing: 'border-box', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" disabled={saving} style={{ padding: '0.65rem 1rem', borderRadius: '8px', border: 'none', background: COLORS.accentBlue, color: '#fff', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Adding...' : 'Add to Intake Queue'}
            </button>
          </div>
        </div>
      </form>

      <div style={cardStyle}>
        <div style={{ padding: '0.9rem 1rem', borderBottom: `1px solid ${COLORS.border}`, fontWeight: 700, color: COLORS.textPrimary }}>
          Pending Review
        </div>
        {loading ? (
          <div style={{ padding: '2rem', color: COLORS.textMuted }}>Loading intake items...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: '2rem', color: COLORS.textMuted }}>No intake items yet.</div>
        ) : (
          <div style={{ display: 'grid' }}>
            {items.map((item) => {
              const badge = typeBadge(item.detectedType);
              return (
                <div key={item.id} style={{ padding: '1rem', borderBottom: `1px solid ${COLORS.contentBg}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: COLORS.textPrimary }}>{item.subject}</div>
                      <div style={{ fontSize: '0.82rem', color: COLORS.textSecondary, marginTop: '0.2rem' }}>
                        {item.sourceEmail}
                      </div>
                    </div>
                    <span style={{ background: badge.bg, color: badge.text, borderRadius: '999px', padding: '0.2rem 0.55rem', fontSize: '0.72rem', fontWeight: 700, textTransform: 'capitalize' }}>
                      {item.detectedType}
                    </span>
                  </div>
                  <div style={{ marginTop: '0.65rem', fontSize: '0.85rem', color: COLORS.textSecondary, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {item.body.slice(0, 280)}
                    {item.body.length > 280 ? '...' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.65rem', fontSize: '0.78rem', color: COLORS.textMuted }}>
                    <span>Status: {item.status.replace(/_/g, ' ')}</span>
                    <span>Vendor: {item.extractedVendorName ?? '—'}</span>
                    <span>Total: {item.extractedTotal ? `${item.extractedCurrency ?? 'USD'} ${item.extractedTotal}` : '—'}</span>
                  </div>
                  {item.status === 'pending_review' && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => handleDiscard(item.id)}
                        style={{ padding: '0.45rem 0.75rem', borderRadius: '8px', border: `1px solid ${COLORS.accentRedDark}`, background: 'transparent', color: COLORS.accentRedDark, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Discard
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
