'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BrainCircuit,
  CircleAlert,
  ExternalLink,
  KeyRound,
  PlugZap,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  Star,
  Unplug,
} from 'lucide-react';
import { api, type AiProviderId, type AiProviderStatus, type AiProvidersStatusResponse } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { IntegrationCard, InlineNotice } from '../../components/settings-ui';

interface OAuthStatus {
  qbo: boolean;
  xero: boolean;
  qboRealmId?: string;
  xeroTenantId?: string;
  qboConfigured?: boolean;
  xeroConfigured?: boolean;
}

interface AiProviderForm {
  apiKey: string;
  defaultModel: string;
  organizationId: string;
  projectId: string;
}

const EMPTY_AI_FORMS: Record<AiProviderId, AiProviderForm> = {
  anthropic: { apiKey: '', defaultModel: '', organizationId: '', projectId: '' },
  openai: { apiKey: '', defaultModel: '', organizationId: '', projectId: '' },
  openrouter: { apiKey: '', defaultModel: '', organizationId: '', projectId: '' },
};

function AddonsContent() {
  const searchParams = useSearchParams();
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>({ qbo: false, xero: false });
  const [aiStatus, setAiStatus] = useState<AiProvidersStatusResponse | null>(null);
  const [aiForms, setAiForms] = useState<Record<AiProviderId, AiProviderForm>>(EMPTY_AI_FORMS);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const connected = searchParams.get('connected');
    const failedProvider = searchParams.get('error');
    const aiConnected = searchParams.get('aiConnected');
    const aiFailedProvider = searchParams.get('aiError');
    const failureMessage = searchParams.get('message');

    if (connected) {
      setMessage(`${connected === 'qbo' ? 'QuickBooks Online' : 'Xero'} connected successfully.`);
    }
    if (aiConnected) {
      setMessage(`${providerLabel(aiConnected)} connected successfully.`);
    }
    if (failedProvider) {
      setError(
        `Failed to connect ${failedProvider === 'qbo' ? 'QuickBooks Online' : 'Xero'}: ${
          failureMessage ? decodeURIComponent(failureMessage) : 'Unknown error'
        }`,
      );
    }
    if (aiFailedProvider) {
      setError(
        `Failed to connect ${providerLabel(aiFailedProvider)}: ${
          failureMessage ? decodeURIComponent(failureMessage) : 'Unknown error'
        }`,
      );
    }

    api.gl.oauthStatus().then(setOauthStatus).catch((err: Error) => setError(err.message));
    loadAiStatus().catch((err: Error) => setError(err.message));
  }, [searchParams]);

  async function loadAiStatus() {
    const next = await api.aiProviders.status();
    applyAiStatus(next);
  }

  function applyAiStatus(next: AiProvidersStatusResponse) {
    setAiStatus(next);
    setAiForms((current) => {
      const updated = { ...current };
      for (const provider of next.providers) {
        updated[provider.provider] = {
          ...updated[provider.provider],
          defaultModel: provider.defaultModel,
          organizationId: String(provider.metadata.providerOrganizationId ?? updated[provider.provider].organizationId),
          projectId: String(provider.metadata.projectId ?? updated[provider.provider].projectId),
          apiKey: '',
        };
      }
      return updated;
    });
  }

  function setAiField(provider: AiProviderId, field: keyof AiProviderForm, value: string) {
    setAiForms((current) => ({
      ...current,
      [provider]: { ...current[provider], [field]: value },
    }));
  }

  async function runAiAction(provider: AiProviderId, action: string, task: () => Promise<void>) {
    setError('');
    setMessage('');
    setAiBusy(`${provider}:${action}`);
    try {
      await task();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(null);
    }
  }

  async function handleConnect(provider: 'qbo' | 'xero') {
    setError('');
    setMessage('');
    setOauthLoading(true);
    try {
      const { url } = await api.gl.oauthConnect(provider);
      window.location.href = url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setOauthLoading(false);
    }
  }

  async function handleDisconnect(provider: 'qbo' | 'xero') {
    setError('');
    setMessage('');
    try {
      await api.gl.oauthDisconnect(provider);
      setOauthStatus((current) =>
        provider === 'qbo'
          ? { ...current, qbo: false, qboRealmId: undefined }
          : { ...current, xero: false, xeroTenantId: undefined },
      );
      setMessage(`${provider === 'qbo' ? 'QuickBooks Online' : 'Xero'} disconnected.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveAiKey(provider: AiProviderId) {
    const form = aiForms[provider];
    await runAiAction(provider, 'save', async () => {
      const next = await api.aiProviders.saveApiKey(provider, {
        apiKey: form.apiKey,
        defaultModel: form.defaultModel || undefined,
        organizationId: provider === 'openai' ? form.organizationId || undefined : undefined,
        projectId: provider === 'openai' ? form.projectId || undefined : undefined,
      });
      applyAiStatus(next);
      setMessage(`${providerLabel(provider)} connected.`);
    });
  }

  async function saveAiModel(provider: AiProviderId) {
    const form = aiForms[provider];
    await runAiAction(provider, 'model', async () => {
      const next = await api.aiProviders.update(provider, { defaultModel: form.defaultModel });
      applyAiStatus(next);
      setMessage(`${providerLabel(provider)} model updated.`);
    });
  }

  async function testAiProvider(provider: AiProviderId) {
    await runAiAction(provider, 'test', async () => {
      await api.aiProviders.test(provider);
      await loadAiStatus();
      setMessage(`${providerLabel(provider)} validated.`);
    });
  }

  async function setDefaultAiProvider(provider: AiProviderId) {
    await runAiAction(provider, 'default', async () => {
      const next = await api.aiProviders.update(provider, { isDefault: true });
      applyAiStatus(next);
      setMessage(`${providerLabel(provider)} set as the default AI provider.`);
    });
  }

  async function toggleAiProvider(provider: AiProviderStatus) {
    await runAiAction(provider.provider, 'toggle', async () => {
      const next = await api.aiProviders.update(provider.provider, { enabled: !provider.enabled });
      applyAiStatus(next);
      setMessage(`${provider.label} ${provider.enabled ? 'disabled' : 'enabled'}.`);
    });
  }

  async function disconnectAiProvider(provider: AiProviderStatus) {
    if (!window.confirm(`Disconnect ${provider.label}? The stored credential will be removed.`)) return;
    await runAiAction(provider.provider, 'disconnect', async () => {
      const next = await api.aiProviders.disconnect(provider.provider);
      applyAiStatus(next);
      setMessage(`${provider.label} disconnected.`);
    });
  }

  async function connectOpenRouter() {
    await runAiAction('openrouter', 'oauth', async () => {
      const { url } = await api.aiProviders.openRouterConnect();
      window.location.href = url;
    });
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Add-ons"
        description="Manage platform integrations and connection health from one place."
      />

      <InlineNotice error={error} success={message} />

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <PlugZap className="h-5 w-5" />
            Accounting Add-ons
          </CardTitle>
          <CardDescription>
            BetterSpend manages the OAuth apps centrally. Workspace admins only need to connect or disconnect providers here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <IntegrationCard
            title="QuickBooks Online"
            description="Connect approved invoices and mapping data to QuickBooks Online."
            connected={oauthStatus.qbo}
            configured={oauthStatus.qboConfigured ?? false}
            connectionId={oauthStatus.qboRealmId}
            oauthLoading={oauthLoading}
            onConnect={() => handleConnect('qbo')}
            onDisconnect={() => handleDisconnect('qbo')}
            manageHref="/gl-mappings?targetSystem=qbo"
            activityHref="/gl-export-jobs"
          />
          <IntegrationCard
            title="Xero"
            description="Connect approved invoices and mapping data to Xero."
            connected={oauthStatus.xero}
            configured={oauthStatus.xeroConfigured ?? false}
            connectionId={oauthStatus.xeroTenantId}
            oauthLoading={oauthLoading}
            onConnect={() => handleConnect('xero')}
            onDisconnect={() => handleDisconnect('xero')}
            manageHref="/gl-mappings?targetSystem=xero"
            activityHref="/gl-export-jobs"
          />
          <Alert variant="warning">
            <CircleAlert className="h-4 w-4" />
            <AlertDescription>
              Add-ons are managed at the platform level. Mapping and export workflows stay on their existing dedicated pages.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <BrainCircuit className="h-5 w-5" />
            AI Add-ons
          </CardTitle>
          <CardDescription>
            Workspace-wide AI provider credentials for OCR, requisition drafting, and future AI workflows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(aiStatus?.providers ?? []).map((provider) => (
            <AiProviderPanel
              key={provider.provider}
              provider={provider}
              form={aiForms[provider.provider]}
              busy={aiBusy}
              onFieldChange={setAiField}
              onSaveKey={saveAiKey}
              onSaveModel={saveAiModel}
              onTest={testAiProvider}
              onSetDefault={setDefaultAiProvider}
              onToggle={toggleAiProvider}
              onDisconnect={disconnectAiProvider}
              onOpenRouterConnect={connectOpenRouter}
            />
          ))}
          {!aiStatus ? (
            <div className="rounded-lg border border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
              Loading AI providers...
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function AiProviderPanel({
  provider,
  form,
  busy,
  onFieldChange,
  onSaveKey,
  onSaveModel,
  onTest,
  onSetDefault,
  onToggle,
  onDisconnect,
  onOpenRouterConnect,
}: {
  provider: AiProviderStatus;
  form: AiProviderForm;
  busy: string | null;
  onFieldChange: (provider: AiProviderId, field: keyof AiProviderForm, value: string) => void;
  onSaveKey: (provider: AiProviderId) => Promise<void>;
  onSaveModel: (provider: AiProviderId) => Promise<void>;
  onTest: (provider: AiProviderId) => Promise<void>;
  onSetDefault: (provider: AiProviderId) => Promise<void>;
  onToggle: (provider: AiProviderStatus) => Promise<void>;
  onDisconnect: (provider: AiProviderStatus) => Promise<void>;
  onOpenRouterConnect: () => Promise<void>;
}) {
  const saving = busy === `${provider.provider}:save`;
  const testing = busy === `${provider.provider}:test`;
  const savingModel = busy === `${provider.provider}:model`;
  const settingDefault = busy === `${provider.provider}:default`;
  const toggling = busy === `${provider.provider}:toggle`;
  const disconnecting = busy === `${provider.provider}:disconnect`;
  const linking = busy === 'openrouter:oauth';

  return (
    <div className="rounded-lg border border-border/70 bg-background/80 p-5">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-foreground">{provider.label}</div>
            <Badge variant={providerBadgeVariant(provider)}>{providerBadgeText(provider)}</Badge>
            {provider.isDefault ? (
              <Badge variant="secondary">
                <Star className="mr-1 h-3 w-3" />
                Default
              </Badge>
            ) : null}
            {provider.authMethod ? (
              <Badge variant="outline">{provider.authMethod === 'oauth' ? 'OAuth' : 'API key'}</Badge>
            ) : null}
          </div>

          <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
            <InfoMetric label="Model" value={provider.defaultModel} mono />
            <InfoMetric label="Credential" value={provider.maskedCredential ?? 'Not stored'} mono />
            <InfoMetric label="Last check" value={provider.lastValidatedAt ? formatDate(provider.lastValidatedAt) : 'Never'} />
            <InfoMetric label="Status" value={provider.lastError || provider.status.replace(/_/g, ' ')} />
          </div>

          <form
            className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void onSaveKey(provider.provider);
            }}
          >
            <label className="block min-w-0">
              <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">API key</span>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(event) => onFieldChange(provider.provider, 'apiKey', event.target.value)}
                placeholder={provider.connected ? 'Enter a new key to rotate' : 'Paste API key'}
                autoComplete="off"
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Default model</span>
              <Input
                value={form.defaultModel}
                onChange={(event) => onFieldChange(provider.provider, 'defaultModel', event.target.value)}
                placeholder={provider.modelPlaceholder}
              />
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={!form.apiKey.trim() || saving} className="w-full lg:w-auto">
                <KeyRound className="h-4 w-4" />
                {saving ? 'Saving...' : 'Save key'}
              </Button>
            </div>
          </form>

          {provider.provider === 'openai' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block min-w-0">
                <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">OpenAI org</span>
                <Input
                  value={form.organizationId}
                  onChange={(event) => onFieldChange(provider.provider, 'organizationId', event.target.value)}
                  placeholder="org_..."
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">OpenAI project</span>
                <Input
                  value={form.projectId}
                  onChange={(event) => onFieldChange(provider.provider, 'projectId', event.target.value)}
                  placeholder="proj_..."
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="flex w-full flex-wrap gap-2 xl:w-80 xl:justify-end">
          <Button asChild type="button" variant="outline" size="sm">
            <a href={provider.dashboardUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Dashboard
            </a>
          </Button>
          {provider.provider === 'openrouter' ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void onOpenRouterConnect()} disabled={linking}>
              <PlugZap className="h-4 w-4" />
              {linking ? 'Opening...' : provider.connected ? 'Relink' : 'Link'}
            </Button>
          ) : null}
          {provider.connected ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void onSaveModel(provider.provider)} disabled={savingModel || !form.defaultModel.trim()}>
                <Save className="h-4 w-4" />
                {savingModel ? 'Saving...' : 'Save model'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void onTest(provider.provider)} disabled={testing}>
                <ShieldCheck className="h-4 w-4" />
                {testing ? 'Testing...' : 'Test'}
              </Button>
              {!provider.isDefault ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void onSetDefault(provider.provider)} disabled={settingDefault}>
                  <Star className="h-4 w-4" />
                  {settingDefault ? 'Setting...' : 'Default'}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => void onToggle(provider)} disabled={toggling}>
                {provider.enabled ? <Power className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                {toggling ? 'Updating...' : provider.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void onDisconnect(provider)} disabled={disconnecting}>
                <Unplug className="h-4 w-4" />
                {disconnecting ? 'Removing...' : 'Disconnect'}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InfoMetric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate text-sm text-foreground ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function providerBadgeVariant(provider: AiProviderStatus): 'success' | 'destructive' | 'warning' {
  if (!provider.connected || provider.status === 'error') return 'destructive';
  if (!provider.enabled) return 'warning';
  return 'success';
}

function providerBadgeText(provider: AiProviderStatus) {
  if (!provider.connected) return 'Not connected';
  if (provider.status === 'error') return 'Needs attention';
  if (!provider.enabled) return 'Disabled';
  return 'Connected';
}

function providerLabel(provider: string) {
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'openrouter') return 'OpenRouter';
  return provider;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function AddonsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading add-ons...</div>}>
      <AddonsContent />
    </Suspense>
  );
}
