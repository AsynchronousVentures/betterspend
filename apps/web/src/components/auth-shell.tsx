import type { ReactNode } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { cn } from '../lib/utils';

interface AuthShellProps {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  panelEyebrow?: string;
  panelTitle?: string;
  panelBody?: string;
}

export function AuthShell({
  title,
  description,
  children,
  footer,
  panelEyebrow = 'BetterSpend Platform',
  panelTitle = 'Procurement with taste, not template drift.',
  panelBody = 'This refresh introduces a proper design system foundation so the product can scale past hand-tuned inline styling.',
}: AuthShellProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(221,65,36,0.18),_transparent_26%),radial-gradient(circle_at_80%_0%,_rgba(245,158,11,0.18),_transparent_22%),linear-gradient(180deg,_var(--color-ember-50),_var(--background))]">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl items-center gap-10 px-6 py-10 lg:grid-cols-[1.15fr_0.85fr] lg:px-10">
        <section className="hidden rounded-[2rem] border border-white/40 bg-slate-950 text-white shadow-[0_30px_100px_-40px_rgba(15,23,42,0.75)] lg:flex lg:min-h-[720px] lg:flex-col lg:justify-between lg:p-10">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-white/75">
              <Sparkles className="size-3.5" />
              {panelEyebrow}
            </div>
            <div className="max-w-xl space-y-4">
              <h1 className="font-display text-5xl leading-tight tracking-[-0.04em] text-white">
                {panelTitle}
              </h1>
              <p className="max-w-lg text-base leading-7 text-white/70">{panelBody}</p>
            </div>
          </div>
          <div className="grid gap-4 text-sm text-white/70">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/45">Why this stack</div>
              <div className="text-pretty leading-6">
                Tailwind v4 gives us tokenized control, shadcn/ui provides consistent primitives, and Lucide replaces the hand-drawn icon drift.
              </div>
            </div>
            <div className="text-xs uppercase tracking-[0.24em] text-white/35">
              Open Source Procure-to-Pay by Asynchronous Ventures LLC
            </div>
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-md flex-col gap-6">
          <div className="lg:hidden">
            <Link href="/" className="font-display text-2xl font-semibold tracking-[-0.04em] text-foreground">
              BetterSpend
            </Link>
          </div>
          <Card className="border-border/60 bg-card/90 backdrop-blur">
            <CardHeader className="space-y-2">
              <CardTitle className="font-display text-3xl tracking-[-0.04em]">{title}</CardTitle>
              <CardDescription className="text-sm leading-6">{description}</CardDescription>
            </CardHeader>
            <CardContent className={cn('space-y-5')}>{children}</CardContent>
          </Card>
          {footer ? <div className="text-center text-sm text-muted-foreground">{footer}</div> : null}
          <div className="text-center text-xs uppercase tracking-[0.24em] text-muted-foreground/70 lg:hidden">
            Open Source Procure-to-Pay by Asynchronous Ventures LLC
          </div>
        </section>
      </div>
    </div>
  );
}
