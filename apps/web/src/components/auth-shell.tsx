import type { ReactNode } from 'react';
import Link from 'next/link';
import { ShieldCheck, Zap, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { cn } from '../lib/utils';

interface AuthShellProps {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthShell({
  title,
  description,
  children,
  footer,
}: AuthShellProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(221,65,36,0.18),_transparent_26%),radial-gradient(circle_at_80%_0%,_rgba(245,158,11,0.18),_transparent_22%),linear-gradient(180deg,_var(--color-ember-50),_var(--background))]">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl items-center gap-10 px-6 py-10 lg:grid-cols-[1.15fr_0.85fr] lg:px-10">
        <section className="hidden rounded-xl border border-white/40 bg-[#1a1b1f] text-white shadow-[0_30px_100px_-40px_rgba(15,23,42,0.75)] lg:flex lg:min-h-[720px] lg:flex-col lg:justify-between lg:p-10">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-white/75">
              BetterSpend
            </div>
            <div className="max-w-xl space-y-4">
              <h1 className="text-5xl font-bold leading-tight tracking-[-0.03em] text-white">
                Procurement that keeps you in control.
              </h1>
              <p className="max-w-lg text-base leading-7 text-white/70">
                From requisition to payment — manage approvals, track budgets, and close the loop on every purchase order.
              </p>
            </div>
          </div>
          <div className="grid gap-4 text-sm text-white/70">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-white/8 bg-white/[0.04] p-4 backdrop-blur">
                <ShieldCheck className="mb-2.5 size-5 text-white/50" />
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Audit trail</div>
                <div className="mt-1 text-[13px] leading-5 text-white/60">Every action logged, always immutable</div>
              </div>
              <div className="rounded-lg border border-white/8 bg-white/[0.04] p-4 backdrop-blur">
                <Zap className="mb-2.5 size-5 text-white/50" />
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Approvals</div>
                <div className="mt-1 text-[13px] leading-5 text-white/60">Multi-step chains with rule-based routing</div>
              </div>
              <div className="rounded-lg border border-white/8 bg-white/[0.04] p-4 backdrop-blur">
                <BarChart3 className="mb-2.5 size-5 text-white/50" />
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">3-Way match</div>
                <div className="mt-1 text-[13px] leading-5 text-white/60">PO, receipt, and invoice reconciled automatically</div>
              </div>
            </div>
            <div className="text-xs uppercase tracking-[0.24em] text-white/35">
              Open-source Procure-to-Pay
            </div>
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-md flex-col gap-6">
          <div className="lg:hidden">
            <Link href="/" className="text-2xl font-bold tracking-[-0.02em] text-foreground">
              BetterSpend
            </Link>
          </div>
          <Card className="animate-[fadeIn_0.3s_ease-out_both] border-border/60 bg-card/90 backdrop-blur">
            <CardHeader className="space-y-2">
              <CardTitle className="text-2xl font-semibold tracking-[-0.02em]">{title}</CardTitle>
              <CardDescription className="text-sm leading-6">{description}</CardDescription>
            </CardHeader>
            <CardContent className={cn('space-y-5')}>{children}</CardContent>
          </Card>
          {footer ? <div className="text-center text-sm text-muted-foreground">{footer}</div> : null}
          <div className="text-center text-xs uppercase tracking-[0.24em] text-muted-foreground/70 lg:hidden">
            Open-source Procure-to-Pay
          </div>
        </section>
      </div>
    </div>
  );
}
