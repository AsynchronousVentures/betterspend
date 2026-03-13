'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { COLORS, SHADOWS } from '../../lib/theme';
import { invalidateBrandingCache } from '../../lib/branding';

type Tab = 'org' | 'branding' | 'email' | 'password' | 'integrations' | 'approval' | 'compliance';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.75rem', border: `1px solid ${COLORS.inputBorder}`,
  borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem', color: COLORS.textPrimary };
const card: React.CSSProperties = { background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: '8px', padding: '1.5rem', boxShadow: SHADOWS.card };

interface OAuthStatus {
  qbo: boolean;
  xero: boolean;
  qboRealmId?: string;
  xeroTenantId?: string;
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'branding';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwError, setPwError] = useState('');

  const [branding, setBranding] = useState({
    app_name: 'BetterSpend', app_logo_url: '', app_favicon_url: '',
    copyright_text: '© 2026 BetterSpend. Open source under MIT License.',
    support_email: '', primary_color: '#3b82f6', accent_color: '#0f172a', hide_powered_by: 'false',
  });
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingMsg, setBrandingMsg] = useState('');
  const [brandingError, setBrandingError] = useState('');

  const [smtp, setSmtp] = useState({
    smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '',
    smtp_from: 'noreply@betterspend.io', smtp_secure: 'false',
  });
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpMsg, setSmtpMsg] = useState('');
  const [smtpError, setSmtpError] = useState('');

  // Approval policy state
  const [approvalPolicy, setApprovalPolicy] = useState({
    auto_approve_threshold: '0',
    auto_approve_require_budget_check: 'false',
    auto_approve_notify_manager: 'true',
  });
  const [approvalPolicySaving, setApprovalPolicySaving] = useState(false);
  const [approvalPolicyMsg, setApprovalPolicyMsg] = useState('');
  const [approvalPolicyError, setApprovalPolicyError] = useState('');

  // Contract compliance state
  const [compliance, setCompliance] = useState({
    contract_price_deviation_threshold: '5',
    contract_price_deviation_action: 'warn' as 'warn' | 'block',
  });
  const [complianceSaving, setComplianceSaving] = useState(false);
  const [complianceMsg, setComplianceMsg] = useState('');
  const [complianceError, setComplianceError] = useState('');

  // Integrations state
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>({ qbo: false, xero: false });
  const [oauthLoading, setOauthLoading] = useState(false);
  const [integrationsMsg, setIntegrationsMsg] = useState('');
  const [integrationsError, setIntegrationsError] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [exchangeRates, setExchangeRates] = useState<any[]>([]);
  const [rateForm, setRateForm] = useState({ fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' });
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgMsg, setOrgMsg] = useState('');
  const [orgError, setOrgError] = useState('');

  useEffect(() => {
    api.settings.getAll().then((all) => {
      setBranding((b) => ({ ...b, ...Object.fromEntries(Object.entries(all).filter(([k]) => Object.keys(b).includes(k))) }));
      setSmtp((s) => ({ ...s, ...Object.fromEntries(Object.entries(all).filter(([k]) => Object.keys(s).includes(k))) }));
      setApprovalPolicy((p) => ({ ...p, ...Object.fromEntries(Object.entries(all).filter(([k]) => Object.keys(p).includes(k))) }));
      setCompliance((c) => ({
        contract_price_deviation_threshold: all.contract_price_deviation_threshold ?? c.contract_price_deviation_threshold,
        contract_price_deviation_action: (all.contract_price_deviation_action as 'warn' | 'block') ?? c.contract_price_deviation_action,
      }));
    }).catch(() => {});
    api.exchangeRates.getBaseCurrency().then((data) => setBaseCurrency(data.baseCurrency ?? 'USD')).catch(() => {});
    api.exchangeRates.list().then(setExchangeRates).catch(() => {});
  }, []);

  // Load OAuth connection status and handle callback params
  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    const message = searchParams.get('message');

    if (connected) {
      setIntegrationsMsg(`${connected === 'qbo' ? 'QuickBooks Online' : 'Xero'} connected successfully.`);
    }
    if (error) {
      setIntegrationsError(`Failed to connect ${error === 'qbo' ? 'QuickBooks Online' : 'Xero'}: ${message ? decodeURIComponent(message) : 'Unknown error'}`);
    }

    api.gl.oauthStatus().then(setOauthStatus).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: active ? 600 : 400,
    color: active ? COLORS.textPrimary : COLORS.textSecondary, cursor: 'pointer', background: 'none', border: 'none',
    borderBottom: `2px solid ${active ? COLORS.accentBlue : 'transparent'}`,
  });

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault(); setPwError(''); setPwMsg('');
    if (pwForm.newPassword !== pwForm.confirmPassword) { setPwError('New passwords do not match'); return; }
    if (pwForm.newPassword.length < 8) { setPwError('Password must be at least 8 characters'); return; }
    setPwSaving(true);
    try {
      const res = await api.auth.changePassword({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      if (res.ok) { setPwMsg('Password changed successfully.'); setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); }
      else { const err = await res.json().catch(() => ({})); setPwError(err.message || 'Failed to change password'); }
    } catch (e: any) { setPwError(e.message); } finally { setPwSaving(false); }
  }

  async function handleSaveBranding(e: React.FormEvent) {
    e.preventDefault(); setBrandingError(''); setBrandingMsg(''); setBrandingSaving(true);
    try {
      await api.settings.updateBranding(branding);
      invalidateBrandingCache();
      setBrandingMsg('Branding settings saved. Reload the page to see changes in the sidebar.');
    } catch (e: any) { setBrandingError(e.message); } finally { setBrandingSaving(false); }
  }

  async function handleSaveSmtp(e: React.FormEvent) {
    e.preventDefault(); setSmtpError(''); setSmtpMsg(''); setSmtpSaving(true);
    try {
      await api.settings.updateSmtp(smtp);
      setSmtpMsg('SMTP settings saved.');
    } catch (e: any) { setSmtpError(e.message); } finally { setSmtpSaving(false); }
  }

  async function handleSaveApprovalPolicy(e: React.FormEvent) {
    e.preventDefault(); setApprovalPolicyError(''); setApprovalPolicyMsg(''); setApprovalPolicySaving(true);
    try {
      await api.settings.updateApprovalPolicy(approvalPolicy);
      setApprovalPolicyMsg('Approval policy saved.');
    } catch (e: any) { setApprovalPolicyError(e.message); } finally { setApprovalPolicySaving(false); }
  }

  async function handleSaveCompliance(e: React.FormEvent) {
    e.preventDefault(); setComplianceError(''); setComplianceMsg(''); setComplianceSaving(true);
    try {
      await api.settings.updateContractCompliance(compliance);
      setComplianceMsg('Contract compliance settings saved.');
    } catch (e: any) { setComplianceError(e.message); } finally { setComplianceSaving(false); }
  }

  async function handleConnectQbo() {
    setIntegrationsError(''); setIntegrationsMsg(''); setOauthLoading(true);
    try {
      const { url } = await api.gl.oauthConnect('qbo');
      window.location.href = url;
    } catch (e: any) { setIntegrationsError(e.message); setOauthLoading(false); }
  }

  async function handleConnectXero() {
    setIntegrationsError(''); setIntegrationsMsg(''); setOauthLoading(true);
    try {
      const { url } = await api.gl.oauthConnect('xero');
      window.location.href = url;
    } catch (e: any) { setIntegrationsError(e.message); setOauthLoading(false); }
  }

  async function handleDisconnectQbo() {
    setIntegrationsError(''); setIntegrationsMsg('');
    try {
      await api.gl.oauthDisconnect('qbo');
      setOauthStatus((s) => ({ ...s, qbo: false, qboRealmId: undefined }));
      setIntegrationsMsg('QuickBooks Online disconnected.');
    } catch (e: any) { setIntegrationsError(e.message); }
  }

  async function handleDisconnectXero() {
    setIntegrationsError(''); setIntegrationsMsg('');
    try {
      await api.gl.oauthDisconnect('xero');
      setOauthStatus((s) => ({ ...s, xero: false, xeroTenantId: undefined }));
      setIntegrationsMsg('Xero disconnected.');
    } catch (e: any) { setIntegrationsError(e.message); }
  }

  async function handleSaveOrg(e: React.FormEvent) {
    e.preventDefault();
    setOrgError('');
    setOrgMsg('');
    setOrgSaving(true);
    try {
      await api.exchangeRates.updateBaseCurrency(baseCurrency);
      await api.exchangeRates.create({
        fromCurrency: rateForm.fromCurrency.toUpperCase(),
        toCurrency: rateForm.toCurrency.toUpperCase(),
        rate: parseFloat(rateForm.rate),
        isManual: true,
      });
      const [base, rates] = await Promise.all([api.exchangeRates.getBaseCurrency(), api.exchangeRates.list()]);
      setBaseCurrency(base.baseCurrency ?? 'USD');
      setExchangeRates(rates);
      setOrgMsg('Base currency and exchange rates saved.');
    } catch (e: any) {
      setOrgError(e.message);
    } finally {
      setOrgSaving(false);
    }
  }

  const successStyle: React.CSSProperties = { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '0.75rem', color: '#15803d', fontSize: '0.875rem', marginTop: '1rem' };
  const errorStyle: React.CSSProperties = { background: COLORS.accentRedLight, border: '1px solid #fecaca', borderRadius: '6px', padding: '0.75rem', color: COLORS.accentRedDark, fontSize: '0.875rem', marginTop: '1rem' };
  const btnPrimary: React.CSSProperties = { padding: '0.625rem 1.25rem', background: COLORS.accentBlue, color: COLORS.white, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem' };
  const btnDanger: React.CSSProperties = { padding: '0.5rem 1rem', background: 'transparent', color: COLORS.accentRedDark, border: `1px solid #fecaca`, borderRadius: '6px', cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem' };

  return (
    <div style={{ padding: '2rem', maxWidth: '720px' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: COLORS.textPrimary, marginBottom: '1.5rem' }}>Settings</h1>
      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${COLORS.border}`, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {(['branding', 'email', 'approval', 'compliance', 'integrations', 'org', 'password'] as Tab[]).map((t) => (
          <button key={t} style={tabStyle(activeTab === t)} onClick={() => setActiveTab(t)}>
            {t === 'branding' ? 'Branding' : t === 'email' ? 'Email / SMTP' : t === 'approval' ? 'Approval Policy' : t === 'compliance' ? 'Contract Compliance' : t === 'integrations' ? 'Integrations' : t === 'org' ? 'System Info' : 'Change Password'}
          </button>
        ))}
      </div>

      {activeTab === 'branding' && (
        <form onSubmit={handleSaveBranding}>
          <div style={card}>
            <h2 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem', color: COLORS.textPrimary }}>White-Label Branding</h2>
            <p style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, marginBottom: '1.5rem', marginTop: '0.25rem' }}>
              Customize the app name, logo, colors, and footer. Perfect for agencies and enterprise deployments. Changes are reflected across all users.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Application Name</label>
                  <input style={inputStyle} value={branding.app_name} onChange={(e) => setBranding((b) => ({ ...b, app_name: e.target.value }))} placeholder="BetterSpend" />
                </div>
                <div>
                  <label style={labelStyle}>Support Email</label>
                  <input type="email" style={inputStyle} value={branding.support_email} onChange={(e) => setBranding((b) => ({ ...b, support_email: e.target.value }))} placeholder="support@yourcompany.com" />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Logo URL <span style={{ fontWeight: 400, color: COLORS.textMuted }}>(shown in sidebar)</span></label>
                <input style={inputStyle} value={branding.app_logo_url} onChange={(e) => setBranding((b) => ({ ...b, app_logo_url: e.target.value }))} placeholder="https://example.com/logo.svg" />
                {branding.app_logo_url && <img src={branding.app_logo_url} alt="Logo preview" style={{ marginTop: '0.5rem', maxHeight: '40px', borderRadius: '4px' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
              </div>
              <div>
                <label style={labelStyle}>Copyright / Footer Text</label>
                <input style={inputStyle} value={branding.copyright_text} onChange={(e) => setBranding((b) => ({ ...b, copyright_text: e.target.value }))} placeholder="© 2026 Your Company. All rights reserved." />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Primary Color <span style={{ fontWeight: 400, color: COLORS.textMuted }}>(buttons, links)</span></label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input type="color" value={branding.primary_color} onChange={(e) => setBranding((b) => ({ ...b, primary_color: e.target.value }))} style={{ width: '40px', height: '36px', padding: '2px', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', cursor: 'pointer' }} />
                    <input style={{ ...inputStyle, flex: 1 }} value={branding.primary_color} onChange={(e) => setBranding((b) => ({ ...b, primary_color: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Sidebar Color</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input type="color" value={branding.accent_color} onChange={(e) => setBranding((b) => ({ ...b, accent_color: e.target.value }))} style={{ width: '40px', height: '36px', padding: '2px', border: `1px solid ${COLORS.inputBorder}`, borderRadius: '6px', cursor: 'pointer' }} />
                    <input style={{ ...inputStyle, flex: 1 }} value={branding.accent_color} onChange={(e) => setBranding((b) => ({ ...b, accent_color: e.target.value }))} />
                  </div>
                </div>
              </div>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: 'pointer', fontSize: '0.875rem', color: COLORS.textPrimary }}>
                <input type="checkbox" checked={branding.hide_powered_by === 'true'} onChange={(e) => setBranding((b) => ({ ...b, hide_powered_by: e.target.checked ? 'true' : 'false' }))} />
                Hide "Powered by BetterSpend" footer attribution
              </label>
            </div>
            {brandingError && <div style={errorStyle}>{brandingError}</div>}
            {brandingMsg && <div style={successStyle}>{brandingMsg}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button type="submit" disabled={brandingSaving} style={btnPrimary}>{brandingSaving ? 'Saving...' : 'Save Branding'}</button>
            </div>
          </div>
        </form>
      )}

      {activeTab === 'email' && (
        <form onSubmit={handleSaveSmtp}>
          <div style={card}>
            <h2 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem', color: COLORS.textPrimary }}>Email / SMTP Configuration</h2>
            <p style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, marginBottom: '1.5rem', marginTop: '0.25rem' }}>
              Configure SMTP to enable email notifications for approvals, PO issuance, invoice exceptions, and contract expiry alerts.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>SMTP Host</label>
                  <input style={inputStyle} value={smtp.smtp_host} onChange={(e) => setSmtp((s) => ({ ...s, smtp_host: e.target.value }))} placeholder="smtp.gmail.com" />
                </div>
                <div>
                  <label style={labelStyle}>Port</label>
                  <input type="number" style={inputStyle} value={smtp.smtp_port} onChange={(e) => setSmtp((s) => ({ ...s, smtp_port: e.target.value }))} placeholder="587" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={labelStyle}>Username</label>
                  <input style={inputStyle} value={smtp.smtp_user} onChange={(e) => setSmtp((s) => ({ ...s, smtp_user: e.target.value }))} placeholder="user@example.com" />
                </div>
                <div>
                  <label style={labelStyle}>Password</label>
                  <input type="password" style={inputStyle} value={smtp.smtp_pass} onChange={(e) => setSmtp((s) => ({ ...s, smtp_pass: e.target.value }))} placeholder="••••••••" />
                </div>
              </div>
              <div>
                <label style={labelStyle}>From Address</label>
                <input type="email" style={inputStyle} value={smtp.smtp_from} onChange={(e) => setSmtp((s) => ({ ...s, smtp_from: e.target.value }))} placeholder="noreply@yourcompany.com" />
              </div>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: 'pointer', fontSize: '0.875rem', color: COLORS.textPrimary }}>
                <input type="checkbox" checked={smtp.smtp_secure === 'true'} onChange={(e) => setSmtp((s) => ({ ...s, smtp_secure: e.target.checked ? 'true' : 'false' }))} />
                Use TLS/SSL (port 465)
              </label>
              <div style={{ padding: '0.75rem 1rem', background: COLORS.accentBlueLight, borderRadius: '6px', border: '1px solid #bfdbfe', fontSize: '0.8125rem', color: '#1e40af' }}>
                Notifications sent for: approval requests, PO issued, invoice match exceptions, and contract expiry alerts.
              </div>
            </div>
            {smtpError && <div style={errorStyle}>{smtpError}</div>}
            {smtpMsg && <div style={successStyle}>{smtpMsg}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button type="submit" disabled={smtpSaving} style={btnPrimary}>{smtpSaving ? 'Saving...' : 'Save SMTP Settings'}</button>
            </div>
          </div>
        </form>
      )}

      {activeTab === 'approval' && (
        <form onSubmit={handleSaveApprovalPolicy}>
          <div style={card}>
            <h2 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem', color: COLORS.textPrimary }}>Approval Policy</h2>
            <p style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, marginBottom: '1.5rem', marginTop: '0.25rem' }}>
              Configure the low-value purchase fast lane. Requisitions at or below the threshold are automatically approved without requiring manual review.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={labelStyle}>Auto-approve Threshold</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1rem', color: COLORS.textSecondary, fontWeight: 600 }}>$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    style={{ ...inputStyle, maxWidth: '200px' }}
                    value={approvalPolicy.auto_approve_threshold}
                    onChange={(e) => setApprovalPolicy((p) => ({ ...p, auto_approve_threshold: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <p style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginTop: '0.375rem' }}>
                  Set to 0 to disable auto-approval. Requisitions at or below this amount are approved instantly.
                </p>
              </div>
              <label style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start', cursor: 'pointer', fontSize: '0.875rem', color: COLORS.textPrimary }}>
                <input
                  type="checkbox"
                  style={{ marginTop: '2px', flexShrink: 0 }}
                  checked={approvalPolicy.auto_approve_require_budget_check === 'true'}
                  onChange={(e) => setApprovalPolicy((p) => ({ ...p, auto_approve_require_budget_check: e.target.checked ? 'true' : 'false' }))}
                />
                <div>
                  <div style={{ fontWeight: 500 }}>Require budget check</div>
                  <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginTop: '0.125rem' }}>Only auto-approve if the requisition is within budget limits</div>
                </div>
              </label>
              <label style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start', cursor: 'pointer', fontSize: '0.875rem', color: COLORS.textPrimary }}>
                <input
                  type="checkbox"
                  style={{ marginTop: '2px', flexShrink: 0 }}
                  checked={approvalPolicy.auto_approve_notify_manager === 'true'}
                  onChange={(e) => setApprovalPolicy((p) => ({ ...p, auto_approve_notify_manager: e.target.checked ? 'true' : 'false' }))}
                />
                <div>
                  <div style={{ fontWeight: 500 }}>Add audit note when auto-approving</div>
                  <div style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginTop: '0.125rem' }}>Adds a detailed note to the approval record explaining why it was auto-approved</div>
                </div>
              </label>
              {Number(approvalPolicy.auto_approve_threshold) > 0 && (
                <div style={{ padding: '0.75rem 1rem', background: COLORS.accentGreenLight, borderRadius: '6px', border: `1px solid ${COLORS.accentGreen}`, fontSize: '0.8125rem', color: COLORS.accentGreenDark }}>
                  Fast lane active: requisitions up to ${Number(approvalPolicy.auto_approve_threshold).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} will be auto-approved.
                </div>
              )}
            </div>
            {approvalPolicyError && <div style={errorStyle}>{approvalPolicyError}</div>}
            {approvalPolicyMsg && <div style={successStyle}>{approvalPolicyMsg}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button type="submit" disabled={approvalPolicySaving} style={btnPrimary}>
                {approvalPolicySaving ? 'Saving...' : 'Save Approval Policy'}
              </button>
            </div>
          </div>
        </form>
      )}

      {activeTab === 'compliance' && (
        <form onSubmit={handleSaveCompliance}>
          <div style={card}>
            <h2 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem', color: COLORS.textPrimary }}>Contract Compliance</h2>
            <p style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, marginBottom: '1.5rem', marginTop: '0.25rem' }}>
              Configure how the system handles purchase order line prices that deviate from contracted rates. Compliance is checked automatically when creating or modifying PO lines.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={labelStyle}>Deviation Threshold</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    style={{ ...inputStyle, maxWidth: '120px' }}
                    value={compliance.contract_price_deviation_threshold}
                    onChange={(e) => setCompliance((c) => ({ ...c, contract_price_deviation_threshold: e.target.value }))}
                  />
                  <span style={{ fontSize: '0.875rem', color: COLORS.textSecondary, fontWeight: 500 }}>%</span>
                </div>
                <p style={{ fontSize: '0.8rem', color: COLORS.textMuted, marginTop: '0.375rem', margin: '0.375rem 0 0' }}>
                  Price deviations within this percentage of the contracted price are treated as minor deviations. Set to 0 to require exact price match.
                </p>
              </div>
              <div>
                <label style={labelStyle}>Action When Threshold Exceeded</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginTop: '0.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="deviation_action"
                      value="warn"
                      checked={compliance.contract_price_deviation_action === 'warn'}
                      onChange={() => setCompliance((c) => ({ ...c, contract_price_deviation_action: 'warn' }))}
                      style={{ marginTop: '0.15rem' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500, color: COLORS.textPrimary }}>Warn</div>
                      <div style={{ fontSize: '0.8rem', color: COLORS.textSecondary }}>Show an amber warning badge on the PO line, but allow submission.</div>
                    </div>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="deviation_action"
                      value="block"
                      checked={compliance.contract_price_deviation_action === 'block'}
                      onChange={() => setCompliance((c) => ({ ...c, contract_price_deviation_action: 'block' }))}
                      style={{ marginTop: '0.15rem' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500, color: COLORS.textPrimary }}>Block submission</div>
                      <div style={{ fontSize: '0.8rem', color: COLORS.textSecondary }}>Prevent PO creation if any line price exceeds the threshold.</div>
                    </div>
                  </label>
                </div>
              </div>
              <div style={{ padding: '0.75rem 1rem', background: COLORS.accentBlueLight, borderRadius: '6px', border: '1px solid #bfdbfe', fontSize: '0.8125rem', color: '#1e40af' }}>
                Compliance is checked against active contracts for the selected vendor. Lines without a matching contract line are marked as "No contract" and are not subject to threshold enforcement.
              </div>
            </div>
            {complianceError && <div style={errorStyle}>{complianceError}</div>}
            {complianceMsg && <div style={successStyle}>{complianceMsg}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button type="submit" disabled={complianceSaving} style={btnPrimary}>{complianceSaving ? 'Saving...' : 'Save Compliance Settings'}</button>
            </div>
          </div>
        </form>
      )}

      {activeTab === 'integrations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={card}>
            <h2 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem', color: COLORS.textPrimary }}>GL Integrations</h2>
            <p style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, marginBottom: '1.5rem', marginTop: '0.25rem' }}>
              Connect your accounting platform to automatically post approved invoices as bills or AP invoices. OAuth tokens are stored securely per organization.
            </p>

            {integrationsMsg && <div style={successStyle}>{integrationsMsg}</div>}
            {integrationsError && <div style={errorStyle}>{integrationsError}</div>}

            {/* QuickBooks Online */}
            <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem', marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: COLORS.textPrimary }}>QuickBooks Online</span>
                    {oauthStatus.qbo ? (
                      <span style={{ background: '#dcfce7', color: '#15803d', fontSize: '0.75rem', fontWeight: 600, padding: '0.125rem 0.5rem', borderRadius: '999px', border: '1px solid #bbf7d0' }}>Connected</span>
                    ) : (
                      <span style={{ background: COLORS.accentRedLight, color: COLORS.accentRedDark, fontSize: '0.75rem', fontWeight: 600, padding: '0.125rem 0.5rem', borderRadius: '999px', border: '1px solid #fecaca' }}>Not connected</span>
                    )}
                  </div>
                  <p style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, margin: 0 }}>
                    Posts approved invoices as Bills in QuickBooks Online using the Accounting API.
                  </p>
                  {oauthStatus.qbo && oauthStatus.qboRealmId && (
                    <p style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginTop: '0.25rem', fontFamily: 'monospace' }}>
                      Realm ID: {oauthStatus.qboRealmId}
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, marginLeft: '1rem' }}>
                  {oauthStatus.qbo ? (
                    <button onClick={handleDisconnectQbo} style={btnDanger}>Disconnect</button>
                  ) : (
                    <button onClick={handleConnectQbo} disabled={oauthLoading} style={btnPrimary}>
                      {oauthLoading ? 'Redirecting...' : 'Connect QuickBooks'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Xero */}
            <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: '8px', padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: COLORS.textPrimary }}>Xero</span>
                    {oauthStatus.xero ? (
                      <span style={{ background: '#dcfce7', color: '#15803d', fontSize: '0.75rem', fontWeight: 600, padding: '0.125rem 0.5rem', borderRadius: '999px', border: '1px solid #bbf7d0' }}>Connected</span>
                    ) : (
                      <span style={{ background: COLORS.accentRedLight, color: COLORS.accentRedDark, fontSize: '0.75rem', fontWeight: 600, padding: '0.125rem 0.5rem', borderRadius: '999px', border: '1px solid #fecaca' }}>Not connected</span>
                    )}
                  </div>
                  <p style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, margin: 0 }}>
                    Posts approved invoices as Accounts Payable invoices in Xero using the Accounting API.
                  </p>
                  {oauthStatus.xero && oauthStatus.xeroTenantId && (
                    <p style={{ fontSize: '0.75rem', color: COLORS.textMuted, marginTop: '0.25rem', fontFamily: 'monospace' }}>
                      Tenant ID: {oauthStatus.xeroTenantId}
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, marginLeft: '1rem' }}>
                  {oauthStatus.xero ? (
                    <button onClick={handleDisconnectXero} style={btnDanger}>Disconnect</button>
                  ) : (
                    <button onClick={handleConnectXero} disabled={oauthLoading} style={btnPrimary}>
                      {oauthLoading ? 'Redirecting...' : 'Connect Xero'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div style={{ padding: '0.75rem 1rem', background: '#fef9c3', borderRadius: '6px', border: '1px solid #fde68a', fontSize: '0.8125rem', color: COLORS.accentAmberDark, marginTop: '1rem' }}>
              Configure <code style={{ fontFamily: 'monospace' }}>QBO_CLIENT_ID</code>, <code style={{ fontFamily: 'monospace' }}>QBO_CLIENT_SECRET</code>, <code style={{ fontFamily: 'monospace' }}>XERO_CLIENT_ID</code>, and <code style={{ fontFamily: 'monospace' }}>XERO_CLIENT_SECRET</code> environment variables before connecting.
            </div>
          </div>
        </div>
      )}

      {activeTab === 'org' && (
        <form onSubmit={handleSaveOrg} style={card}>
          <h2 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '1rem', color: COLORS.textPrimary }}>System Information</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <InfoRow label="Organization ID" value="00000000-0000-0000-0000-000000000001" mono />
            <InfoRow label="Demo Organization" value="Acme Corp" />
            <InfoRow label="API Base URL" value={process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001'} mono />
            <InfoRow label="Version" value="BetterSpend v1.0.0-beta" />
            <InfoRow label="License" value="MIT License" />
            <InfoRow label="Source Code" value="github.com/AsyncronousVentures/betterspend" />
          </div>
          <div style={{ marginTop: '1.5rem', padding: '1rem', background: COLORS.contentBg, borderRadius: '6px', border: `1px solid ${COLORS.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>Tax Code Management</h3>
                <p style={{ fontSize: '0.8125rem', color: COLORS.textSecondary, margin: '0.35rem 0 0' }}>
                  Manage VAT and sales tax rates used on purchase order and invoice lines.
                </p>
              </div>
              <Link
                href="/tax-codes"
                style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                Open Tax Codes
              </Link>
            </div>
          </div>
          <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Organization Base Currency</label>
                <input style={inputStyle} maxLength={3} value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value.toUpperCase())} />
              </div>
              <div>
                <label style={labelStyle}>Manual Exchange Rate</label>
                <input style={inputStyle} type="number" min="0" step="0.00000001" value={rateForm.rate} onChange={(e) => setRateForm((prev) => ({ ...prev, rate: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>From Currency</label>
                <input style={inputStyle} maxLength={3} value={rateForm.fromCurrency} onChange={(e) => setRateForm((prev) => ({ ...prev, fromCurrency: e.target.value.toUpperCase() }))} />
              </div>
              <div>
                <label style={labelStyle}>To Currency</label>
                <input style={inputStyle} maxLength={3} value={rateForm.toCurrency} onChange={(e) => setRateForm((prev) => ({ ...prev, toCurrency: e.target.value.toUpperCase() }))} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: COLORS.textSecondary, marginBottom: '0.5rem' }}>Latest Exchange Rates</div>
              <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: '6px', overflow: 'hidden' }}>
                {exchangeRates.length === 0 ? (
                  <div style={{ padding: '0.875rem 1rem', fontSize: '0.875rem', color: COLORS.textMuted }}>No exchange rates configured yet.</div>
                ) : exchangeRates.map((rate, idx) => (
                  <div key={`${rate.fromCurrency}-${rate.toCurrency}-${rate.id ?? idx}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: idx < exchangeRates.length - 1 ? `1px solid ${COLORS.contentBg}` : undefined }}>
                    <span style={{ fontSize: '0.875rem', color: COLORS.textPrimary }}>{rate.fromCurrency} → {rate.toCurrency}</span>
                    <span style={{ fontSize: '0.875rem', color: COLORS.textSecondary, fontFamily: 'monospace' }}>{Number(rate.rate).toFixed(6)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {orgError && <div style={errorStyle}>{orgError}</div>}
          {orgMsg && <div style={successStyle}>{orgMsg}</div>}
          <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#fef9c3', borderRadius: '6px', border: '1px solid #fde68a' }}>
            <p style={{ fontSize: '0.85rem', color: COLORS.accentAmberDark, margin: 0 }}>
              <strong>Open Source (MIT):</strong> BetterSpend is free to use, modify, and distribute. White-labeling is fully supported via the Branding tab.
            </p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button type="submit" disabled={orgSaving} style={btnPrimary}>{orgSaving ? 'Saving...' : 'Save Currency Settings'}</button>
          </div>
        </form>
      )}

      {activeTab === 'password' && (
        <div style={card}>
          <h2 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '1rem', color: COLORS.textPrimary }}>Change Password</h2>
          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div><label style={labelStyle}>Current Password</label><input type="password" required value={pwForm.currentPassword} onChange={(e) => setPwForm((f) => ({ ...f, currentPassword: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>New Password</label><input type="password" required value={pwForm.newPassword} onChange={(e) => setPwForm((f) => ({ ...f, newPassword: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>Confirm New Password</label><input type="password" required value={pwForm.confirmPassword} onChange={(e) => setPwForm((f) => ({ ...f, confirmPassword: e.target.value }))} style={inputStyle} /></div>
            {pwError && <div style={errorStyle}>{pwError}</div>}
            {pwMsg && <div style={successStyle}>{pwMsg}</div>}
            <button type="submit" disabled={pwSaving} style={btnPrimary}>{pwSaving ? 'Changing...' : 'Change Password'}</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', color: COLORS.textMuted }}>Loading settings...</div>}>
      <SettingsContent />
    </Suspense>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: `1px solid ${COLORS.contentBg}` }}>
      <span style={{ fontSize: '0.875rem', color: COLORS.textSecondary }}>{label}</span>
      <span style={{ fontSize: '0.875rem', color: COLORS.textPrimary, fontFamily: mono ? 'monospace' : undefined }}>{value}</span>
    </div>
  );
}
