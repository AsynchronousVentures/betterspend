'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, FileStack, ShieldAlert } from 'lucide-react';
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
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

type DraftQuestion = {
  id: string;
  label: string;
  type: 'short_text' | 'long_text' | 'yes_no' | 'date';
  required: boolean;
  riskPointsIfNegative?: number;
};

const TYPE_LABELS: Record<DraftQuestion['type'], string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  yes_no: 'Yes / No',
  date: 'Date',
};

const RISK_BADGE_STYLES: Record<string, string> = {
  high: 'border-rose-200 bg-rose-100 text-rose-800',
  medium: 'border-amber-200 bg-amber-100 text-amber-800',
  low: 'border-emerald-200 bg-emerald-100 text-emerald-800',
};

export default function VendorOnboardingPage() {
  const [queue, setQueue] = useState<any[]>([]);
  const [questionnaires, setQuestionnaires] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [questionnaireName, setQuestionnaireName] = useState('Default Supplier Onboarding');
  const [makeDefault, setMakeDefault] = useState(true);
  const [questions, setQuestions] = useState<DraftQuestion[]>([
    {
      id: 'tax_registered',
      label: 'Are you tax registered in your operating jurisdiction?',
      type: 'yes_no',
      required: true,
      riskPointsIfNegative: 30,
    },
    {
      id: 'sanctions_program',
      label: 'Do you maintain sanctions and denied-party screening controls?',
      type: 'yes_no',
      required: true,
      riskPointsIfNegative: 35,
    },
  ]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [queueData, questionnaireData] = await Promise.all([
        api.vendors.onboardingQueue(),
        api.vendors.onboardingQuestionnaires(),
      ]);
      setQueue(queueData);
      setQuestionnaires(questionnaireData);
    } catch {
      setError('Failed to load onboarding data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreateQuestionnaire() {
    setSaving(true);
    setError('');
    try {
      await api.vendors.createOnboardingQuestionnaire({
        name: questionnaireName,
        isDefault: makeDefault,
        questions: questions.map((question) => ({
          id: question.id,
          label: question.label,
          type: question.type,
          required: question.required,
        })),
        scoringRules: questions
          .filter((question) => question.type === 'yes_no' && (question.riskPointsIfNegative ?? 0) > 0)
          .map((question) => ({
            questionId: question.id,
            equals: 'no',
            points: question.riskPointsIfNegative,
          })),
      });
      await load();
    } catch {
      setError('Failed to save questionnaire.');
    } finally {
      setSaving(false);
    }
  }

  function updateQuestion(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index ? { ...question, ...patch } : question,
      ),
    );
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Vendor Onboarding"
        description="Review onboarding submissions, inspect risk levels, and maintain the default questionnaire vendors complete in the portal."
        actions={
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <ClipboardCheck className="h-4 w-4" />
            Supplier intake
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={ClipboardCheck}
          label="Pending Reviews"
          value={String(queue.length)}
          tone="text-sky-700"
        />
        <StatCard
          icon={FileStack}
          label="Saved Questionnaires"
          value={String(questionnaires.length)}
          tone="text-violet-700"
        />
        <StatCard
          icon={ShieldAlert}
          label="High-Risk Submissions"
          value={String(queue.filter((submission) => submission.riskLevel === 'high').length)}
          tone="text-rose-700"
        />
      </div>

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Questionnaire Builder</CardTitle>
          <CardDescription>
            Create and version the supplier intake questionnaire used in the vendor portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <Field label="Questionnaire name">
              <Input
                value={questionnaireName}
                onChange={(event) => setQuestionnaireName(event.target.value)}
                placeholder="Default Supplier Onboarding"
              />
            </Field>
            <label className="flex h-10 items-center gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={makeDefault}
                onChange={(event) => setMakeDefault(event.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
              />
              Make default questionnaire
            </label>
          </div>

          <div className="space-y-4">
            {questions.map((question, index) => (
              <div
                key={question.id}
                className="rounded-2xl border border-border/70 bg-background/70 p-4 shadow-sm"
              >
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_200px_180px_auto] xl:items-end">
                  <Field label={`Question ${index + 1}`}>
                    <Input
                      value={question.label}
                      onChange={(event) => updateQuestion(index, { label: event.target.value })}
                      placeholder="Enter question prompt"
                    />
                  </Field>
                  <Field label="Response type">
                    <Select
                      value={question.type}
                      onChange={(event) =>
                        updateQuestion(index, { type: event.target.value as DraftQuestion['type'] })
                      }
                      className="w-full"
                    >
                      {Object.entries(TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Risk points if negative">
                    <Input
                      type="number"
                      min="0"
                      value={question.riskPointsIfNegative ?? 0}
                      onChange={(event) =>
                        updateQuestion(index, {
                          riskPointsIfNegative: Number(event.target.value || 0),
                        })
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() =>
                      setQuestions((current) =>
                        current.filter((_, questionIndex) => questionIndex !== index),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
                <label className="mt-4 inline-flex items-center gap-3 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={question.required}
                    onChange={(event) => updateQuestion(index, { required: event.target.checked })}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40"
                  />
                  Required question
                </label>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setQuestions((current) => [
                  ...current,
                  {
                    id: `q_${Date.now()}`,
                    label: '',
                    type: 'short_text',
                    required: false,
                    riskPointsIfNegative: 0,
                  },
                ])
              }
            >
              Add Question
            </Button>
            <Button type="button" onClick={handleCreateQuestionnaire} disabled={saving}>
              {saving ? 'Saving...' : 'Save Questionnaire'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Pending Reviews</CardTitle>
          <CardDescription>
            Review vendor submissions, triage high-risk responses, and jump directly into the vendor record.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <EmptyState message="Loading onboarding queue..." />
          ) : queue.length === 0 ? (
            <EmptyState message="No vendor onboarding submissions are waiting for review." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Questionnaire</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium text-foreground">
                          {submission.vendor?.name ?? 'Unknown vendor'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Score {submission.riskScore ?? 0}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {submission.questionnaire?.name ?? 'Default questionnaire'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {submission.submittedAt
                        ? new Date(submission.submittedAt).toLocaleString()
                        : 'Draft'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={RISK_BADGE_STYLES[submission.riskLevel] ?? RISK_BADGE_STYLES.low}
                      >
                        {submission.riskLevel} risk
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {String(submission.status).replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/vendors/${submission.vendorId}`}>Open vendor</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Saved Questionnaires</CardTitle>
          <CardDescription>
            Track published questionnaires, question counts, and scoring coverage over time.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {questionnaires.length === 0 ? (
            <EmptyState message="No saved questionnaires yet." compact />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Questions</TableHead>
                  <TableHead>Scoring Rules</TableHead>
                  <TableHead>Default</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {questionnaires.map((questionnaire) => (
                  <TableRow key={questionnaire.id}>
                    <TableCell className="font-medium text-foreground">{questionnaire.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {(questionnaire.questions ?? []).length}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {(questionnaire.scoringRules ?? []).length}
                    </TableCell>
                    <TableCell>
                      {questionnaire.isDefault ? <Badge variant="success">Default</Badge> : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function EmptyState({
  message,
  compact = false,
}: {
  message: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-border/70 bg-muted/20 text-center text-sm text-muted-foreground ${
        compact ? 'px-6 py-8' : 'px-6 py-12'
      }`}
    >
      {message}
    </div>
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
