'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  BadgeCheck,
  Building2,
  CircleAlert,
  CreditCard,
  ExternalLink,
  KeyRound,
  Landmark,
  Mail,
  Palette,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../../lib/api';
import { invalidateBrandingCache } from '../../lib/branding';
import { appReleaseLabel } from '../../lib/release';
import { PageHeader } from '../../components/page-header';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';

type Tab = 'org' | 'branding' | 'email' | 'password' | 'integrations' | 'approval' | 'compliance';

interface OAuthStatus {
  qbo: boolean;
  xero: boolean;
  qboRealmId?: string;
  xeroTenantId?: string;
  qboConfigured?: boolean;
  xeroConfigured?: boolean;
  qboConnectionMode?: 'platform';
  xeroConnectionMode?: 'platform';
}

interface SettingsSnapshots {
  branding: Record<string, string>;
  smtp: Record<string, string>;
  approvalPolicy: Record<string, string>;
  compliance: {
    contract_price_deviation_threshold: string;
    contract_price_deviation_action: 'warn' | 'block';
  };
  org: {
    baseCurrency: string;
    rateForm: {
      fromCurrency: string;
      toCurrency: string;
      rate: string;
    };
    editingRateId: string | null;
  };
}

const TAB_META: Record<Tab, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  branding: { label: 'Branding', icon: Palette },
  email: { label: 'Email / SMTP', icon: Mail },
  approval: { label: 'Approval Policy', icon: BadgeCheck },
  compliance: { label: 'Contract Compliance', icon: ShieldCheck },
  integrations: { label: 'Integrations', icon: CreditCard },
  org: { label: 'System Info', icon: Building2 },
  password: { label: 'Change Password', icon: KeyRound },
};

function SettingsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'branding';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const nextTab = (searchParams.get('tab') as Tab | null) ?? 'branding';
    setActiveTab(nextTab);
  }, [searchParams]);

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwError, setPwError] = useState('');

  const [branding, setBranding] = useState({
    app_name: 'BetterSpend',
    app_logo_url: '',
    app_favicon_url: '',
    copyright_text: '© 2026 BetterSpend. Open source under MIT License.',
    support_email: '',
    primary_color: '#3b82f6',
    accent_color: '#0f172a',
    hide_powered_by: 'false',
  });
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingMsg, setBrandingMsg] = useState('');
  const [brandingError, setBrandingError] = useState('');

  const [smtp, setSmtp] = useState({
    smtp_host: '',
    smtp_port: '587',
    smtp_user: '',
    smtp_pass: '',
    smtp_from: 'noreply@betterspend.io',
    smtp_secure: 'false',
  });
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpMsg, setSmtpMsg] = useState('');
  const [smtpError, setSmtpError] = useState('');

  const [approvalPolicy, setApprovalPolicy] = useState({
    auto_approve_threshold: '0',
    auto_approve_require_budget_check: 'false',
    auto_approve_notify_manager: 'true',
  });
  const [approvalPolicySaving, setApprovalPolicySaving] = useState(false);
  const [approvalPolicyMsg, setApprovalPolicyMsg] = useState('');
  const [approvalPolicyError, setApprovalPolicyError] = useState('');

  const [compliance, setCompliance] = useState({
    contract_price_deviation_threshold: '5',
    contract_price_deviation_action: 'warn' as 'warn' | 'block',
  });
  const [complianceSaving, setComplianceSaving] = useState(false);
  const [complianceMsg, setComplianceMsg] = useState('');
  const [complianceError, setComplianceError] = useState('');

  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>({ qbo: false, xero: false });
  const [oauthLoading, setOauthLoading] = useState(false);
  const [integrationsMsg, setIntegrationsMsg] = useState('');
  const [integrationsError, setIntegrationsError] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [exchangeRates, setExchangeRates] = useState<any[]>([]);
  const [rateForm, setRateForm] = useState({ fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' });
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgMsg, setOrgMsg] = useState('');
  const [orgError, setOrgError] = useState('');
  const [snapshots, setSnapshots] = useState<SettingsSnapshots>({
    branding: {
      app_name: 'BetterSpend',
      app_logo_url: '',
      app_favicon_url: '',
      copyright_text: '© 2026 BetterSpend. Open source under MIT License.',
      support_email: '',
      primary_color: '#3b82f6',
      accent_color: '#0f172a',
      hide_powered_by: 'false',
    },
    smtp: {
      smtp_host: '',
      smtp_port: '587',
      smtp_user: '',
      smtp_pass: '',
      smtp_from: 'noreply@betterspend.io',
      smtp_secure: 'false',
    },
    approvalPolicy: {
      auto_approve_threshold: '0',
      auto_approve_require_budget_check: 'false',
      auto_approve_notify_manager: 'true',
    },
    compliance: {
      contract_price_deviation_threshold: '5',
      contract_price_deviation_action: 'warn',
    },
    org: {
      baseCurrency: 'USD',
      rateForm: { fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' },
      editingRateId: null,
    },
  });

  function confirmLeaveIfDirty() {
    return window.confirm('You have unsaved changes. Are you sure you want to leave?');
  }

  const isBrandingDirty = JSON.stringify(branding) !== JSON.stringify(snapshots.branding);
  const isSmtpDirty = JSON.stringify(smtp) !== JSON.stringify(snapshots.smtp);
  const isApprovalDirty = JSON.stringify(approvalPolicy) !== JSON.stringify(snapshots.approvalPolicy);
  const isComplianceDirty = JSON.stringify(compliance) !== JSON.stringify(snapshots.compliance);
  const isOrgDirty =
    baseCurrency !== snapshots.org.baseCurrency ||
    JSON.stringify(rateForm) !== JSON.stringify(snapshots.org.rateForm) ||
    editingRateId !== snapshots.org.editingRateId;
  const hasUnsavedChanges = isBrandingDirty || isSmtpDirty || isApprovalDirty || isComplianceDirty || isOrgDirty;

  async function refreshExchangeRateSettings() {
    const [base, rates] = await Promise.all([
      api.exchangeRates.getBaseCurrency(),
      api.exchangeRates.list(),
    ]);
    setBaseCurrency(base.baseCurrency ?? 'USD');
    setExchangeRates(rates);
    setSnapshots((prev) => ({
      ...prev,
      org: {
        baseCurrency: base.baseCurrency ?? 'USD',
        rateForm: { fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' },
        editingRateId: null,
      },
    }));
  }

  useEffect(() => {
    api.settings
      .getAll()
      .then((all) => {
        const nextBranding = {
          ...branding,
          ...Object.fromEntries(Object.entries(all).filter(([key]) => Object.keys(branding).includes(key))),
        };
        const nextSmtp = {
          ...smtp,
          ...Object.fromEntries(Object.entries(all).filter(([key]) => Object.keys(smtp).includes(key))),
        };
        const nextApprovalPolicy = {
          ...approvalPolicy,
          ...Object.fromEntries(
            Object.entries(all).filter(([key]) => Object.keys(approvalPolicy).includes(key)),
          ),
        };
        const nextCompliance = {
          contract_price_deviation_threshold: all.contract_price_deviation_threshold ?? '5',
          contract_price_deviation_action:
            (all.contract_price_deviation_action as 'warn' | 'block') ?? 'warn',
        };
        setBranding(nextBranding);
        setSmtp(nextSmtp);
        setApprovalPolicy(nextApprovalPolicy);
        setCompliance(nextCompliance);
        setSnapshots((prev) => ({
          ...prev,
          branding: nextBranding,
          smtp: nextSmtp,
          approvalPolicy: nextApprovalPolicy,
          compliance: nextCompliance,
        }));
      })
      .catch(() => {});
    refreshExchangeRateSettings().catch(() => {});
  }, []);

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    const message = searchParams.get('message');

    if (connected) {
      setIntegrationsMsg(
        `${connected === 'qbo' ? 'QuickBooks Online' : 'Xero'} connected successfully.`,
      );
    }
    if (error) {
      setIntegrationsError(
        `Failed to connect ${error === 'qbo' ? 'QuickBooks Online' : 'Xero'}: ${
          message ? decodeURIComponent(message) : 'Unknown error'
        }`,
      );
    }

    api.gl.oauthStatus().then(setOauthStatus).catch(() => {});
  }, [searchParams]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      if (href.startsWith('/settings')) return;
      if (!confirmLeaveIfDirty()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const currentUrl = `${pathname}?${searchParams.toString()}`.replace(/\?$/, '');
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
  }, [hasUnsavedChanges, pathname, searchParams]);

  function handleTabChange(tab: Tab) {
    if (tab !== activeTab && hasUnsavedChanges && !confirmLeaveIfDirty()) return;
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.push(`${pathname}?${params.toString()}`);
  }

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault();
    setPwError('');
    setPwMsg('');
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('New passwords do not match');
      return;
    }
    if (pwForm.newPassword.length < 8) {
      setPwError('Password must be at least 8 characters');
      return;
    }
    setPwSaving(true);
    try {
      const res = await api.auth.changePassword({
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      if (res.ok) {
        setPwMsg('Password changed successfully.');
        setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        const err = await res.json().catch(() => ({}));
        setPwError(err.message || 'Failed to change password');
      }
    } catch (err: any) {
      setPwError(err.message);
    } finally {
      setPwSaving(false);
    }
  }

  async function handleSaveBranding(event: React.FormEvent) {
    event.preventDefault();
    setBrandingError('');
    setBrandingMsg('');
    setBrandingSaving(true);
    try {
      await api.settings.updateBranding(branding);
      invalidateBrandingCache();
      setSnapshots((prev) => ({ ...prev, branding }));
      setBrandingMsg('Branding settings saved. Reload the page to see changes in the sidebar.');
    } catch (err: any) {
      setBrandingError(err.message);
    } finally {
      setBrandingSaving(false);
    }
  }

  async function handleSaveSmtp(event: React.FormEvent) {
    event.preventDefault();
    setSmtpError('');
    setSmtpMsg('');
    setSmtpSaving(true);
    try {
      await api.settings.updateSmtp(smtp);
      setSnapshots((prev) => ({ ...prev, smtp }));
      setSmtpMsg('SMTP settings saved.');
    } catch (err: any) {
      setSmtpError(err.message);
    } finally {
      setSmtpSaving(false);
    }
  }

  async function handleSaveApprovalPolicy(event: React.FormEvent) {
    event.preventDefault();
    setApprovalPolicyError('');
    setApprovalPolicyMsg('');
    setApprovalPolicySaving(true);
    try {
      await api.settings.updateApprovalPolicy(approvalPolicy);
      setSnapshots((prev) => ({ ...prev, approvalPolicy }));
      setApprovalPolicyMsg('Approval policy saved.');
    } catch (err: any) {
      setApprovalPolicyError(err.message);
    } finally {
      setApprovalPolicySaving(false);
    }
  }

  async function handleSaveCompliance(event: React.FormEvent) {
    event.preventDefault();
    setComplianceError('');
    setComplianceMsg('');
    setComplianceSaving(true);
    try {
      await api.settings.updateContractCompliance(compliance);
      setSnapshots((prev) => ({ ...prev, compliance }));
      setComplianceMsg('Contract compliance settings saved.');
    } catch (err: any) {
      setComplianceError(err.message);
    } finally {
      setComplianceSaving(false);
    }
  }

  async function handleConnectQbo() {
    setIntegrationsError('');
    setIntegrationsMsg('');
    setOauthLoading(true);
    try {
      const { url } = await api.gl.oauthConnect('qbo');
      window.location.href = url;
    } catch (err: any) {
      setIntegrationsError(err.message);
      setOauthLoading(false);
    }
  }

  async function handleConnectXero() {
    setIntegrationsError('');
    setIntegrationsMsg('');
    setOauthLoading(true);
    try {
      const { url } = await api.gl.oauthConnect('xero');
      window.location.href = url;
    } catch (err: any) {
      setIntegrationsError(err.message);
      setOauthLoading(false);
    }
  }

  async function handleDisconnectQbo() {
    setIntegrationsError('');
    setIntegrationsMsg('');
    try {
      await api.gl.oauthDisconnect('qbo');
      setOauthStatus((current) => ({ ...current, qbo: false, qboRealmId: undefined }));
      setIntegrationsMsg('QuickBooks Online disconnected.');
    } catch (err: any) {
      setIntegrationsError(err.message);
    }
  }

  async function handleDisconnectXero() {
    setIntegrationsError('');
    setIntegrationsMsg('');
    try {
      await api.gl.oauthDisconnect('xero');
      setOauthStatus((current) => ({ ...current, xero: false, xeroTenantId: undefined }));
      setIntegrationsMsg('Xero disconnected.');
    } catch (err: any) {
      setIntegrationsError(err.message);
    }
  }

  async function handleSaveOrg(event: React.FormEvent) {
    event.preventDefault();
    setOrgError('');
    setOrgMsg('');
    setOrgSaving(true);
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
      setOrgMsg(editingRateId ? 'Exchange rate updated.' : 'Base currency and exchange rate saved.');
    } catch (err: any) {
      setOrgError(err.message);
    } finally {
      setOrgSaving(false);
    }
  }

  async function handleDeleteRate(id: string) {
    if (!window.confirm('Delete this exchange rate?')) return;
    setOrgError('');
    setOrgMsg('');
    setOrgSaving(true);
    try {
      await api.exchangeRates.remove(id);
      await refreshExchangeRateSettings();
      if (editingRateId === id) {
        setEditingRateId(null);
        setRateForm({ fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' });
      }
      setOrgMsg('Exchange rate deleted.');
    } catch (err: any) {
      setOrgError(err.message);
    } finally {
      setOrgSaving(false);
    }
  }

  function handleEditRate(rate: any) {
    setEditingRateId(rate.id ?? null);
    setRateForm({
      fromCurrency: rate.fromCurrency ?? 'EUR',
      toCurrency: rate.toCurrency ?? 'USD',
      rate: Number(rate.rate).toString(),
    });
    setOrgError('');
    setOrgMsg(`Editing ${rate.fromCurrency} -> ${rate.toCurrency}.`);
  }

  function handleCancelRateEdit() {
    setEditingRateId(null);
    setRateForm({ fromCurrency: 'EUR', toCurrency: 'USD', rate: '1.08' });
    setOrgError('');
    setOrgMsg('Exchange rate editor reset.');
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Settings"
        description="Control branding, email delivery, approval automation, integrations, exchange rates, and platform-wide security defaults."
      />

      <div className="flex flex-wrap gap-2 rounded-[24px] border border-border/70 bg-card/90 p-2 shadow-[0_22px_70px_-42px_rgba(15,23,42,0.45)]">
        {(Object.keys(TAB_META) as Tab[]).map((tab) => {
          const Icon = TAB_META[tab].icon;
          return (
            <Button
              key={tab}
              type="button"
              variant={activeTab === tab ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleTabChange(tab)}
            >
              <Icon className="h-4 w-4" />
              {TAB_META[tab].label}
            </Button>
          );
        })}
      </div>

      {activeTab === 'branding' ? (
        <form onSubmit={handleSaveBranding}>
          <Card className="rounded-[24px]">
            <CardHeader>
              <CardTitle className="text-xl">White-label Branding</CardTitle>
              <CardDescription>Customize the app name, logo, colors, and footer presentation across the workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Application Name">
                  <Input value={branding.app_name} onChange={(event) => setBranding((current) => ({ ...current, app_name: event.target.value }))} />
                </Field>
                <Field label="Support Email">
                  <Input type="email" value={branding.support_email} onChange={(event) => setBranding((current) => ({ ...current, support_email: event.target.value }))} placeholder="support@yourcompany.com" />
                </Field>
              </div>
              <Field label="Logo URL">
                <Input value={branding.app_logo_url} onChange={(event) => setBranding((current) => ({ ...current, app_logo_url: event.target.value }))} placeholder="https://example.com/logo.svg" />
                {branding.app_logo_url ? (
                  <img
                    src={branding.app_logo_url}
                    alt="Logo preview"
                    className="mt-3 max-h-12 rounded-md border border-border/70 bg-background p-2"
                    onError={(event) => {
                      (event.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : null}
              </Field>
              <Field label="Copyright / Footer Text">
                <Input value={branding.copyright_text} onChange={(event) => setBranding((current) => ({ ...current, copyright_text: event.target.value }))} />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <ColorField
                  label="Primary Color"
                  value={branding.primary_color}
                  onChange={(value) => setBranding((current) => ({ ...current, primary_color: value }))}
                />
                <ColorField
                  label="Sidebar Color"
                  value={branding.accent_color}
                  onChange={(value) => setBranding((current) => ({ ...current, accent_color: value }))}
                />
              </div>
              <CheckboxRow
                checked={branding.hide_powered_by === 'true'}
                onChange={(checked) => setBranding((current) => ({ ...current, hide_powered_by: checked ? 'true' : 'false' }))}
                title='Hide "Powered by BetterSpend" footer attribution'
              />
              <InlineNotice error={brandingError} success={brandingMsg} />
              <div className="flex justify-end">
                <Button type="submit" disabled={brandingSaving}>
                  {brandingSaving ? 'Saving...' : 'Save Branding'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      ) : null}

      {activeTab === 'email' ? (
        <form onSubmit={handleSaveSmtp}>
          <Card className="rounded-[24px]">
            <CardHeader>
              <CardTitle className="text-xl">Email / SMTP Configuration</CardTitle>
              <CardDescription>Configure outbound email for approval requests, PO issuance, invoice exceptions, and contract alerts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
                <Field label="SMTP Host">
                  <Input value={smtp.smtp_host} onChange={(event) => setSmtp((current) => ({ ...current, smtp_host: event.target.value }))} placeholder="smtp.gmail.com" />
                </Field>
                <Field label="Port">
                  <Input type="number" value={smtp.smtp_port} onChange={(event) => setSmtp((current) => ({ ...current, smtp_port: event.target.value }))} />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Username">
                  <Input value={smtp.smtp_user} onChange={(event) => setSmtp((current) => ({ ...current, smtp_user: event.target.value }))} />
                </Field>
                <Field label="Password">
                  <Input type="password" value={smtp.smtp_pass} onChange={(event) => setSmtp((current) => ({ ...current, smtp_pass: event.target.value }))} autoComplete="current-password" />
                </Field>
              </div>
              <Field label="From Address">
                <Input type="email" value={smtp.smtp_from} onChange={(event) => setSmtp((current) => ({ ...current, smtp_from: event.target.value }))} />
              </Field>
              <CheckboxRow
                checked={smtp.smtp_secure === 'true'}
                onChange={(checked) => setSmtp((current) => ({ ...current, smtp_secure: checked ? 'true' : 'false' }))}
                title="Use TLS / SSL (port 465)"
              />
              <Alert>
                <AlertDescription>
                  Notifications are sent for approval requests, PO issuance, invoice match exceptions, and contract expiry alerts.
                </AlertDescription>
              </Alert>
              <InlineNotice error={smtpError} success={smtpMsg} />
              <div className="flex justify-end">
                <Button type="submit" disabled={smtpSaving}>
                  {smtpSaving ? 'Saving...' : 'Save SMTP Settings'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      ) : null}

      {activeTab === 'approval' ? (
        <form onSubmit={handleSaveApprovalPolicy}>
          <Card className="rounded-[24px]">
            <CardHeader>
              <CardTitle className="text-xl">Approval Policy</CardTitle>
              <CardDescription>Configure the low-value purchase fast lane for requisitions that should clear without manual review.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field label="Auto-approve Threshold">
                <div className="flex max-w-xs items-center gap-2">
                  <span className="text-sm font-semibold text-muted-foreground">$</span>
                  <Input type="number" min="0" step="0.01" value={approvalPolicy.auto_approve_threshold} onChange={(event) => setApprovalPolicy((current) => ({ ...current, auto_approve_threshold: event.target.value }))} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Set to 0 to disable auto-approval.</p>
              </Field>
              <CheckboxRow
                checked={approvalPolicy.auto_approve_require_budget_check === 'true'}
                onChange={(checked) => setApprovalPolicy((current) => ({ ...current, auto_approve_require_budget_check: checked ? 'true' : 'false' }))}
                title="Require budget check"
                description="Only auto-approve if the requisition is within budget limits."
              />
              <CheckboxRow
                checked={approvalPolicy.auto_approve_notify_manager === 'true'}
                onChange={(checked) => setApprovalPolicy((current) => ({ ...current, auto_approve_notify_manager: checked ? 'true' : 'false' }))}
                title="Add audit note when auto-approving"
                description="Writes a detailed reason into the approval record."
              />
              {Number(approvalPolicy.auto_approve_threshold) > 0 ? (
                <Alert variant="success">
                  <AlertDescription>
                    Fast lane active: requisitions up to $
                    {Number(approvalPolicy.auto_approve_threshold).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    {' '}will be auto-approved.
                  </AlertDescription>
                </Alert>
              ) : null}
              <InlineNotice error={approvalPolicyError} success={approvalPolicyMsg} />
              <div className="flex justify-end">
                <Button type="submit" disabled={approvalPolicySaving}>
                  {approvalPolicySaving ? 'Saving...' : 'Save Approval Policy'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      ) : null}

      {activeTab === 'compliance' ? (
        <form onSubmit={handleSaveCompliance}>
          <Card className="rounded-[24px]">
            <CardHeader>
              <CardTitle className="text-xl">Contract Compliance</CardTitle>
              <CardDescription>Control how the system handles PO line prices that deviate from active contract rates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field label="Deviation Threshold">
                <div className="flex max-w-xs items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={compliance.contract_price_deviation_threshold}
                    onChange={(event) =>
                      setCompliance((current) => ({
                        ...current,
                        contract_price_deviation_threshold: event.target.value,
                      }))
                    }
                  />
                  <span className="text-sm font-semibold text-muted-foreground">%</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Set to 0 to require an exact match against contract price.
                </p>
              </Field>
              <div className="space-y-3">
                <div className="text-sm font-medium text-foreground">Action When Threshold Exceeded</div>
                <RadioCard
                  checked={compliance.contract_price_deviation_action === 'warn'}
                  onChange={() =>
                    setCompliance((current) => ({ ...current, contract_price_deviation_action: 'warn' }))
                  }
                  title="Warn"
                  description="Show an amber warning badge on the PO line, but allow submission."
                />
                <RadioCard
                  checked={compliance.contract_price_deviation_action === 'block'}
                  onChange={() =>
                    setCompliance((current) => ({ ...current, contract_price_deviation_action: 'block' }))
                  }
                  title="Block submission"
                  description="Prevent PO creation if any line price exceeds the threshold."
                />
              </div>
              <Alert>
                <AlertDescription>
                  Compliance is checked against active contracts for the selected vendor. Lines without a matching contract line are marked as no-contract and are not subject to threshold enforcement.
                </AlertDescription>
              </Alert>
              <InlineNotice error={complianceError} success={complianceMsg} />
              <div className="flex justify-end">
                <Button type="submit" disabled={complianceSaving}>
                  {complianceSaving ? 'Saving...' : 'Save Compliance Settings'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      ) : null}

      {activeTab === 'integrations' ? (
        <div className="space-y-6">
          <Card className="rounded-[24px]">
            <CardHeader>
              <CardTitle className="text-xl">GL Integrations</CardTitle>
              <CardDescription>BetterSpend uses platform-managed OAuth apps. End users only authorize access for their QuickBooks or Xero company.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <InlineNotice error={integrationsError} success={integrationsMsg} />
              <IntegrationCard
                title="QuickBooks Online"
                connected={oauthStatus.qbo}
                configured={oauthStatus.qboConfigured !== false}
                connectionId={oauthStatus.qboRealmId}
                description="Posts approved invoices as Bills in QuickBooks Online using platform-managed OAuth credentials."
                oauthLoading={oauthLoading}
                onConnect={handleConnectQbo}
                onDisconnect={handleDisconnectQbo}
              />
              <IntegrationCard
                title="Xero"
                connected={oauthStatus.xero}
                configured={oauthStatus.xeroConfigured !== false}
                connectionId={oauthStatus.xeroTenantId}
                description="Posts approved invoices as Accounts Payable invoices in Xero using platform-managed OAuth credentials."
                oauthLoading={oauthLoading}
                onConnect={handleConnectXero}
                onDisconnect={handleDisconnectXero}
              />
              <Alert variant="warning">
                <AlertDescription>
                  These integrations rely on platform-owned OAuth apps configured on the BetterSpend server. End users do not need to manage their own OAuth applications.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === 'org' ? (
        <form onSubmit={handleSaveOrg}>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <Card className="rounded-[24px]">
              <CardHeader>
                <CardTitle className="text-xl">System Information</CardTitle>
                <CardDescription>Reference build metadata, tax-code access, and the base platform configuration exposed to this workspace.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <InfoRow label="Organization ID" value="00000000-0000-0000-0000-000000000001" mono />
                <InfoRow label="Demo Organization" value="Acme Corp" />
                <InfoRow label="API Base URL" value={process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001'} mono />
                <InfoRow label="Version" value={appReleaseLabel} />
                <InfoRow label="License" value="MIT License" />
                <InfoRow label="Source Code" value="github.com/AsyncronousVentures/betterspend" />
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-medium text-foreground">Tax Code Management</div>
                      <p className="mt-1 text-sm text-muted-foreground">Manage VAT and sales tax rates used on purchase order and invoice lines.</p>
                    </div>
                    <Button asChild>
                      <Link href="/tax-codes">Open Tax Codes</Link>
                    </Button>
                  </div>
                </div>
                <Alert variant="warning">
                  <AlertDescription>
                    <strong>Open Source (MIT):</strong> BetterSpend is free to use, modify, and distribute. White-labeling is fully supported via the Branding tab.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            <Card className="rounded-[24px]">
              <CardHeader>
                <CardTitle className="text-xl">Currency Controls</CardTitle>
                <CardDescription>Set the organization base currency and maintain saved manual exchange-rate overrides.</CardDescription>
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
                  <div className="rounded-2xl border border-border/70">
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
                            <Button type="button" size="sm" variant="outline" onClick={() => handleDeleteRate(rate.id)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <InlineNotice error={orgError} success={orgMsg} />
                <div className="flex justify-end">
                  <Button type="submit" disabled={orgSaving}>
                    {orgSaving ? 'Saving...' : editingRateId ? 'Update Exchange Rate' : 'Save Currency Settings'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </form>
      ) : null}

      {activeTab === 'password' ? (
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Change Password</CardTitle>
            <CardDescription>Update the current user password for this workspace login.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-5">
              <Field label="Current Password">
                <Input type="password" required value={pwForm.currentPassword} onChange={(event) => setPwForm((current) => ({ ...current, currentPassword: event.target.value }))} autoComplete="current-password" />
              </Field>
              <Field label="New Password">
                <Input type="password" required value={pwForm.newPassword} onChange={(event) => setPwForm((current) => ({ ...current, newPassword: event.target.value }))} autoComplete="new-password" />
              </Field>
              <Field label="Confirm New Password">
                <Input type="password" required value={pwForm.confirmPassword} onChange={(event) => setPwForm((current) => ({ ...current, confirmPassword: event.target.value }))} autoComplete="new-password" />
              </Field>
              <InlineNotice error={pwError} success={pwMsg} />
              <div className="flex justify-end">
                <Button type="submit" disabled={pwSaving}>
                  {pwSaving ? 'Changing...' : 'Change Password'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading settings...</div>}>
      <SettingsContent />
    </Suspense>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}

function InlineNotice({ error, success }: { error?: string; success?: string }) {
  return (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert variant="success">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

function CheckboxRow({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description?: string;
}) {
  return (
    <label className="flex gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-4">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1" />
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description ? <div className="mt-1 text-xs text-muted-foreground">{description}</div> : null}
      </div>
    </label>
  );
}

function RadioCard({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
}) {
  return (
    <label className="flex gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-4">
      <input type="radio" checked={checked} onChange={onChange} className="mt-1" />
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-12 rounded-md border border-input bg-background p-1"
        />
        <Input value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

function IntegrationCard({
  title,
  description,
  connected,
  configured,
  connectionId,
  oauthLoading,
  onConnect,
  onDisconnect,
}: {
  title: string;
  description: string;
  connected: boolean;
  configured: boolean;
  connectionId?: string;
  oauthLoading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <Badge variant={connected ? 'success' : 'destructive'}>
              {connected ? 'Connected' : 'Not connected'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
          <p className="mt-2 text-xs text-muted-foreground">Connection mode: platform-managed OAuth</p>
          {connectionId ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground">{connectionId}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {connected ? (
            <Button type="button" variant="outline" onClick={onDisconnect}>
              Disconnect
            </Button>
          ) : configured ? (
            <Button type="button" onClick={onConnect} disabled={oauthLoading}>
              {oauthLoading ? 'Redirecting...' : `Connect ${title}`}
            </Button>
          ) : (
            <Button type="button" disabled>
              Platform App Not Configured
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/70 py-3 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm text-foreground ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
