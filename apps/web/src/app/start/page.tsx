'use client';

import type { FormEvent, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileText,
  Info,
  MessageSquarePlus,
  Route,
  Send,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Textarea } from '../../components/ui/textarea';

type Workflow = 'requisition' | 'rfq' | 'vendor_onboarding' | 'software_license';

interface ConciergeSession {
  id: string;
  status: string;
  sourceText: string;
  transcript?: Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>;
  draft?: {
    title?: string;
    description?: string;
    priority?: string;
    suggestedVendor?: string;
    neededBy?: string;
    lines?: Array<{
      description?: string;
      quantity?: number;
      unitOfMeasure?: string;
      unitPrice?: number;
    }>;
  };
  plan?: ConciergePlan;
}

interface ConciergePlan {
  summary?: string;
  route?: {
    workflow: Workflow;
    label: string;
    url: string;
    reason: string;
  };
  estimatedAmount?: number;
  currency?: string;
  confidence?: number;
  missingFields?: string[];
  questions?: Array<{ field: string; prompt: string; reason: string }>;
  policyCitations?: Array<{
    sourceType: string;
    sourceId: string;
    title: string;
    excerpt: string;
  }>;
  preferredVendors?: Array<Record<string, any>>;
  recommendedCatalogItems?: Array<Record<string, any>>;
  activeContracts?: Array<Record<string, any>>;
  softwareMatches?: Array<Record<string, any>>;
  approvalEstimate?: {
    activeRuleCount: number;
    estimatedSteps: number;
    summary: string;
  };
  budgetImpact?: {
    budgetsInScope: number;
    estimatedAmount: number;
    currency: string;
    summary: string;
  };
  guardrails?: string[];
  warnings?: string[];
}

const EXAMPLE_REQUEST =
  'Need 25 ergonomic keyboards for the support team by July 15, 2026. Prefer our current office equipment supplier and keep it under $2,500 if possible.';

function formatCurrency(amount?: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount ?? 0));
}

function workflowBadgeVariant(workflow?: Workflow) {
  if (workflow === 'vendor_onboarding') return 'warning' as const;
  if (workflow === 'software_license') return 'secondary' as const;
  if (workflow === 'rfq') return 'default' as const;
  return 'success' as const;
}

function workflowActionLabel(workflow?: Workflow) {
  if (workflow === 'vendor_onboarding') return 'Open Supplier Onboarding';
  if (workflow === 'software_license') return 'Open Software Licenses';
  if (workflow === 'rfq') return 'Create RFQ Draft';
  return 'Create Requisition Draft';
}

function ListSection({
  title,
  icon: Icon,
  items,
  render,
  empty,
}: {
  title: string;
  icon: typeof ShoppingCart;
  items?: Array<Record<string, any>>;
  render: (item: Record<string, any>, index: number) => ReactNode;
  empty: string;
}) {
  return (
    <div className="rounded-md border border-border/70">
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="divide-y divide-border/70">
        {items && items.length > 0 ? (
          items.slice(0, 4).map((item, index) => (
            <div key={`${title}-${String(item.id ?? index)}`} className="px-4 py-3 text-sm">
              {render(item, index)}
            </div>
          ))
        ) : (
          <div className="px-4 py-4 text-sm text-muted-foreground">{empty}</div>
        )}
      </div>
    </div>
  );
}

export default function StartRequestPage() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const [session, setSession] = useState<ConciergeSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = session?.plan;
  const draft = session?.draft;
  const route = plan?.route;
  const lines = draft?.lines ?? [];
  const total = useMemo(
    () => lines.reduce((sum, line) => sum + Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0), 0),
    [lines],
  );

  async function handleStart(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const created = await api.concierge.createSession(text.trim());
      setSession(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start request');
    } finally {
      setLoading(false);
    }
  }

  async function handleMessage(event: FormEvent) {
    event.preventDefault();
    if (!session || !message.trim()) return;
    setError(null);
    setMessaging(true);
    try {
      const updated = await api.concierge.addMessage(session.id, message.trim());
      setSession(updated);
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update request');
    } finally {
      setMessaging(false);
    }
  }

  async function handleConvert() {
    if (!session) return;
    setError(null);
    setConverting(true);
    try {
      const result = await api.concierge.convert(session.id, { workflow: route?.workflow });
      if (result?.url) router.push(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to convert request');
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Start Request"
        description="Describe what you need once, then review the routed draft, policies, suppliers, and controls before creating the next workflow item."
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" />
                Request Intake
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleStart} className="space-y-4">
                <Textarea
                  required
                  rows={8}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={EXAMPLE_REQUEST}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setText(EXAMPLE_REQUEST)}
                    disabled={loading}
                  >
                    <FileText className="h-4 w-4" />
                    Use Example
                  </Button>
                  <Button type="submit" disabled={loading || !text.trim()}>
                    <Send className="h-4 w-4" />
                    {loading ? 'Analyzing...' : 'Analyze Request'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquarePlus className="h-4 w-4" />
                Missing Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {plan?.questions && plan.questions.length > 0 ? (
                <div className="space-y-3">
                  {plan.questions.map((question) => (
                    <div key={question.field} className="rounded-md border border-border/70 px-3 py-2">
                      <p className="text-sm font-medium text-foreground">{question.prompt}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{question.reason}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Analyze a request to see the fields procurement needs before conversion.
                </p>
              )}

              {session ? (
                <form onSubmit={handleMessage} className="space-y-3">
                  <Textarea
                    rows={4}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Add supplier, delivery date, department, budget, or other details"
                  />
                  <div className="flex justify-end">
                    <Button type="submit" variant="outline" disabled={messaging || !message.trim()}>
                      <ArrowRight className="h-4 w-4" />
                      {messaging ? 'Updating...' : 'Update Guidance'}
                    </Button>
                  </div>
                </form>
              ) : null}

              {session?.transcript && session.transcript.length > 0 ? (
                <div className="rounded-md border border-border/70">
                  <div className="border-b border-border/70 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                    Conversation
                  </div>
                  <div className="max-h-72 space-y-3 overflow-y-auto px-3 py-3">
                    {session.transcript.map((entry, index) => (
                      <div
                        key={`${entry.role}-${entry.createdAt}-${index}`}
                        className={entry.role === 'assistant' ? 'rounded-md bg-muted/60 px-3 py-2' : 'px-3 py-1'}
                      >
                        <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
                          {entry.role === 'assistant' ? 'Assistant' : 'Requester'}
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{entry.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Route className="h-4 w-4" />
                Routed Plan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {plan ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={workflowBadgeVariant(route?.workflow)}>{route?.label ?? 'Draft'}</Badge>
                        <Badge variant="outline">{Math.round((plan.confidence ?? 0) * 100)}% confidence</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{route?.reason}</p>
                    </div>
                    <Button type="button" onClick={handleConvert} disabled={converting || session?.status !== 'draft'}>
                      {route?.workflow === 'vendor_onboarding' || route?.workflow === 'software_license' ? (
                        <ExternalLink className="h-4 w-4" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      {converting ? 'Converting...' : workflowActionLabel(route?.workflow)}
                    </Button>
                  </div>

                  {plan.warnings && plan.warnings.length > 0 ? (
                    <Alert variant="warning">
                      <AlertTitle>Review before conversion</AlertTitle>
                      <AlertDescription>
                        <ul className="space-y-1">
                          {plan.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-md border border-border/70 px-4 py-3">
                      <p className="text-xs font-medium uppercase text-muted-foreground">Estimated Total</p>
                      <p className="mt-1 text-lg font-semibold text-foreground">
                        {formatCurrency(plan.estimatedAmount ?? total, plan.currency)}
                      </p>
                    </div>
                    <div className="rounded-md border border-border/70 px-4 py-3">
                      <p className="text-xs font-medium uppercase text-muted-foreground">Approval Rules</p>
                      <p className="mt-1 text-lg font-semibold text-foreground">
                        {plan.approvalEstimate?.activeRuleCount ?? 0}
                      </p>
                    </div>
                    <div className="rounded-md border border-border/70 px-4 py-3">
                      <p className="text-xs font-medium uppercase text-muted-foreground">Budgets</p>
                      <p className="mt-1 text-lg font-semibold text-foreground">
                        {plan.budgetImpact?.budgetsInScope ?? 0}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Alert>
                      <ShieldCheck className="absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" />
                      <AlertTitle className="pl-6">Controls</AlertTitle>
                      <AlertDescription className="pl-6">
                        {plan.approvalEstimate?.summary}
                      </AlertDescription>
                    </Alert>
                    <Alert>
                      <WalletCards className="absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" />
                      <AlertTitle className="pl-6">Budget</AlertTitle>
                      <AlertDescription className="pl-6">{plan.budgetImpact?.summary}</AlertDescription>
                    </Alert>
                  </div>
                </>
              ) : (
                <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
                  <div className="rounded-full bg-muted p-4">
                    <Info className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-foreground">No plan yet</p>
                    <p className="mt-1 max-w-md text-sm text-muted-foreground">
                      Submit a request to generate routing, draft data, supplier guidance, and policy citations.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {draft ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" />
                  Draft Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{draft.title}</h2>
                  {draft.description ? (
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{draft.description}</p>
                  ) : null}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Priority</span>
                    <p className="font-medium capitalize text-foreground">{draft.priority ?? 'normal'}</p>
                  </div>
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Supplier</span>
                    <p className="font-medium text-foreground">{draft.suggestedVendor ?? 'Not set'}</p>
                  </div>
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Needed By</span>
                    <p className="font-medium text-foreground">{draft.neededBy ?? 'Not set'}</p>
                  </div>
                </div>
                <div className="overflow-hidden rounded-md border border-border/70">
                  <div className="grid grid-cols-[minmax(0,1fr)_80px_110px] gap-3 border-b border-border/70 bg-muted/50 px-4 py-2 text-xs font-medium uppercase text-muted-foreground">
                    <span>Line</span>
                    <span>Qty</span>
                    <span className="text-right">Unit Price</span>
                  </div>
                  {lines.map((line, index) => (
                    <div
                      key={`${line.description ?? 'line'}-${index}`}
                      className="grid grid-cols-[minmax(0,1fr)_80px_110px] gap-3 px-4 py-3 text-sm"
                    >
                      <span className="min-w-0 text-foreground">{line.description}</span>
                      <span className="text-muted-foreground">
                        {line.quantity ?? 1} {line.unitOfMeasure ?? 'each'}
                      </span>
                      <span className="text-right font-medium text-foreground">
                        {formatCurrency(line.unitPrice ?? 0, plan?.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {plan ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <ListSection
                title="Catalog Matches"
                icon={ShoppingCart}
                items={plan.recommendedCatalogItems}
                empty="No strong catalog match yet."
                render={(item) => (
                  <div>
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="mt-1 text-muted-foreground">
                      {item.vendorName ?? 'Vendor not set'} - {formatCurrency(Number(item.unitPrice ?? 0), item.currency)}
                    </p>
                  </div>
                )}
              />
              <ListSection
                title="Preferred Suppliers"
                icon={Building2}
                items={plan.preferredVendors}
                empty="No supplier recommendation yet."
                render={(item) => (
                  <div>
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="mt-1 text-muted-foreground">
                      {item.status} - onboarding {item.onboardingStatus}
                    </p>
                  </div>
                )}
              />
              <ListSection
                title="Active Contracts"
                icon={FileText}
                items={plan.activeContracts}
                empty="No contract match yet."
                render={(item) => (
                  <div>
                    <p className="font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 text-muted-foreground">
                      {item.contractNumber ?? 'No number'} - {item.vendorName ?? 'Vendor not set'}
                    </p>
                  </div>
                )}
              />
              <ListSection
                title="Policy Citations"
                icon={ShieldCheck}
                items={plan.policyCitations}
                empty="No policy citations returned."
                render={(item) => (
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{item.title}</p>
                      <Badge variant="subtle">{item.sourceType}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">{item.excerpt}</p>
                  </div>
                )}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
