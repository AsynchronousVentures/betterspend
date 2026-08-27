import { Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/** Keeps supporting and destructive record actions reachable without competing with the next action. */
export function DetailActionMenu({
  secondary,
  destructive,
  className,
}: {
  secondary?: ReactNode;
  destructive?: ReactNode;
  className?: string;
}) {
  if (!secondary && !destructive) return null;

  return (
    <details className={cn('relative', className)}>
      <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
        More actions
        <Ellipsis className="h-4 w-4" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 z-30 mt-2 grid w-56 gap-4 border border-border bg-background p-3 shadow-lg">
        {secondary ? (
          <div className="grid gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Other actions
            </div>
            <div className="grid gap-2">{secondary}</div>
          </div>
        ) : null}
        {destructive ? (
          <div className="grid gap-2 border-t border-border pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-destructive">
              Destructive
            </div>
            <div className="grid gap-2">{destructive}</div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
