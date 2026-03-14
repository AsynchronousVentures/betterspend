'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CircleAlert, PlugZap } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { IntegrationCard, InlineNotice } from '../../components/settings-ui';

interface OAuthStatus {
  qbo: boolean;
  xero: boolean;
  qboRealmId?: string;
  xeroTenantId?: string;
  qboConfigured?: boolean;
  xeroConfigured?: boolean;
}

function AddonsContent() {
  const searchParams = useSearchParams();
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>({ qbo: false, xero: false });
  const [oauthLoading, setOauthLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const connected = searchParams.get('connected');
    const failedProvider = searchParams.get('error');
    const failureMessage = searchParams.get('message');

    if (connected) {
      setMessage(`${connected === 'qbo' ? 'QuickBooks Online' : 'Xero'} connected successfully.`);
    }
    if (failedProvider) {
      setError(
        `Failed to connect ${failedProvider === 'qbo' ? 'QuickBooks Online' : 'Xero'}: ${
          failureMessage ? decodeURIComponent(failureMessage) : 'Unknown error'
        }`,
      );
    }

    api.gl.oauthStatus().then(setOauthStatus).catch((err: Error) => setError(err.message));
  }, [searchParams]);

  async function handleConnect(provider: 'qbo' | 'xero') {
    setError('');
    setMessage('');
    setOauthLoading(true);
    try {
      const { url } = await api.gl.oauthConnect(provider);
      window.location.href = url;
    } catch (err: any) {
      setError(err.message);
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
    } catch (err: any) {
      setError(err.message);
    }
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
    </div>
  );
}

export default function AddonsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading add-ons...</div>}>
      <AddonsContent />
    </Suspense>
  );
}
