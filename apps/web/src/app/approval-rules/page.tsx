'use client';

import { type ReactNode, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Braces,
  FlaskConical,
  GitBranchPlus,
  Plus,
  Save,
  Trash2,
  Workflow,
} from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';

type RuleStep = {
  id?: string;
  stepOrder: number;
  approverType: string;
  approverId?: string | null;
  approverRole?: string | null;
  requiredCount: number;
};

type RuleRecord = {
  id: string;
  name: string;
  description?: string | null;
  priority: number;
  isActive: boolean;
  conditions: unknown;
  steps: RuleStep[];
  entity?: { id: string; name: string } | null;
};

type UserRecord = {
  id: string;
  name: string;
  email: string;
  isActive?: boolean;
  userRoles?: Array<{ id: string; role: string }>;
};

type ConditionLeaf = {
  field: string;
  operator: string;
  value: string;
};

type RuleDraft = {
  id?: string;
  name: string;
  description: string;
  priority: number;
  conditions: Record<string, unknown>;
  steps: RuleStep[];
};

type SimulationForm = {
  requesterId: string;
  departmentId: string;
  projectId: string;
  totalAmount: string;
  currency: string;
};

const ROLE_OPTIONS = ['approver', 'admin', 'finance', 'requester', 'receiver'];
const APPROVER_TYPE_OPTIONS = [
  { value: 'role', label: 'Role' },
  { value: 'user', label: 'Specific user' },
  { value: 'manager', label: 'Manager' },
  { value: 'department_head', label: 'Department head' },
  { value: 'budget_owner', label: 'Budget owner' },
];
const COMPARISON_OPTIONS = [
  { value: '>=', label: 'is at least' },
  { value: '>', label: 'is greater than' },
  { value: '<=', label: 'is at most' },
  { value: '<', label: 'is less than' },
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
];
const FIELD_PRESETS = [
  { value: 'totalAmount', label: 'totalAmount' },
  { value: 'total_amount', label: 'total_amount' },
  { value: 'departmentId', label: 'departmentId' },
  { value: 'requesterId', label: 'requesterId' },
  { value: 'currency', label: 'currency' },
];

function createDefaultStep(stepOrder = 1): RuleStep {
  return {
    stepOrder,
    approverType: 'role',
    approverRole: 'approver',
    approverId: null,
    requiredCount: 1,
  };
}

function createEmptyDraft(): RuleDraft {
  return {
    name: '',
    description: '',
    priority: 100,
    conditions: {
      operator: 'AND',
      conditions: [{ field: 'totalAmount', operator: '>=', value: 1000 }],
    },
    steps: [createDefaultStep(1)],
  };
}

function parseStoredConditions(input: unknown): Record<string, unknown> {
  if (!input) return {};
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

function normalizeSteps(input: unknown): RuleStep[] {
  if (!Array.isArray(input) || input.length === 0) return [createDefaultStep(1)];

  return input.map((step, index) => {
    const record = typeof step === 'object' && step !== null ? (step as Record<string, unknown>) : {};
    return {
      id: typeof record.id === 'string' ? record.id : undefined,
      stepOrder: index + 1,
      approverType: typeof record.approverType === 'string' ? record.approverType : 'role',
      approverId: typeof record.approverId === 'string' ? record.approverId : null,
      approverRole:
        typeof record.approverRole === 'string'
          ? record.approverRole
          : typeof record.approverType === 'string' && record.approverType !== 'role'
            ? null
            : 'approver',
      requiredCount: Math.max(1, Number(record.requiredCount ?? 1)),
    };
  });
}

function normalizeDraft(input: unknown): RuleDraft {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    name: typeof record.name === 'string' ? record.name : '',
    description: typeof record.description === 'string' ? record.description : '',
    priority: Number(record.priority ?? 100),
    conditions: parseStoredConditions(record.conditions),
    steps: normalizeSteps(record.steps),
  };
}

function serializeDraft(draft: RuleDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    priority: draft.priority,
    conditions: draft.conditions,
    steps: draft.steps.map((step, index) => ({
      stepOrder: index + 1,
      approverType: step.approverType,
      approverId: step.approverType === 'user' ? (step.approverId ?? undefined) : undefined,
      approverRole: step.approverType === 'role' ? (step.approverRole ?? 'approver') : undefined,
      requiredCount: Math.max(1, step.requiredCount || 1),
    })),
  };
}

function stringifyDraft(draft: RuleDraft) {
  return JSON.stringify(serializeDraft(draft), null, 2);
}

function parseScalarValue(raw: string): string | number | boolean | null {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (!Number.isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed);
  return raw;
}

function valueToInput(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

function describeCondition(condition: unknown): string {
  const parsed = parseStoredConditions(condition);
  if (parsed.operator === 'AND' || parsed.operator === 'OR') {
    const children = Array.isArray(parsed.conditions) ? parsed.conditions : [];
    if (children.length === 0) return 'Always matches';
    return `${parsed.operator} ${children.length} condition${children.length === 1 ? '' : 's'}`;
  }

  if (typeof parsed.field === 'string' && typeof parsed.operator === 'string') {
    return `${parsed.field} ${parsed.operator} ${valueToInput(parsed.value)}`;
  }

  return 'Always matches';
}

function isSimpleConditionNode(node: unknown): node is { field: string; operator: string; value: unknown } {
  return Boolean(
    node &&
      typeof node === 'object' &&
      typeof (node as Record<string, unknown>).field === 'string' &&
      typeof (node as Record<string, unknown>).operator === 'string' &&
      Object.prototype.hasOwnProperty.call(node as Record<string, unknown>, 'value'),
  );
}

function getVisualConditionState(condition: Record<string, unknown>): {
  supported: boolean;
  operator: 'AND' | 'OR';
  leaves: ConditionLeaf[];
} {
  if (!condition || Object.keys(condition).length === 0) {
    return {
      supported: true,
      operator: 'AND',
      leaves: [{ field: 'totalAmount', operator: '>=', value: '1000' }],
    };
  }

  if (isSimpleConditionNode(condition)) {
    return {
      supported: true,
      operator: 'AND',
      leaves: [{ field: condition.field, operator: condition.operator, value: valueToInput(condition.value) }],
    };
  }

  if (condition.operator === 'AND' || condition.operator === 'OR') {
    const children = Array.isArray(condition.conditions) ? condition.conditions : [];
    if (children.every(isSimpleConditionNode)) {
      return {
        supported: true,
        operator: condition.operator,
        leaves: children.map((child) => ({
          field: child.field,
          operator: child.operator,
          value: valueToInput(child.value),
        })),
      };
    }
  }

  return { supported: false, operator: 'AND', leaves: [] };
}

function buildConditionsFromVisual(operator: 'AND' | 'OR', leaves: ConditionLeaf[]): Record<string, unknown> {
  const normalizedLeaves = leaves
    .map((leaf) => ({
      field: leaf.field.trim(),
      operator: leaf.operator,
      value: parseScalarValue(leaf.value),
    }))
    .filter((leaf) => leaf.field);

  if (normalizedLeaves.length === 0) return {};
  if (normalizedLeaves.length === 1) return normalizedLeaves[0];
  return { operator, conditions: normalizedLeaves };
}

function formatStepSummary(step: RuleStep, users: UserRecord[]) {
  if (step.approverType === 'role') return `Role: ${step.approverRole || 'approver'}`;
  if (step.approverType === 'user') {
    const user = users.find((candidate) => candidate.id === step.approverId);
    return user ? `User: ${user.name}` : 'User: unassigned';
  }
  return APPROVER_TYPE_OPTIONS.find((option) => option.value === step.approverType)?.label || step.approverType;
}

function createDefaultSimulation(): SimulationForm {
  return {
    requesterId: '',
    departmentId: '',
    projectId: '',
    totalAmount: '2500',
    currency: 'USD',
  };
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function RuleCard({
  rule,
  users,
  selected,
  onSelect,
  onDeactivate,
}: {
  rule: RuleRecord;
  users: UserRecord[];
  selected: boolean;
  onSelect: () => void;
  onDeactivate: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-[22px] border px-4 py-4 text-left transition-colors ${
        selected
          ? 'border-sky-300 bg-sky-50 shadow-[0_16px_44px_-32px_rgba(14,165,233,0.55)]'
          : 'border-border/70 bg-card hover:bg-muted/20'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <div>
            <div className="font-semibold text-foreground">{rule.name}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Priority {rule.priority} · {rule.steps.length} step{rule.steps.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="text-sm text-muted-foreground">{describeCondition(rule.conditions)}</div>
          <div className="flex flex-wrap gap-2">
            {rule.steps.slice(0, 3).map((step) => (
              <Badge key={`${rule.id}-${step.stepOrder}`} variant="outline" className="bg-background/70">
                {formatStepSummary(step, users)}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge value={rule.isActive ? 'active' : 'inactive'} />
          {rule.isActive ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDeactivate();
              }}
              className="text-xs font-medium text-rose-700 underline-offset-2 hover:underline"
            >
              Deactivate
            </button>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export default function ApprovalRulesPage() {
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'visual' | 'raw' | 'simulator'>('visual');
  const [draft, setDraft] = useState<RuleDraft>(createEmptyDraft());
  const [rawText, setRawText] = useState(stringifyDraft(createEmptyDraft()));
  const [rawError, setRawError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<SimulationForm>(createDefaultSimulation());
  const [simulationResult, setSimulationResult] = useState<any>(null);
  const [simulationLoading, setSimulationLoading] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      const [ruleData, userData] = await Promise.all([api.approvalRules.list(), api.users.list()]);
      setRules(
        ruleData.map((rule) => ({
          ...rule,
          conditions: parseStoredConditions(rule.conditions),
          steps: normalizeSteps(rule.steps),
        })),
      );
      setUsers(userData);
    } catch {
      setSaveError('Unable to load approval rules right now.');
    } finally {
      setLoading(false);
    }
  }

  function applyDraft(nextDraft: RuleDraft) {
    setDraft(nextDraft);
    setRawText(stringifyDraft(nextDraft));
    setRawError('');
  }

  function startNewRule() {
    setSelectedRuleId(null);
    setSaveError('');
    setSuccessMessage('');
    setActiveTab('visual');
    applyDraft(createEmptyDraft());
  }

  function selectRule(rule: RuleRecord) {
    setSelectedRuleId(rule.id);
    setSaveError('');
    setSuccessMessage('');
    setActiveTab('visual');
    applyDraft(normalizeDraft(rule));
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Deactivate this approval rule?')) return;
    try {
      await api.approvalRules.remove(id);
      setSuccessMessage('Rule deactivated.');
      await load();
      if (selectedRuleId === id) startNewRule();
    } catch (error: any) {
      setSaveError(error.message || 'Unable to deactivate rule.');
    }
  }

  function updateDraftField<Key extends keyof RuleDraft>(key: Key, value: RuleDraft[Key]) {
    applyDraft({ ...draft, [key]: value });
  }

  function updateConditions(leaves: ConditionLeaf[], operator: 'AND' | 'OR') {
    applyDraft({ ...draft, conditions: buildConditionsFromVisual(operator, leaves) });
  }

  function updateStep(index: number, patch: Partial<RuleStep>) {
    const nextSteps = draft.steps
      .map((step, stepIndex) => {
        if (stepIndex !== index) return step;
        const nextStep = { ...step, ...patch };
        if (nextStep.approverType === 'role' && !nextStep.approverRole) nextStep.approverRole = 'approver';
        if (nextStep.approverType !== 'role') nextStep.approverRole = null;
        if (nextStep.approverType !== 'user') nextStep.approverId = null;
        return nextStep;
      })
      .map((step, stepIndex) => ({ ...step, stepOrder: stepIndex + 1 }));

    applyDraft({ ...draft, steps: nextSteps });
  }

  function insertStep(index: number) {
    const nextSteps = [...draft.steps];
    nextSteps.splice(index, 0, createDefaultStep(index + 1));
    applyDraft({
      ...draft,
      steps: nextSteps.map((step, stepIndex) => ({ ...step, stepOrder: stepIndex + 1 })),
    });
  }

  function removeStep(index: number) {
    if (draft.steps.length === 1) return;
    applyDraft({
      ...draft,
      steps: draft.steps
        .filter((_, stepIndex) => stepIndex !== index)
        .map((step, stepIndex) => ({ ...step, stepOrder: stepIndex + 1 })),
    });
  }

  function moveStep(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= draft.steps.length) return;
    const nextSteps = [...draft.steps];
    const [step] = nextSteps.splice(index, 1);
    nextSteps.splice(targetIndex, 0, step);
    applyDraft({
      ...draft,
      steps: nextSteps.map((item, stepIndex) => ({ ...item, stepOrder: stepIndex + 1 })),
    });
  }

  function handleRawChange(value: string) {
    setRawText(value);
    try {
      const parsed = JSON.parse(value);
      setDraft(normalizeDraft(parsed));
      setRawError('');
    } catch {
      setRawError('Raw JSON must be valid before you can save.');
    }
  }

  async function handleSave() {
    if (rawError) return;

    const payload = serializeDraft(draft);
    if (!payload.name) {
      setSaveError('Rule name is required.');
      return;
    }
    if (payload.steps.length === 0) {
      setSaveError('At least one approval step is required.');
      return;
    }

    setSaving(true);
    setSaveError('');
    setSuccessMessage('');

    try {
      const savedRule = selectedRuleId
        ? await api.approvalRules.update(selectedRuleId, payload)
        : await api.approvalRules.create(payload);

      setSuccessMessage(selectedRuleId ? 'Rule updated.' : 'Rule created.');
      await load();

      if (savedRule?.id) {
        setSelectedRuleId(savedRule.id);
        applyDraft(
          normalizeDraft({
            ...savedRule,
            conditions: parseStoredConditions(savedRule.conditions),
            steps: normalizeSteps(savedRule.steps),
          }),
        );
      }
    } catch (error: any) {
      setSaveError(error.message || 'Unable to save rule.');
    } finally {
      setSaving(false);
    }
  }

  async function runSimulation() {
    setSimulationLoading(true);
    try {
      const result = await api.approvalRules.simulate({
        requesterId: simulation.requesterId || undefined,
        departmentId: simulation.departmentId || undefined,
        projectId: simulation.projectId || undefined,
        totalAmount: Number(simulation.totalAmount || 0),
        currency: simulation.currency,
      });
      setSimulationResult(result);
    } catch (error: any) {
      setSaveError(error.message || 'Unable to run approval simulation.');
    } finally {
      setSimulationLoading(false);
    }
  }

  const visualConditions = getVisualConditionState(draft.conditions);

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Approval Workflow Builder"
        description="Build approval chains visually, keep a raw JSON escape hatch for advanced condition trees, and dry-run the saved rules against hypothetical requests."
        actions={
          <>
            <Button type="button" variant="outline" onClick={startNewRule}>
              <Plus className="h-4 w-4" />
              New Rule
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving || Boolean(rawError)}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : selectedRuleId ? 'Save Changes' : 'Create Rule'}
            </Button>
          </>
        }
      />

      {saveError ? (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}
      {successMessage ? (
        <Alert variant="success">
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)]">
        <Card className="sticky top-4 rounded-[28px] self-start">
          <CardHeader>
            <CardTitle className="text-xl">Saved rules</CardTitle>
            <CardDescription>Select a rule to edit or deactivate. The left rail stays focused on current production rules.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center text-sm text-muted-foreground">
                Loading approval rules...
              </div>
            ) : rules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center text-sm text-muted-foreground">
                No approval rules configured yet.
              </div>
            ) : (
              rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  users={users}
                  selected={selectedRuleId === rule.id}
                  onSelect={() => selectRule(rule)}
                  onDeactivate={() => handleDeactivate(rule.id)}
                />
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-[28px]">
            <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <CardTitle className="text-xl">
                  {selectedRuleId ? 'Editing existing rule' : 'Creating new rule'}
                </CardTitle>
                <CardDescription>
                  {draft.name || 'Untitled workflow'}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={activeTab === 'visual' ? 'default' : 'outline'} onClick={() => setActiveTab('visual')}>
                  <Workflow className="h-4 w-4" />
                  Visual Builder
                </Button>
                <Button type="button" size="sm" variant={activeTab === 'raw' ? 'default' : 'outline'} onClick={() => setActiveTab('raw')}>
                  <Braces className="h-4 w-4" />
                  Raw JSON
                </Button>
                <Button type="button" size="sm" variant={activeTab === 'simulator' ? 'default' : 'outline'} onClick={() => setActiveTab('simulator')}>
                  <FlaskConical className="h-4 w-4" />
                  Simulator
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
              <Field label="Rule name">
                <Input
                  value={draft.name}
                  onChange={(event) => updateDraftField('name', event.target.value)}
                  placeholder="High-value requisitions"
                />
              </Field>
              <Field label="Priority">
                <Input
                  type="number"
                  value={draft.priority}
                  onChange={(event) => updateDraftField('priority', Number(event.target.value))}
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Description">
                  <Textarea
                    rows={3}
                    value={draft.description}
                    onChange={(event) => updateDraftField('description', event.target.value)}
                    placeholder="Route requests over $1,000 through approver and finance."
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          {activeTab === 'simulator' ? (
            <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
              <Card className="rounded-[28px]">
                <CardHeader>
                  <CardTitle className="text-xl">Hypothetical request</CardTitle>
                  <CardDescription>Test the active rules without creating a real requisition.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <Field label="Total amount">
                    <Input
                      type="number"
                      value={simulation.totalAmount}
                      onChange={(event) => setSimulation((current) => ({ ...current, totalAmount: event.target.value }))}
                    />
                  </Field>
                  <Field label="Currency">
                    <Input
                      value={simulation.currency}
                      maxLength={3}
                      onChange={(event) =>
                        setSimulation((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                      }
                    />
                  </Field>
                  <Field label="Requester user ID">
                    <Input
                      list="approval-rule-user-ids"
                      value={simulation.requesterId}
                      onChange={(event) => setSimulation((current) => ({ ...current, requesterId: event.target.value }))}
                    />
                    <datalist id="approval-rule-user-ids">
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Department ID">
                    <Input
                      value={simulation.departmentId}
                      onChange={(event) => setSimulation((current) => ({ ...current, departmentId: event.target.value }))}
                    />
                  </Field>
                  <Field label="Project ID">
                    <Input
                      value={simulation.projectId}
                      onChange={(event) => setSimulation((current) => ({ ...current, projectId: event.target.value }))}
                    />
                  </Field>
                  <Button type="button" onClick={runSimulation} disabled={simulationLoading}>
                    {simulationLoading ? 'Running...' : 'Run Simulation'}
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-[28px]">
                <CardHeader>
                  <CardTitle className="text-xl">Approval chain preview</CardTitle>
                  <CardDescription>See which rules would match, in what order, and why.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {!simulationResult ? (
                    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center text-sm text-muted-foreground">
                      Run a simulation to see the resulting approval flow.
                    </div>
                  ) : (
                    <>
                      {simulationResult.unmatchedWarning ? (
                        <Alert variant="warning">
                          <AlertDescription>{simulationResult.unmatchedWarning}</AlertDescription>
                        </Alert>
                      ) : null}
                      {(simulationResult.steps ?? []).map((step: any) => (
                        <div key={`${step.ruleId}-${step.stepOrder}`} className="rounded-[22px] border border-border/70 bg-background/70 p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <div className="text-sm text-muted-foreground">Step {step.stepOrder}</div>
                              <div className="mt-1 font-semibold text-foreground">{step.ruleName}</div>
                            </div>
                            <Badge variant="outline">Priority {step.rulePriority}</Badge>
                          </div>
                          <div className="mt-3 text-sm text-muted-foreground">{step.conditionExplanation}</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(step.approvers ?? []).map((approver: any, index: number) => (
                              <Badge key={`${step.ruleId}-${step.stepOrder}-${index}`} variant="outline">
                                {approver.label}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {activeTab === 'raw' ? (
            <Card className="rounded-[28px]">
              <CardHeader>
                <CardTitle className="text-xl">Raw JSON</CardTitle>
                <CardDescription>Edit the full approval rule payload directly. Valid changes sync back into the visual builder.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Textarea
                  value={rawText}
                  onChange={(event) => handleRawChange(event.target.value)}
                  rows={26}
                  spellCheck={false}
                  className={`min-h-[34rem] font-mono text-[13px] ${rawError ? 'border-rose-300' : ''}`}
                />
                <div className={`text-sm ${rawError ? 'text-rose-700' : 'text-muted-foreground'}`}>
                  {rawError || 'Raw JSON is in sync with the current rule draft.'}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {activeTab === 'visual' ? (
            <div className="space-y-6">
              <Card className="rounded-[28px]">
                <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="text-xl">Rule conditions</CardTitle>
                    <CardDescription>Keep conditions simple here. Use raw JSON for nested condition trees.</CardDescription>
                  </div>
                  {visualConditions.supported ? (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">Match when</span>
                      <Select
                        value={visualConditions.operator}
                        onChange={(event) =>
                          updateConditions(visualConditions.leaves, event.target.value as 'AND' | 'OR')
                        }
                      >
                        <option value="AND">All conditions pass</option>
                        <option value="OR">Any condition passes</option>
                      </Select>
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent className="grid gap-4">
                  {!visualConditions.supported ? (
                    <Alert variant="warning">
                      <AlertDescription>
                        This rule uses a nested condition tree that the first-pass visual editor does not flatten safely. Use the raw JSON tab to edit it.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      {visualConditions.leaves.map((leaf, index) => (
                        <div key={`condition-${index}`} className="grid gap-4 rounded-[22px] border border-border/70 bg-background/70 p-4 md:grid-cols-[1fr_12rem_1fr_auto]">
                          <Field label="Field">
                            <Input
                              list={`approval-rule-fields-${index}`}
                              value={leaf.field}
                              onChange={(event) => {
                                const nextLeaves = visualConditions.leaves.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, field: event.target.value } : item,
                                );
                                updateConditions(nextLeaves, visualConditions.operator);
                              }}
                            />
                            <datalist id={`approval-rule-fields-${index}`}>
                              {FIELD_PRESETS.map((field) => (
                                <option key={field.value} value={field.value}>
                                  {field.label}
                                </option>
                              ))}
                            </datalist>
                          </Field>
                          <Field label="Operator">
                            <Select
                              value={leaf.operator}
                              onChange={(event) => {
                                const nextLeaves = visualConditions.leaves.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, operator: event.target.value } : item,
                                );
                                updateConditions(nextLeaves, visualConditions.operator);
                              }}
                            >
                              {COMPARISON_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Value">
                            <Input
                              value={leaf.value}
                              onChange={(event) => {
                                const nextLeaves = visualConditions.leaves.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, value: event.target.value } : item,
                                );
                                updateConditions(nextLeaves, visualConditions.operator);
                              }}
                              placeholder="1000"
                            />
                          </Field>
                          <div className="flex items-end">
                            <Button
                              type="button"
                              variant="outline"
                              className="border-rose-200 text-rose-700 hover:bg-rose-50"
                              disabled={visualConditions.leaves.length === 1}
                              onClick={() => {
                                const nextLeaves = visualConditions.leaves.filter((_, itemIndex) => itemIndex !== index);
                                updateConditions(nextLeaves, visualConditions.operator);
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            updateConditions(
                              [...visualConditions.leaves, { field: '', operator: '>=', value: '' }],
                              visualConditions.operator,
                            )
                          }
                        >
                          Add Condition
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-[28px]">
                <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="text-xl">Approval flow</CardTitle>
                    <CardDescription>Edit nodes directly and insert steps without dropping into JSON.</CardDescription>
                  </div>
                  <Button type="button" variant="outline" onClick={() => insertStep(draft.steps.length)}>
                    <GitBranchPlus className="h-4 w-4" />
                    Add Terminal Step
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto pb-2">
                    <div className="flex min-w-fit items-stretch gap-3">
                      <div className="flex min-w-[10rem] flex-col items-center justify-center rounded-[24px] border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Start</div>
                        <div className="mt-2 font-semibold text-foreground">Request Submitted</div>
                      </div>

                      {draft.steps.map((step, index) => (
                        <div key={`step-${index}`} className="flex items-center gap-3">
                          <Card className="min-w-[19rem] max-w-[19rem] rounded-[24px]">
                            <CardContent className="grid gap-4 p-5">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Node {index + 1}
                                  </div>
                                  <div className="mt-1 font-semibold text-foreground">Approval step {index + 1}</div>
                                </div>
                                <div className="flex gap-2">
                                  <Button type="button" size="icon" variant="outline" disabled={index === 0} onClick={() => moveStep(index, -1)}>
                                    <ArrowLeft className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    disabled={index === draft.steps.length - 1}
                                    onClick={() => moveStep(index, 1)}
                                  >
                                    <ArrowRight className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              <Field label="Approver type">
                                <Select
                                  value={step.approverType}
                                  onChange={(event) => updateStep(index, { approverType: event.target.value })}
                                >
                                  {APPROVER_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </Select>
                              </Field>

                              {step.approverType === 'role' ? (
                                <Field label="Role">
                                  <Select
                                    value={step.approverRole || 'approver'}
                                    onChange={(event) => updateStep(index, { approverRole: event.target.value })}
                                  >
                                    {ROLE_OPTIONS.map((role) => (
                                      <option key={role} value={role}>
                                        {role}
                                      </option>
                                    ))}
                                  </Select>
                                </Field>
                              ) : null}

                              {step.approverType === 'user' ? (
                                <Field label="User">
                                  <Select
                                    value={step.approverId || ''}
                                    onChange={(event) => updateStep(index, { approverId: event.target.value || null })}
                                  >
                                    <option value="">Select a user</option>
                                    {users.map((user) => (
                                      <option key={user.id} value={user.id}>
                                        {user.name} ({user.email})
                                      </option>
                                    ))}
                                  </Select>
                                </Field>
                              ) : null}

                              <Field label="Required approvals">
                                <Input
                                  type="number"
                                  min={1}
                                  value={step.requiredCount}
                                  onChange={(event) =>
                                    updateStep(index, { requiredCount: Math.max(1, Number(event.target.value || 1)) })
                                  }
                                />
                              </Field>

                              <div className="flex items-center justify-between gap-3">
                                <Badge variant="outline">{formatStepSummary(step, users)}</Badge>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                  disabled={draft.steps.length === 1}
                                  onClick={() => removeStep(index)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </Button>
                              </div>
                            </CardContent>
                          </Card>

                          {index < draft.steps.length - 1 ? (
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <div className="text-xl">→</div>
                              <Button type="button" size="sm" variant="outline" onClick={() => insertStep(index + 1)}>
                                + Insert
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))}

                      <div className="flex min-w-[10rem] flex-col items-center justify-center rounded-[24px] border border-dashed border-emerald-300 bg-emerald-50 px-4 py-8 text-center">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">End</div>
                        <div className="mt-2 font-semibold text-emerald-800">Entity Approved</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-[28px]">
                <CardHeader>
                  <CardTitle className="text-xl">Serialized preview</CardTitle>
                  <CardDescription>The visual builder writes back to the current backend structure: `conditions` JSON plus ordered `steps`.</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto rounded-[22px] bg-slate-950 p-5 text-[13px] text-slate-200">
                    {stringifyDraft(draft)}
                  </pre>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
