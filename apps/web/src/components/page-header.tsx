import * as React from 'react';
import { cn } from '../lib/utils';

interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions, className, ...props }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-[28px] border border-border/70 bg-card/90 px-6 py-5 shadow-[0_22px_70px_-42px_rgba(15,23,42,0.45)] lg:flex-row lg:items-end lg:justify-between',
        className,
      )}
      {...props}
    >
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}
