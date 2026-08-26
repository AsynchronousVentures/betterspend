'use client';

import type { LucideIcon } from 'lucide-react';
import { AlertCircle, LockKeyhole, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

export type ResourceStateKind = 'loading' | 'empty' | 'denied' | 'failed';

interface ListStateProps {
  state: ResourceStateKind;
  loadingLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  icon?: LucideIcon;
  onRetry?: () => void;
}

/** A consistent state for list routes where an empty response and a failed request mean different things. */
export function ListState({
  state,
  loadingLabel,
  emptyTitle,
  emptyDescription,
  icon: EmptyIcon,
  onRetry,
}: ListStateProps) {
  if (state === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-[260px] items-center justify-center px-6 text-center text-sm text-muted-foreground"
      >
        {loadingLabel}
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 px-6 text-center">
        {EmptyIcon ? (
          <EmptyIcon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <div>
          <p className="text-base font-semibold text-foreground">{emptyTitle}</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{emptyDescription}</p>
        </div>
      </div>
    );
  }

  const denied = state === 'denied';
  const Icon = denied ? LockKeyhole : AlertCircle;
  const title = denied ? 'Access denied' : 'Failed to load';
  const description = denied
    ? 'You do not have access to this data. Return to your work or ask an administrator for access.'
    : 'Try again. If this keeps happening, contact your administrator.';

  return (
    <div
      role="alert"
      className="flex min-h-[300px] flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <Icon className="h-6 w-6 text-destructive" aria-hidden="true" />
      <div>
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {!denied && onRetry ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

interface PanelErrorProps {
  state?: 'denied' | 'failed';
  title?: string;
  onRetry?: () => void;
}

/** Keeps a loaded detail page usable when one secondary panel cannot be retrieved. */
export function PanelError({ state = 'failed', title, onRetry }: PanelErrorProps) {
  const denied = state === 'denied';
  const resolvedTitle = title ?? (denied ? 'Access denied' : 'Failed to load this section');

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
    >
      <span className="font-medium text-foreground">{resolvedTitle}</span>
      {!denied && onRetry ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
