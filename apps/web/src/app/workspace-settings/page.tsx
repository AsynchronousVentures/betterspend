'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  BadgeCheck,
  Building2,
  Mail,
  Palette,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { getSession } from '../../lib/auth-client';
import { api } from '../../lib/api';
import { appReleaseVersion } from '../../lib/release';
import { invalidateBrandingCache } from '../../lib/branding';
import { PageHeader } from '../../components/page-header';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import {
  CheckboxRow,
  ColorField,
  Field,
  InfoRow,
  InlineNotice,
  RadioCard,
} from '../../components/settings-ui';
import { Input } from '../../components/ui/input';

type Tab = 'branding' | 'email' | 'approval' | 'compliance' | 'org';

interface SettingsSnapshots {
  branding: Record<string, string>;
  smtp: Record<string, string>;
  approvalPolicy: Record<string, string>;
  compliance: {
    contract_price_deviation_threshold: string;
    contract_price_deviation_action: 'warn' | 'block';
  };
}

type SessionUser = {
  user?: {
    organizationId?: string;
  };
};

type VersionCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up_to_date'; serverVersion: string }
  | { status: 'mismatch'; serverVersion: string }
  | { status: 'error'; message: string };

const TAB_META: Record<Tab, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  branding: { label: 'Branding', icon: Palette },
  email: { label: 'Email / SMTP', icon: Mail },
  approval: { label: 'Approval Policy', icon: BadgeCheck },
  compliance: { label: 'Contract Compliance', icon: ShieldCheck },
  org: { label: 'System Info', icon: Building2 },
};

function SettingsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'branding';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [versionCheck, setVersionCheck] = useState<VersionCheckState>({ status: 'idle' });
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    const nextTab = (searchParams.get('tab') as Tab | null) ?? 'branding';
    setActiveTab(nextTab && nextTab in TAB_META ? nextTab : 'branding');
  }, [searchParams]);

  useEffect(() => {
    getSession().then(setSession).catch(() => setSession(null));
  }, []);

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
  });

  function confirmLeaveIfDirty() {
    return window.confirm('You have unsaved changes. Are you sure you want to leave?');
  }

  const isBrandingDirty = JSON.stringify(branding) !== JSON.stringify(snapshots.branding);
  const isSmtpDirty = JSON.stringify(smtp) !== JSON.stringify(snapshots.smtp);
  const isApprovalDirty = JSON.stringify(approvalPolicy) !== JSON.stringify(snapshots.approvalPolicy);
  const isComplianceDirty = JSON.stringify(compliance) !== JSON.stringify(snapshots.compliance);
  const hasUnsavedChanges = isBrandingDirty || isSmtpDirty || isApprovalDirty || isComplianceDirty;

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
        setSnapshots({
          branding: nextBranding,
          smtp: nextSmtp,
          approvalPolicy: nextApprovalPolicy,
          compliance: nextCompliance,
        });
      })
      .catch(() => {});
  }, []);

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
      if (href.startsWith('/workspace-settings')) return;
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

  async function handleVersionCheck() {
    setVersionCheck({ status: 'checking' });
    try {
      const health = await api.health.check();
      setLastCheckedAt(health.timestamp);
      if (health.version === appReleaseVersion) {
        setVersionCheck({ status: 'up_to_date', serverVersion: health.version });
      } else {
        setVersionCheck({ status: 'mismatch', serverVersion: health.version });
      }
    } catch (err: any) {
      setVersionCheck({ status: 'error', message: err.message ?? 'Unable to verify version.' });
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Workspace Settings"
        description="Configure workspace-wide branding, delivery, and policy controls for your BetterSpend organization."
      />

      <div className="flex flex-wrap gap-2 rounded-lg border border-border/70 bg-card/90 p-2 shadow-[0_22px_70px_-42px_rgba(15,23,42,0.45)]">
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
          <Card className="rounded-lg">
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
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">Email Delivery</CardTitle>
              <CardDescription>Configure the SMTP transport used for approvals, password reset, and vendor notifications.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="SMTP Host">
                  <Input value={smtp.smtp_host} onChange={(event) => setSmtp((current) => ({ ...current, smtp_host: event.target.value }))} />
                </Field>
                <Field label="SMTP Port">
                  <Input value={smtp.smtp_port} onChange={(event) => setSmtp((current) => ({ ...current, smtp_port: event.target.value }))} />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="SMTP User">
                  <Input value={smtp.smtp_user} onChange={(event) => setSmtp((current) => ({ ...current, smtp_user: event.target.value }))} />
                </Field>
                <Field label="SMTP Password">
                  <Input type="password" value={smtp.smtp_pass} onChange={(event) => setSmtp((current) => ({ ...current, smtp_pass: event.target.value }))} />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="From Address">
                  <Input type="email" value={smtp.smtp_from} onChange={(event) => setSmtp((current) => ({ ...current, smtp_from: event.target.value }))} />
                </Field>
                <CheckboxRow
                  checked={smtp.smtp_secure === 'true'}
                  onChange={(checked) => setSmtp((current) => ({ ...current, smtp_secure: checked ? 'true' : 'false' }))}
                  title="Use TLS / secure transport"
                  description="Enable when your SMTP provider requires an encrypted transport."
                />
              </div>
              <InlineNotice error={smtpError} success={smtpMsg} />
              <div className="flex justify-end">
                <Button type="submit" disabled={smtpSaving}>
                  {smtpSaving ? 'Saving...' : 'Save Email Settings'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      ) : null}

      {activeTab === 'approval' ? (
        <form onSubmit={handleSaveApprovalPolicy}>
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">Approval Policy</CardTitle>
              <CardDescription>Set global automation defaults for low-value requests and approval notifications.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field label="Auto-approve threshold">
                <Input type="number" min="0" value={approvalPolicy.auto_approve_threshold} onChange={(event) => setApprovalPolicy((current) => ({ ...current, auto_approve_threshold: event.target.value }))} />
              </Field>
              <CheckboxRow
                checked={approvalPolicy.auto_approve_require_budget_check === 'true'}
                onChange={(checked) => setApprovalPolicy((current) => ({ ...current, auto_approve_require_budget_check: checked ? 'true' : 'false' }))}
                title="Require budget validation before auto-approving"
              />
              <CheckboxRow
                checked={approvalPolicy.auto_approve_notify_manager === 'true'}
                onChange={(checked) => setApprovalPolicy((current) => ({ ...current, auto_approve_notify_manager: checked ? 'true' : 'false' }))}
                title="Notify managers when auto-approval fires"
              />
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
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">Contract Compliance</CardTitle>
              <CardDescription>Decide how BetterSpend should react when a purchase price deviates from the linked contract.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field label="Allowed price deviation (%)">
                <Input type="number" min="0" step="0.01" value={compliance.contract_price_deviation_threshold} onChange={(event) => setCompliance((current) => ({ ...current, contract_price_deviation_threshold: event.target.value }))} />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <RadioCard
                  checked={compliance.contract_price_deviation_action === 'warn'}
                  onChange={() => setCompliance((current) => ({ ...current, contract_price_deviation_action: 'warn' }))}
                  title="Warn only"
                  description="Allow the document to proceed while flagging the variance."
                />
                <RadioCard
                  checked={compliance.contract_price_deviation_action === 'block'}
                  onChange={() => setCompliance((current) => ({ ...current, contract_price_deviation_action: 'block' }))}
                  title="Block submission"
                  description="Prevent the document from moving forward until the variance is resolved."
                />
              </div>
              <InlineNotice error={complianceError} success={complianceMsg} />
              <div className="flex justify-end">
                <Button type="submit" disabled={complianceSaving}>
                  {complianceSaving ? 'Saving...' : 'Save Contract Compliance'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      ) : null}

      {activeTab === 'org' ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">System Information</CardTitle>
              <CardDescription>Read-only workspace and runtime metadata for this BetterSpend deployment.</CardDescription>
            </CardHeader>
            <CardContent>
              <InfoRow label="Organization ID" value={session?.user?.organizationId ?? 'Unknown'} mono />
              <InfoRow label="API Base URL" value={process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001'} mono />
              <InfoRow label="Frontend Version" value={appReleaseVersion} />
              <InfoRow label="License" value="MIT License" />
              <InfoRow label="Source Code" value="github.com/AsyncronousVentures/betterspend" mono />
              <InfoRow label="Currency Admin" value="/currencies" mono />
              <InfoRow label="Integrations Admin" value="/addons" mono />
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-xl">Version Check</CardTitle>
              <CardDescription>Compare the running API version to the frontend release bundled into this client.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={handleVersionCheck} disabled={versionCheck.status === 'checking'}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${versionCheck.status === 'checking' ? 'animate-spin' : ''}`} />
                  {versionCheck.status === 'checking' ? 'Checking...' : 'Check Server Version'}
                </Button>
                {versionCheck.status === 'up_to_date' ? <Badge variant="success">Up to date</Badge> : null}
                {versionCheck.status === 'mismatch' ? <Badge variant="warning">Version mismatch</Badge> : null}
                {versionCheck.status === 'error' ? <Badge variant="destructive">Unable to verify</Badge> : null}
              </div>

              <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                <InfoRow label="Frontend Version" value={appReleaseVersion} />
                <InfoRow
                  label="Server Version"
                  value={
                    versionCheck.status === 'up_to_date' || versionCheck.status === 'mismatch'
                      ? versionCheck.serverVersion
                      : versionCheck.status === 'checking'
                        ? 'Checking...'
                        : 'Not checked'
                  }
                />
                <InfoRow label="Last Checked" value={lastCheckedAt ? new Date(lastCheckedAt).toLocaleString() : 'Not checked'} />
              </div>

              {versionCheck.status === 'error' ? (
                <Alert variant="destructive">
                  <AlertDescription>{versionCheck.message}</AlertDescription>
                </Alert>
              ) : null}
              {versionCheck.status === 'mismatch' ? (
                <Alert variant="warning">
                  <AlertDescription>
                    Frontend version {appReleaseVersion} does not match server version {versionCheck.serverVersion}.
                  </AlertDescription>
                </Alert>
              ) : null}
              {versionCheck.status === 'up_to_date' ? (
                <Alert variant="success">
                  <AlertDescription>
                    Frontend and server are both running version {versionCheck.serverVersion}.
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

export default function WorkspaceSettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading workspace settings...</div>}>
      <SettingsContent />
    </Suspense>
  );
}
