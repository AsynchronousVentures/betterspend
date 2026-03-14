'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileStack, Layers3, Plus } from 'lucide-react';
import { api } from '../../../lib/api';
import { PageHeader } from '../../../components/page-header';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';

interface TemplateLine {
  description: string;
  quantity: number;
  unitOfMeasure: string;
  unitPrice: number;
}

interface TemplateData {
  title: string;
  description?: string;
  priority: string;
  currency: string;
  lines: TemplateLine[];
}

interface Template {
  id: string;
  name: string;
  description?: string;
  isOrgWide: boolean;
  templateData: TemplateData;
  createdAt: string;
  createdBy?: { id: string; name: string; email: string };
}

function formatCurrency(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function totalFromLines(lines: TemplateLine[]) {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
}

export default function RequisitionTemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.requisitionTemplates.list();
      setTemplates(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load requisition templates.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    setError('');
    try {
      await api.requisitionTemplates.remove(id);
      setTemplates((prev) => prev.filter((template) => template.id !== id));
    } catch (err: any) {
      setError(err.message ?? 'Failed to delete template.');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Requisition Templates"
        description="Reusable requisition patterns for repeat purchasing across common request scenarios."
        actions={
          <Button asChild>
            <Link href="/requisitions/new">
              <Plus className="h-4 w-4" />
              New Requisition
            </Link>
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={FileStack} label="Templates" value={String(templates.length)} tone="text-sky-700" />
        <StatCard
          icon={Layers3}
          label="Org-Wide"
          value={String(templates.filter((template) => template.isOrgWide).length)}
          tone="text-violet-700"
        />
        <StatCard
          icon={Plus}
          label="Private"
          value={String(templates.filter((template) => !template.isOrgWide).length)}
          tone="text-emerald-700"
        />
      </div>

      {loading ? (
        <EmptyState message="Loading requisition templates..." />
      ) : templates.length === 0 ? (
        <Card className="rounded-[24px]">
          <CardContent className="px-6 py-12 text-center">
            <div className="text-lg font-semibold text-foreground">No templates yet</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Open a requisition and use Save as Template to create your first reusable request.
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <Button asChild>
                <Link href="/requisitions/new">Start Requisition</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/requisitions">View Requisitions</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {templates.map((template) => {
            const total = totalFromLines(template.templateData?.lines ?? []);
            const lineCount = template.templateData?.lines?.length ?? 0;
            return (
              <Card key={template.id} className="rounded-[24px]">
                <CardHeader className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="truncate text-xl">{template.name}</CardTitle>
                      {template.description ? (
                        <CardDescription>{template.description}</CardDescription>
                      ) : null}
                    </div>
                    {template.isOrgWide ? <Badge variant="success">Org-wide</Badge> : null}
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
                      {template.templateData?.title}
                    </span>
                    <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
                      {lineCount} line{lineCount !== 1 ? 's' : ''}
                    </span>
                    <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
                      {formatCurrency(total, template.templateData?.currency ?? 'USD')}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    {(template.templateData?.lines ?? []).slice(0, 3).map((line, index) => (
                      <div
                        key={index}
                        className="rounded-2xl border border-border/70 bg-background/70 p-4"
                      >
                        <div className="text-sm font-medium text-foreground">
                          {line.description}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {line.quantity} {line.unitOfMeasure} x{' '}
                          {formatCurrency(
                            line.unitPrice,
                            template.templateData?.currency ?? 'USD',
                          )}
                        </div>
                      </div>
                    ))}
                    {lineCount > 3 ? (
                      <div className="text-sm text-muted-foreground">
                        +{lineCount - 3} more line{lineCount - 3 !== 1 ? 's' : ''}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-3 border-t border-border/70 pt-4">
                    <Button
                      type="button"
                      onClick={() => router.push(`/requisitions/new?templateId=${template.id}`)}
                    >
                      Use Template
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleDelete(template.id, template.name)}
                      disabled={deleting === template.id}
                    >
                      {deleting === template.id ? 'Deleting...' : 'Delete'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="rounded-[24px]">
      <CardContent className="px-6 py-12 text-center text-sm text-muted-foreground">
        {message}
      </CardContent>
    </Card>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <Card className="rounded-[24px] border-border/70 bg-card/95">
      <CardContent className="flex items-center gap-4 p-6">
        <div className={`rounded-2xl border border-current/10 bg-current/10 p-3 ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
          <div className="font-display text-3xl font-semibold tracking-[-0.04em] text-foreground">
            {value}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
