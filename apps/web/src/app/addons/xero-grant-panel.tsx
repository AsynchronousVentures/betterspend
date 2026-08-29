import * as React from 'react';
import { CircleAlert } from 'lucide-react';
import type { XeroTenant } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';

export type XeroGrantState =
  | { status: 'idle' }
  | { status: 'loading'; grantId: string }
  | {
      status: 'choosing';
      grantId: string;
      tenants: XeroTenant[];
      selectedTenantId: string;
    }
  | { status: 'submitting'; grantId: string }
  | { status: 'error'; grantId: string; message: string; canRetry: boolean };

export function XeroGrantPanel({
  state,
  oauthLoading,
  onTenantChange,
  onSubmit,
  onRetry,
  onStartOver,
}: {
  state: XeroGrantState;
  oauthLoading: boolean;
  onTenantChange: (tenantId: string) => void;
  onSubmit: () => void;
  onRetry: (grantId: string) => void;
  onStartOver: () => void;
}) {
  if (state.status === 'idle') return null;

  if (state.status === 'loading' || state.status === 'submitting') {
    return (
      <div className="border-l-2 border-primary px-4 py-3" role="status">
        <div className="text-sm font-medium text-foreground">
          {state.status === 'loading'
            ? 'Checking available Xero organizations...'
            : 'Connecting the selected Xero organization...'}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">Keep this page open.</div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="border-l-2 border-destructive px-4 py-3" role="alert">
        <div className="flex items-start gap-2">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <div className="text-sm font-medium text-foreground">
              Xero connection could not be completed
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{state.message}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {state.canRetry ? (
            <Button type="button" size="sm" onClick={() => onRetry(state.grantId)}>
              Retry
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={oauthLoading}
            onClick={onStartOver}
          >
            {oauthLoading ? 'Opening Xero...' : 'Start over'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="border-l-2 border-primary px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="text-sm font-medium text-foreground">Choose a Xero organization</div>
      <div className="mt-1 text-sm text-muted-foreground">
        This organization will receive BetterSpend exports.
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1">
          <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Xero organization
          </span>
          <Select
            value={state.selectedTenantId}
            onChange={(event) => onTenantChange(event.target.value)}
            className="w-full"
          >
            <option value="">Select an organization</option>
            {state.tenants.map((tenant, index) => (
              <option key={tenant.tenantId} value={tenant.tenantId}>
                {tenant.tenantName?.trim() || `Organization ${index + 1}`} ({tenant.tenantId})
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" disabled={!state.selectedTenantId}>
          Connect
        </Button>
      </div>
    </form>
  );
}
