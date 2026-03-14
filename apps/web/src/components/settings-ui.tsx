'use client';

import Link from 'next/link';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function Field({
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

export function InlineNotice({ error, success }: { error?: string; success?: string }) {
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

export function CheckboxRow({
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
    <label className="flex gap-3 rounded-lg border border-border/70 bg-muted/20 px-4 py-4">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1" />
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description ? <div className="mt-1 text-xs text-muted-foreground">{description}</div> : null}
      </div>
    </label>
  );
}

export function RadioCard({
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
    <label className="flex gap-3 rounded-lg border border-border/70 bg-muted/20 px-4 py-4">
      <input type="radio" checked={checked} onChange={onChange} className="mt-1" />
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>
    </label>
  );
}

export function ColorField({
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

export function IntegrationCard({
  title,
  description,
  connected,
  configured,
  connectionId,
  oauthLoading,
  onConnect,
  onDisconnect,
  manageHref,
  activityHref,
}: {
  title: string;
  description: string;
  connected: boolean;
  configured: boolean;
  connectionId?: string;
  oauthLoading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  manageHref: string;
  activityHref: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/80 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <Badge variant={connected ? 'success' : 'destructive'}>
              {connected ? 'Connected' : 'Not connected'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
          <p className="text-xs text-muted-foreground">Connection mode: platform-managed OAuth</p>
          {connectionId ? <p className="font-mono text-xs text-muted-foreground">{connectionId}</p> : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild type="button" variant="outline" size="sm">
              <Link href={manageHref}>Manage mappings</Link>
            </Button>
            <Button asChild type="button" variant="outline" size="sm">
              <Link href={activityHref}>View export jobs</Link>
            </Button>
          </div>
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

export function InfoRow({
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
