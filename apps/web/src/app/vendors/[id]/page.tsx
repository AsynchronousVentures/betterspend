'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';
import { useToast } from '../../../components/toast';
import Breadcrumbs from '../../../components/breadcrumbs';

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [vendor, setVendor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<any>({});
  const [txns, setTxns] = useState<{ invoices: any[]; purchaseOrders: any[] } | null>(null);
  const [onboarding, setOnboarding] = useState<any>(null);
  const [reviewSaving, setReviewSaving] = useState(false);

  useEffect(() => {
    api.vendors.get(id).then((v) => {
      setVendor(v);
      setForm({
        name: v.name || '', code: v.code || '', taxId: v.taxId || '',
        paymentTerms: v.paymentTerms || '', status: v.status || 'active',
        contactName: v.contactInfo?.contactName || '',
        email: v.contactInfo?.email || '',
        phone: v.contactInfo?.phone || '',
        street: v.address?.street || '', city: v.address?.city || '',
        state: v.address?.state || '', postalCode: v.address?.postalCode || '',
        country: v.address?.country || '',
      });
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
    api.vendors.transactions(id).then(setTxns).catch(() => {});
    api.vendors.onboardingDetail(id).then(setOnboarding).catch(() => {});
  }, [id]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await api.vendors.update(id, {
        name: form.name, code: form.code || undefined, taxId: form.taxId || undefined,
        paymentTerms: form.paymentTerms || undefined, status: form.status,
        contactInfo: { contactName: form.contactName || undefined, email: form.email || undefined, phone: form.phone || undefined },
        address: { street: form.street || undefined, city: form.city || undefined, state: form.state || undefined, postalCode: form.postalCode || undefined, country: form.country || undefined },
      });
      setVendor(updated);
      setEditing(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function set(key: string, value: string) {
    setForm((f: any) => ({ ...f, [key]: value }));
  }

  const inputStyle = { width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' as const };
  const labelStyle = { display: 'block', fontSize: '0.875rem', fontWeight: 500, color: COLORS.textSecondary, marginBottom: '0.25rem' };

  const [punchoutSaving, setPunchoutSaving] = useState(false);
  const [portalSending, setPortalSending] = useState(false);
  const [portalMsg, setPortalMsg] = useState('');

  async function handleSendPortalAccess() {
    setPortalSending(true);
    setPortalMsg('');
    try {
      await api.vendorPortal.sendAccess(id);
      setPortalMsg('Access link sent to vendor\'s contact email.');
    } catch (e: any) {
      setPortalMsg('Error: ' + (e.message || 'Failed to send access link'));
    } finally {
      setPortalSending(false);
    }
  }

  async function reviewOnboarding(decision: 'approved' | 'changes_requested') {
    setReviewSaving(true);
    try {
      const updated = await api.vendors.reviewOnboarding(id, { decision });
      setVendor((current: any) => ({ ...current, ...updated }));
      setOnboarding(await api.vendors.onboardingDetail(id));
      toast(decision === 'approved' ? 'Onboarding approved' : 'Changes requested', 'success');
    } catch (e: any) {
      setPortalMsg('Error: ' + (e.message || 'Failed to review onboarding'));
    } finally {
      setReviewSaving(false);
    }
  }

  const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
    active: { bg: '#dcfce7', text: '#15803d' },
    inactive: { bg: COLORS.hoverBg, text: COLORS.textSecondary },
    blocked: { bg: COLORS.accentRedLight, text: COLORS.accentRedDark },
  };
  const ONBOARDING_COLORS: Record<string, { bg: string; text: string }> = {
    approved: { bg: '#dcfce7', text: '#15803d' },
    pending_review: { bg: '#fffbeb', text: '#b45309' },
    changes_requested: { bg: '#fef2f2', text: '#b91c1c' },
    not_started: { bg: COLORS.hoverBg, text: COLORS.textSecondary },
  };

  async function togglePunchout() {
    setPunchoutSaving(true);
    try {
      const updated = await api.vendors.update(id, { punchoutEnabled: !vendor.punchoutEnabled });
      setVendor(updated);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPunchoutSaving(false);
    }
  }

  if (loading) return <div style={{ padding: '2rem', color: COLORS.textSecondary }}>Loading...</div>;
  if (error && !vendor) return <div style={{ padding: '2rem', color: COLORS.accentRedDark }}>{error}</div>;
  if (!vendor) return null;

  const sc = STATUS_COLORS[vendor.status] || { bg: COLORS.hoverBg, text: COLORS.textSecondary };
  const onboardingColor = ONBOARDING_COLORS[vendor.onboardingStatus] || ONBOARDING_COLORS.not_started;
  const latestSubmission = onboarding?.submissions?.[0] ?? null;

  return (
    <div style={{ padding: '2rem', maxWidth: '800px' }}>
      <Breadcrumbs items={[{ label: 'Vendors', href: '/vendors' }, { label: vendor.name }]} />
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/vendors" style={{ color: COLORS.accentBlue, textDecoration: 'none', fontSize: '0.875rem' }}>← Vendors</Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.textPrimary }}>{vendor.name}</h1>
            <span style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, background: sc.bg, color: sc.text }}>
              {vendor.status}
            </span>
          </div>
          {!editing && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={handleSendPortalAccess}
                disabled={portalSending}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#f0fdf4',
                  color: '#15803d',
                  border: '1px solid #bbf7d0',
                  borderRadius: '6px',
                  cursor: portalSending ? 'not-allowed' : 'pointer',
                  fontWeight: 500,
                  fontSize: '0.875rem',
                }}
              >
                {portalSending ? 'Sending...' : 'Send Portal Access Link'}
              </button>
              <button onClick={() => setEditing(true)} style={{ padding: '0.5rem 1rem', background: COLORS.accentBlue, color: COLORS.white, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500 }}>
                Edit
              </button>
            </div>
          )}
        </div>
      </div>

      {!editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Section title="Basic Info">
            <Field label="Code" value={vendor.code || '—'} />
            <Field label="Tax ID" value={vendor.taxId || '—'} />
            <Field label="Payment Terms" value={vendor.paymentTerms || '—'} />
          </Section>
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div>
                <h2 style={{ fontWeight: 600, fontSize: '0.9rem', color: COLORS.textSecondary, margin: 0 }}>Onboarding</h2>
                <p style={{ fontSize: '0.8rem', color: COLORS.textMuted, margin: '0.35rem 0 0' }}>
                  Questionnaire completion, risk score, and buyer review status.
                </p>
              </div>
              <span style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, background: onboardingColor.bg, color: onboardingColor.text }}>
                {String(vendor.onboardingStatus || 'not_started').replace(/_/g, ' ')}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <Field label="Risk Score" value={String(vendor.onboardingRiskScore ?? 0)} />
              <Field label="Risk Level" value={String(vendor.onboardingRiskLevel ?? 'low')} />
              <Field label="Submitted" value={vendor.onboardingLastSubmittedAt ? new Date(vendor.onboardingLastSubmittedAt).toLocaleString() : '—'} />
            </div>
            {latestSubmission && (
              <div style={{ padding: '0.75rem', background: COLORS.hoverBg, borderRadius: '8px', fontSize: '0.82rem', color: COLORS.textSecondary }}>
                Latest questionnaire: {latestSubmission.questionnaire?.name ?? 'Default questionnaire'}
                <br />
                Documents: W-9 {latestSubmission.documentLinks?.w9 ? 'attached' : 'missing'} • COI {latestSubmission.documentLinks?.coi ? 'attached' : 'missing'} • Banking {latestSubmission.documentLinks?.banking ? 'attached' : 'missing'}
                {latestSubmission.reviewNote ? (
                  <>
                    <br />
                    Review note: {latestSubmission.reviewNote}
                  </>
                ) : null}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
              <Link href="/vendors/onboarding" style={{ padding: '0.45rem 0.8rem', borderRadius: '6px', textDecoration: 'none', background: COLORS.accentBlueLight, color: COLORS.accentBlueDark, fontWeight: 600, fontSize: '0.82rem' }}>
                Open Onboarding Queue
              </Link>
              {vendor.onboardingStatus === 'pending_review' && (
                <>
                  <button
                    type="button"
                    onClick={() => reviewOnboarding('approved')}
                    disabled={reviewSaving}
                    style={{ padding: '0.45rem 0.8rem', borderRadius: '6px', border: 'none', background: '#dcfce7', color: '#166534', fontWeight: 600, fontSize: '0.82rem', cursor: reviewSaving ? 'not-allowed' : 'pointer' }}
                  >
                    Approve Onboarding
                  </button>
                  <button
                    type="button"
                    onClick={() => reviewOnboarding('changes_requested')}
                    disabled={reviewSaving}
                    style={{ padding: '0.45rem 0.8rem', borderRadius: '6px', border: 'none', background: '#fef2f2', color: '#b91c1c', fontWeight: 600, fontSize: '0.82rem', cursor: reviewSaving ? 'not-allowed' : 'pointer' }}
                  >
                    Request Changes
                  </button>
                </>
              )}
            </div>
          </div>
          <Section title="Contact">
            <Field label="Contact Name" value={vendor.contactInfo?.contactName || '—'} />
            <Field label="Email" value={vendor.contactInfo?.email || '—'} />
            <Field label="Phone" value={vendor.contactInfo?.phone || '—'} />
          </Section>
          <Section title="Address">
            <Field label="Street" value={vendor.address?.street || '—'} />
            <Field label="City" value={vendor.address?.city || '—'} />
            <Field label="State" value={vendor.address?.state || '—'} />
            <Field label="Postal Code" value={vendor.address?.postalCode || '—'} />
            <Field label="Country" value={vendor.address?.country || '—'} />
          </Section>
          {/* Purchase Orders */}
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
            <h2 style={{ fontWeight: 600, fontSize: '0.9rem', color: COLORS.textSecondary, marginBottom: '0.75rem' }}>
              Purchase Orders {txns ? `(${txns.purchaseOrders.length})` : ''}
            </h2>
            {!txns || txns.purchaseOrders.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: COLORS.textMuted, margin: 0 }}>No purchase orders</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                      {['PO Number', 'Status', 'Amount', 'Issued'].map((h) => (
                        <th key={h} style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {txns.purchaseOrders.map((po: any) => (
                      <tr key={po.id} style={{ borderBottom: `1px solid ${COLORS.hoverBg}` }}>
                        <td style={{ padding: '0.4rem 0.6rem' }}>
                          <Link href={`/purchase-orders/${po.id}`} style={{ color: COLORS.accentBlueDark, textDecoration: 'none' }}>{po.number}</Link>
                        </td>
                        <td style={{ padding: '0.4rem 0.6rem', textTransform: 'capitalize', color: COLORS.textSecondary }}>{po.status}</td>
                        <td style={{ padding: '0.4rem 0.6rem', color: COLORS.textSecondary }}>
                          {po.amount != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(po.amount) : '—'}
                        </td>
                        <td style={{ padding: '0.4rem 0.6rem', color: COLORS.textSecondary }}>{po.issuedAt ? new Date(po.issuedAt).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Invoices */}
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
            <h2 style={{ fontWeight: 600, fontSize: '0.9rem', color: COLORS.textSecondary, marginBottom: '0.75rem' }}>
              Invoices {txns ? `(${txns.invoices.length})` : ''}
            </h2>
            {!txns || txns.invoices.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: COLORS.textMuted, margin: 0 }}>No invoices</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ background: COLORS.tableHeaderBg, borderBottom: `1px solid ${COLORS.tableBorder}` }}>
                      {['Invoice #', 'Vendor #', 'Status', 'Match', 'Amount', 'Date'].map((h) => (
                        <th key={h} style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, color: COLORS.textSecondary }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {txns.invoices.map((inv: any) => (
                      <tr key={inv.id} style={{ borderBottom: `1px solid ${COLORS.hoverBg}` }}>
                        <td style={{ padding: '0.4rem 0.6rem' }}>
                          <Link href={`/invoices/${inv.id}`} style={{ color: COLORS.accentBlueDark, textDecoration: 'none' }}>{inv.number}</Link>
                        </td>
                        <td style={{ padding: '0.4rem 0.6rem', color: COLORS.textSecondary }}>{inv.vendorInvoiceNumber ?? '—'}</td>
                        <td style={{ padding: '0.4rem 0.6rem', textTransform: 'capitalize', color: COLORS.textSecondary }}>{inv.status}</td>
                        <td style={{ padding: '0.4rem 0.6rem', color: inv.matchStatus === 'exception' ? COLORS.accentRedDark : COLORS.textSecondary }}>{inv.matchStatus ?? '—'}</td>
                        <td style={{ padding: '0.4rem 0.6rem', color: COLORS.textSecondary }}>
                          {inv.amount != null ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(inv.amount) : '—'}
                        </td>
                        <td style={{ padding: '0.4rem 0.6rem', color: COLORS.textSecondary }}>{inv.date ? new Date(inv.date).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Vendor Portal */}
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontWeight: 600, fontSize: '0.9rem', color: COLORS.textSecondary, margin: '0 0 0.25rem' }}>Vendor Portal</h2>
                <p style={{ fontSize: '0.8rem', color: COLORS.textSecondary, margin: 0 }}>
                  Send a secure, tokenized portal link to the vendor so they can view POs and submit invoices directly.
                </p>
              </div>
              <button
                onClick={handleSendPortalAccess}
                disabled={portalSending}
                style={{ padding: '0.4rem 1rem', border: 'none', borderRadius: '6px', cursor: portalSending ? 'not-allowed' : 'pointer', background: COLORS.accentBlueLight, color: COLORS.accentBlueDark, fontWeight: 500, fontSize: '0.875rem', whiteSpace: 'nowrap', marginLeft: '1rem' }}
              >
                {portalSending ? 'Sending…' : 'Send Access Link'}
              </button>
            </div>
            {portalMsg && (
              <div style={{ marginTop: '0.75rem', padding: '0.625rem 0.875rem', background: portalMsg.startsWith('Error') ? COLORS.accentRedLight : '#f0fdf4', borderRadius: '6px', fontSize: '0.8rem', color: portalMsg.startsWith('Error') ? COLORS.accentRedDark : '#15803d', border: `1px solid ${portalMsg.startsWith('Error') ? '#fecaca' : '#bbf7d0'}` }}>
                {portalMsg}
              </div>
            )}
          </div>

          {/* Punchout */}
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontWeight: 600, fontSize: '0.9rem', color: COLORS.textSecondary, margin: '0 0 0.25rem' }}>Punchout (cXML)</h2>
                <p style={{ fontSize: '0.8rem', color: COLORS.textSecondary, margin: 0 }}>
                  Allow this vendor&apos;s catalog to be browsed via cXML PunchOut.{' '}
                  {vendor.punchoutEnabled ? (
                    <span style={{ color: '#059669', fontWeight: 600 }}>Enabled</span>
                  ) : (
                    <span style={{ color: COLORS.textMuted }}>Disabled</span>
                  )}
                </p>
              </div>
              <button
                onClick={togglePunchout}
                disabled={punchoutSaving}
                style={{
                  padding: '0.4rem 1rem', border: 'none', borderRadius: '6px', cursor: punchoutSaving ? 'not-allowed' : 'pointer',
                  background: vendor.punchoutEnabled ? COLORS.accentRedLight : '#d1fae5',
                  color: vendor.punchoutEnabled ? COLORS.accentRedDark : '#059669',
                  fontWeight: 500, fontSize: '0.875rem',
                }}
              >
                {punchoutSaving ? '…' : vendor.punchoutEnabled ? 'Disable' : 'Enable'}
              </button>
            </div>
            {vendor.punchoutEnabled && (
              <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f0f9ff', borderRadius: '6px', fontSize: '0.8rem', color: '#0369a1' }}>
                Setup endpoint: <code style={{ fontFamily: 'monospace' }}>POST /api/v1/punchout/vendors/{vendor.id}/setup</code>
              </div>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSave}>
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginBottom: '1rem', boxShadow: SHADOWS.card }}>
            <h2 style={{ fontWeight: 600, marginBottom: '1rem', fontSize: '1rem' }}>Basic Info</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Name *</label>
                <input required value={form.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} />
              </div>
              <div><label style={labelStyle}>Code</label><input value={form.code} onChange={(e) => set('code', e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>Tax ID</label><input value={form.taxId} onChange={(e) => set('taxId', e.target.value)} style={inputStyle} /></div>
              <div>
                <label style={labelStyle}>Payment Terms</label>
                <select value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} style={inputStyle}>
                  {['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Due on Receipt', '2/10 Net 30'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Status</label>
                <select value={form.status} onChange={(e) => set('status', e.target.value)} style={inputStyle}>
                  <option value="active">Active</option><option value="inactive">Inactive</option><option value="blocked">Blocked</option>
                </select>
              </div>
            </div>
          </div>
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginBottom: '1rem', boxShadow: SHADOWS.card }}>
            <h2 style={{ fontWeight: 600, marginBottom: '1rem', fontSize: '1rem' }}>Contact</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div><label style={labelStyle}>Contact Name</label><input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>Email</label><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>Phone</label><input value={form.phone} onChange={(e) => set('phone', e.target.value)} style={inputStyle} /></div>
            </div>
          </div>
          <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.5rem', marginBottom: '1rem', boxShadow: SHADOWS.card }}>
            <h2 style={{ fontWeight: 600, marginBottom: '1rem', fontSize: '1rem' }}>Address</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Street</label><input value={form.street} onChange={(e) => set('street', e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>City</label><input value={form.city} onChange={(e) => set('city', e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>State</label><input value={form.state} onChange={(e) => set('state', e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>Postal Code</label><input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>Country</label><input value={form.country} onChange={(e) => set('country', e.target.value)} style={inputStyle} /></div>
            </div>
          </div>
          {error && <div style={{ background: COLORS.accentRedLight, border: '1px solid #fecaca', borderRadius: '6px', padding: '0.75rem', color: COLORS.accentRedDark, fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="submit" disabled={saving} style={{ padding: '0.625rem 1.25rem', background: COLORS.accentBlue, color: COLORS.white, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => setEditing(false)} style={{ padding: '0.625rem 1.25rem', background: COLORS.tableBorder, color: COLORS.textSecondary, border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.tableBorder}`, borderRadius: '8px', padding: '1.25rem', boxShadow: SHADOWS.card }}>
      <h2 style={{ fontWeight: 600, fontSize: '0.9rem', color: COLORS.textSecondary, marginBottom: '0.75rem' }}>{title}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginBottom: '0.15rem' }}>{label}</div>
      <div style={{ fontSize: '0.875rem', color: COLORS.textPrimary }}>{value}</div>
    </div>
  );
}
