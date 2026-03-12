'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS, FONT } from '../../../lib/theme';

interface TemplateLine {
  description: string;
  quantity: number;
  unitOfMeasure: string;
  unitPrice: number;
  vendorId?: string;
  glAccount?: string;
}

interface TemplateData {
  title: string;
  description?: string;
  priority: string;
  currency: string;
  lines: TemplateLine[];
}

interface Template {
  id: string;
  name: string;
  description?: string;
  isOrgWide: boolean;
  templateData: TemplateData;
  createdAt: string;
  createdBy?: { id: string; name: string; email: string };
}

function formatCurrency(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function totalFromLines(lines: TemplateLine[]) {
  return lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
}

interface SaveTemplateModalProps {
  onClose: () => void;
  onSave: (name: string, description: string, isOrgWide: boolean) => Promise<void>;
}

function SaveTemplateModal({ onClose, onSave }: SaveTemplateModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isOrgWide, setIsOrgWide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      await onSave(name, description, isOrgWide);
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: COLORS.cardBg, borderRadius: '10px', padding: '2rem', width: '480px', maxWidth: '95vw', boxShadow: SHADOWS.dropdown }}>
        <h2 style={{ margin: '0 0 1.5rem', fontSize: FONT.lg, fontWeight: 700, color: COLORS.textPrimary }}>Create Template</h2>
        <form onSubmit={handleSubmit}>
          {error && <div style={{ background: COLORS.accentRedLight, color: COLORS.accentRedDark, padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', fontSize: FONT.base }}>{error}</div>}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: FONT.base, fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.4rem' }}>Template Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Monthly Office Supplies"
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: FONT.base, boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: FONT.base, fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.4rem' }}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional description"
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: FONT.base, resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: FONT.base, color: COLORS.textSecondary, cursor: 'pointer', marginBottom: '1.5rem' }}>
            <input type="checkbox" checked={isOrgWide} onChange={(e) => setIsOrgWide(e.target.checked)} />
            Make available to all org members
          </label>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ padding: '0.5rem 1.25rem', border: `1px solid ${COLORS.border}`, borderRadius: '6px', background: COLORS.cardBg, fontSize: FONT.base, cursor: 'pointer', color: COLORS.textSecondary }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ padding: '0.5rem 1.25rem', background: COLORS.textPrimary, color: COLORS.white, border: 'none', borderRadius: '6px', fontSize: FONT.base, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RequisitionTemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  function load() {
    api.requisitionTemplates.list()
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(name: string, description: string, isOrgWide: boolean) {
    // This path is for creating a blank template — redirect to new requisition form instead
    // The modal here is used from the detail page; on this page we just provide the info
    throw new Error('Use "Save as Template" from a requisition detail page, or click "New Requisition" and save from there.');
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await api.requisitionTemplates.remove(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err: any) {
      alert(err.message ?? 'Failed to delete template');
    } finally {
      setDeleting(null);
    }
  }

  async function handleUseTemplate(id: string) {
    router.push(`/requisitions/new?templateId=${id}`);
  }

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>Requisition Templates</h1>
          <p style={{ margin: '0.25rem 0 0', color: COLORS.textSecondary, fontSize: FONT.base }}>Reusable templates for repeat purchasing</p>
        </div>
        <Link
          href="/requisitions/new"
          style={{ background: COLORS.textPrimary, color: COLORS.white, padding: '0.5rem 1.25rem', borderRadius: '6px', textDecoration: 'none', fontSize: FONT.base, fontWeight: 500 }}
        >
          + New Requisition
        </Link>
      </div>

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: COLORS.textMuted, fontSize: FONT.base }}>Loading…</div>
      ) : templates.length === 0 ? (
        <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '4rem 2rem', textAlign: 'center', boxShadow: SHADOWS.card }}>
          <p style={{ fontSize: '1rem', marginBottom: '0.5rem', color: COLORS.textSecondary, fontWeight: 500 }}>No templates yet</p>
          <p style={{ fontSize: FONT.base, color: COLORS.textMuted }}>Open a requisition and click "Save as Template" to create your first template.</p>
          <Link href="/requisitions" style={{ display: 'inline-block', marginTop: '1rem', color: COLORS.accentBlueDark, textDecoration: 'none', fontSize: FONT.base }}>View Requisitions →</Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {templates.map((t) => {
            const total = totalFromLines(t.templateData?.lines ?? []);
            const lineCount = t.templateData?.lines?.length ?? 0;
            return (
              <div key={t.id} style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: FONT.md, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                    {t.description && <div style={{ fontSize: FONT.sm, color: COLORS.textMuted, marginTop: '0.2rem' }}>{t.description}</div>}
                  </div>
                  {t.isOrgWide && (
                    <span style={{ background: COLORS.accentBlueLight, color: COLORS.accentBlueDark, fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: '999px', whiteSpace: 'nowrap' }}>Org-wide</span>
                  )}
                </div>

                <div style={{ fontSize: FONT.sm, color: COLORS.textSecondary }}>
                  <span style={{ fontWeight: 600, color: COLORS.textPrimary }}>{t.templateData?.title}</span>
                  {' · '}
                  {lineCount} line{lineCount !== 1 ? 's' : ''}
                  {' · '}
                  {formatCurrency(total, t.templateData?.currency ?? 'USD')}
                </div>

                {t.templateData?.lines?.slice(0, 2).map((l, i) => (
                  <div key={i} style={{ fontSize: '0.75rem', color: COLORS.textMuted, paddingLeft: '0.5rem', borderLeft: `2px solid ${COLORS.border}` }}>
                    {l.description} — {l.quantity} {l.unitOfMeasure} × {formatCurrency(l.unitPrice, t.templateData?.currency ?? 'USD')}
                  </div>
                ))}
                {lineCount > 2 && <div style={{ fontSize: '0.75rem', color: COLORS.textMuted }}>+{lineCount - 2} more line{lineCount - 2 !== 1 ? 's' : ''}</div>}

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', paddingTop: '0.5rem', borderTop: `1px solid ${COLORS.border}` }}>
                  <button
                    onClick={() => handleUseTemplate(t.id)}
                    style={{ flex: 1, padding: '0.45rem', background: COLORS.textPrimary, color: COLORS.white, border: 'none', borderRadius: '6px', fontSize: FONT.sm, fontWeight: 500, cursor: 'pointer' }}
                  >
                    Use Template
                  </button>
                  <button
                    onClick={() => handleDelete(t.id, t.name)}
                    disabled={deleting === t.id}
                    style={{ padding: '0.45rem 0.75rem', background: COLORS.cardBg, color: COLORS.accentRedDark, border: `1px solid ${COLORS.accentRedLight}`, borderRadius: '6px', fontSize: FONT.sm, cursor: deleting === t.id ? 'not-allowed' : 'pointer', opacity: deleting === t.id ? 0.5 : 1 }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
