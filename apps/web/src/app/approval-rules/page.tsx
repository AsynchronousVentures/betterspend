'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { COLORS, FONT, SHADOWS } from '../../lib/theme';

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
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

function normalizeSteps(input: unknown): RuleStep[] {
  if (!Array.isArray(input) || input.length === 0) return [createDefaultStep(1)];

  return input.map((step, index) => {
    const record =
      typeof step === 'object' && step !== null ? (step as Record<string, unknown>) : {};
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
  const record =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
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

function isSimpleConditionNode(
  node: unknown,
): node is { field: string; operator: string; value: unknown } {
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
      leaves: [
        {
          field: condition.field,
          operator: condition.operator,
          value: valueToInput(condition.value),
        },
      ],
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

function buildConditionsFromVisual(
  operator: 'AND' | 'OR',
  leaves: ConditionLeaf[],
): Record<string, unknown> {
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
  return (
    APPROVER_TYPE_OPTIONS.find((option) => option.value === step.approverType)?.label ||
    step.approverType
  );
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
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '1rem',
        borderRadius: '12px',
        border: `1px solid ${selected ? COLORS.accentBlue : COLORS.border}`,
        background: selected ? COLORS.accentBlueLight : COLORS.cardBg,
        boxShadow: SHADOWS.card,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '0.75rem',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, color: COLORS.textPrimary }}>{rule.name}</div>
          <div style={{ marginTop: '0.3rem', fontSize: FONT.sm, color: COLORS.textSecondary }}>
            Priority {rule.priority} · {rule.steps.length} step{rule.steps.length === 1 ? '' : 's'}
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: FONT.sm, color: COLORS.textSecondary }}>
            {describeCondition(rule.conditions)}
          </div>
          <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {rule.steps.slice(0, 3).map((step) => (
              <span
                key={`${rule.id}-${step.stepOrder}`}
                style={{
                  padding: '0.2rem 0.45rem',
                  borderRadius: '999px',
                  background: COLORS.white,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: FONT.xs,
                  color: COLORS.textSecondary,
                }}
              >
                {formatStepSummary(step, users)}
              </span>
            ))}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
            alignItems: 'flex-end',
          }}
        >
          <span
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '999px',
              fontSize: FONT.xs,
              background: rule.isActive ? COLORS.accentGreenLight : COLORS.accentRedLight,
              color: rule.isActive ? COLORS.accentGreenDark : COLORS.accentRedDark,
            }}
          >
            {rule.isActive ? 'Active' : 'Inactive'}
          </span>
          {rule.isActive && (
            <span
              onClick={(event) => {
                event.stopPropagation();
                onDeactivate();
              }}
              style={{
                fontSize: FONT.xs,
                color: COLORS.accentRedDark,
                textDecoration: 'underline',
              }}
            >
              Deactivate
            </span>
          )}
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
    load();
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
    const nextDraft = { ...draft, [key]: value };
    applyDraft(nextDraft);
  }

  function updateConditions(leaves: ConditionLeaf[], operator: 'AND' | 'OR') {
    const nextDraft = {
      ...draft,
      conditions: buildConditionsFromVisual(operator, leaves),
    };
    applyDraft(nextDraft);
  }

  function updateStep(index: number, patch: Partial<RuleStep>) {
    const nextSteps = draft.steps
      .map((step, stepIndex) => {
        if (stepIndex !== index) return step;
        const nextStep = { ...step, ...patch };
        if (nextStep.approverType === 'role' && !nextStep.approverRole)
          nextStep.approverRole = 'approver';
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
    <div style={{ padding: '2rem', background: COLORS.contentBg, minHeight: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          alignItems: 'flex-start',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: FONT.xxl, color: COLORS.textPrimary }}>
            Approval Workflow Builder
          </h1>
          <p
            style={{
              margin: '0.45rem 0 0',
              maxWidth: '48rem',
              color: COLORS.textSecondary,
              fontSize: FONT.base,
            }}
          >
            Build approval chains visually, keep a raw JSON escape hatch for advanced conditions,
            and save back to the existing approval rule engine.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={startNewRule}
            style={{
              padding: '0.7rem 1rem',
              borderRadius: '10px',
              border: `1px solid ${COLORS.border}`,
              background: COLORS.cardBg,
              color: COLORS.textPrimary,
              cursor: 'pointer',
            }}
          >
            New rule
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || Boolean(rawError)}
            style={{
              padding: '0.7rem 1rem',
              borderRadius: '10px',
              border: 'none',
              background: saving || rawError ? COLORS.textMuted : COLORS.accentBlue,
              color: COLORS.white,
              cursor: saving || rawError ? 'not-allowed' : 'pointer',
              boxShadow: SHADOWS.card,
              fontWeight: 700,
            }}
          >
            {saving ? 'Saving...' : selectedRuleId ? 'Save changes' : 'Create rule'}
          </button>
        </div>
      </div>

      {(saveError || successMessage) && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.85rem 1rem',
            borderRadius: '12px',
            border: `1px solid ${saveError ? '#fecaca' : '#bbf7d0'}`,
            background: saveError ? COLORS.accentRedLight : COLORS.accentGreenLight,
            color: saveError ? COLORS.accentRedDark : COLORS.accentGreenDark,
          }}
        >
          {saveError || successMessage}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(18rem, 24rem) minmax(0, 1fr)',
          gap: '1.25rem',
          alignItems: 'start',
        }}
      >
        <section
          style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '16px',
            padding: '1rem',
            boxShadow: SHADOWS.card,
            position: 'sticky',
            top: '1rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.85rem',
            }}
          >
            <h2 style={{ margin: 0, fontSize: FONT.lg, color: COLORS.textPrimary }}>Saved rules</h2>
            <span style={{ fontSize: FONT.sm, color: COLORS.textSecondary }}>{rules.length}</span>
          </div>
          {loading ? (
            <p style={{ margin: 0, color: COLORS.textSecondary }}>Loading approval rules...</p>
          ) : rules.length === 0 ? (
            <div
              style={{
                padding: '2rem 1rem',
                textAlign: 'center',
                color: COLORS.textMuted,
                border: `1px dashed ${COLORS.border}`,
                borderRadius: '12px',
              }}
            >
              No approval rules configured yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  users={users}
                  selected={selectedRuleId === rule.id}
                  onSelect={() => selectRule(rule)}
                  onDeactivate={() => handleDeactivate(rule.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section
          style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '16px',
            padding: '1.25rem',
            boxShadow: SHADOWS.card,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              alignItems: 'flex-start',
              marginBottom: '1.25rem',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: FONT.sm, color: COLORS.textSecondary }}>
                {selectedRuleId ? 'Editing existing rule' : 'Creating new rule'}
              </div>
              <h2 style={{ margin: '0.25rem 0 0', fontSize: FONT.xl, color: COLORS.textPrimary }}>
                {draft.name || 'Untitled workflow'}
              </h2>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                background: COLORS.contentBg,
                padding: '0.25rem',
                borderRadius: '999px',
              }}
            >
              {(['visual', 'raw', 'simulator'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: '999px',
                    border: 'none',
                    background: activeTab === tab ? COLORS.cardBg : 'transparent',
                    color: activeTab === tab ? COLORS.textPrimary : COLORS.textSecondary,
                    boxShadow: activeTab === tab ? SHADOWS.card : 'none',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {tab === 'visual'
                    ? 'Visual builder'
                    : tab === 'raw'
                      ? 'Raw JSON'
                      : 'Simulator'}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 12rem',
              gap: '1rem',
              marginBottom: '1.25rem',
            }}
          >
            <div>
              <label
                style={{
                  display: 'block',
                  marginBottom: '0.35rem',
                  fontSize: FONT.sm,
                  fontWeight: 600,
                  color: COLORS.textSecondary,
                }}
              >
                Rule name
              </label>
              <input
                value={draft.name}
                onChange={(event) => updateDraftField('name', event.target.value)}
                placeholder="High-value requisitions"
                style={{
                  width: '100%',
                  padding: '0.75rem 0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${COLORS.inputBorder}`,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: 'block',
                  marginBottom: '0.35rem',
                  fontSize: FONT.sm,
                  fontWeight: 600,
                  color: COLORS.textSecondary,
                }}
              >
                Priority
              </label>
              <input
                type="number"
                value={draft.priority}
                onChange={(event) => updateDraftField('priority', Number(event.target.value))}
                style={{
                  width: '100%',
                  padding: '0.75rem 0.85rem',
                  borderRadius: '10px',
                  border: `1px solid ${COLORS.inputBorder}`,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '0.35rem',
                fontSize: FONT.sm,
                fontWeight: 600,
                color: COLORS.textSecondary,
              }}
            >
              Description
            </label>
            <textarea
              value={draft.description}
              onChange={(event) => updateDraftField('description', event.target.value)}
              rows={3}
              placeholder="Route requests over $1,000 through approver and finance."
              style={{
                width: '100%',
                padding: '0.75rem 0.85rem',
                borderRadius: '10px',
                border: `1px solid ${COLORS.inputBorder}`,
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
          </div>

          {activeTab === 'simulator' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(18rem, 22rem) minmax(0, 1fr)', gap: '1rem' }}>
              <div
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '14px',
                  padding: '1rem',
                  background: COLORS.contentBg,
                }}
              >
                <h3 style={{ margin: 0, fontSize: FONT.lg, color: COLORS.textPrimary }}>Hypothetical request</h3>
                <div style={{ marginTop: '0.35rem', color: COLORS.textSecondary, fontSize: FONT.sm }}>
                  Test the currently active rules without creating a real requisition.
                </div>
                <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
                  <input
                    value={simulation.totalAmount}
                    onChange={(event) => setSimulation((current) => ({ ...current, totalAmount: event.target.value }))}
                    placeholder="Total amount"
                    type="number"
                    style={{ width: '100%', padding: '0.75rem 0.85rem', borderRadius: '10px', border: `1px solid ${COLORS.inputBorder}`, boxSizing: 'border-box' }}
                  />
                  <input
                    value={simulation.currency}
                    onChange={(event) => setSimulation((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
                    placeholder="Currency"
                    maxLength={3}
                    style={{ width: '100%', padding: '0.75rem 0.85rem', borderRadius: '10px', border: `1px solid ${COLORS.inputBorder}`, boxSizing: 'border-box' }}
                  />
                  <input
                    value={simulation.requesterId}
                    onChange={(event) => setSimulation((current) => ({ ...current, requesterId: event.target.value }))}
                    placeholder="Requester user ID"
                    list="approval-rule-user-ids"
                    style={{ width: '100%', padding: '0.75rem 0.85rem', borderRadius: '10px', border: `1px solid ${COLORS.inputBorder}`, boxSizing: 'border-box' }}
                  />
                  <datalist id="approval-rule-user-ids">
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                  </datalist>
                  <input
                    value={simulation.departmentId}
                    onChange={(event) => setSimulation((current) => ({ ...current, departmentId: event.target.value }))}
                    placeholder="Department ID"
                    style={{ width: '100%', padding: '0.75rem 0.85rem', borderRadius: '10px', border: `1px solid ${COLORS.inputBorder}`, boxSizing: 'border-box' }}
                  />
                  <input
                    value={simulation.projectId}
                    onChange={(event) => setSimulation((current) => ({ ...current, projectId: event.target.value }))}
                    placeholder="Project ID"
                    style={{ width: '100%', padding: '0.75rem 0.85rem', borderRadius: '10px', border: `1px solid ${COLORS.inputBorder}`, boxSizing: 'border-box' }}
                  />
                  <button
                    type="button"
                    onClick={runSimulation}
                    disabled={simulationLoading}
                    style={{
                      padding: '0.8rem 1rem',
                      borderRadius: '10px',
                      border: 'none',
                      background: simulationLoading ? COLORS.textMuted : COLORS.accentBlue,
                      color: COLORS.white,
                      cursor: simulationLoading ? 'not-allowed' : 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    {simulationLoading ? 'Running...' : 'Run simulation'}
                  </button>
                </div>
              </div>

              <div
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '14px',
                  padding: '1rem',
                  background: COLORS.contentBg,
                }}
              >
                <h3 style={{ margin: 0, fontSize: FONT.lg, color: COLORS.textPrimary }}>Approval chain preview</h3>
                <div style={{ marginTop: '0.35rem', color: COLORS.textSecondary, fontSize: FONT.sm }}>
                  Review which rules would match, in what order, and why.
                </div>
                {!simulationResult ? (
                  <div style={{ marginTop: '1rem', padding: '1rem', borderRadius: '12px', border: `1px dashed ${COLORS.border}`, color: COLORS.textMuted }}>
                    Run a simulation to see the resulting approval flow.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '0.85rem', marginTop: '1rem' }}>
                    {simulationResult.unmatchedWarning && (
                      <div style={{ padding: '1rem', borderRadius: '12px', background: COLORS.accentAmberLight, color: COLORS.accentAmberDark }}>
                        {simulationResult.unmatchedWarning}
                      </div>
                    )}
                    {simulationResult.steps?.map((step: any) => (
                      <div
                        key={`${step.ruleId}-${step.stepOrder}`}
                        style={{
                          border: `1px solid ${COLORS.border}`,
                          borderRadius: '12px',
                          padding: '1rem',
                          background: COLORS.cardBg,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: FONT.sm, color: COLORS.textSecondary }}>Step {step.stepOrder}</div>
                            <div style={{ marginTop: '0.2rem', fontWeight: 700, color: COLORS.textPrimary }}>{step.ruleName}</div>
                          </div>
                          <span style={{ fontSize: FONT.xs, color: COLORS.textSecondary }}>Priority {step.rulePriority}</span>
                        </div>
                        <div style={{ marginTop: '0.6rem', fontSize: FONT.sm, color: COLORS.textSecondary }}>
                          {step.conditionExplanation}
                        </div>
                        <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          {step.approvers?.map((approver: any, index: number) => (
                            <span
                              key={`${step.ruleId}-${step.stepOrder}-${index}`}
                              style={{
                                padding: '0.25rem 0.5rem',
                                borderRadius: '999px',
                                border: `1px solid ${COLORS.border}`,
                                fontSize: FONT.xs,
                                color: COLORS.textSecondary,
                                background: COLORS.white,
                              }}
                            >
                              {approver.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'raw' ? (
            <div>
              <div
                style={{ marginBottom: '0.6rem', color: COLORS.textSecondary, fontSize: FONT.sm }}
              >
                Edit the full approval rule payload directly. Changes here sync back into the visual
                builder when valid.
              </div>
              <textarea
                value={rawText}
                onChange={(event) => handleRawChange(event.target.value)}
                rows={26}
                spellCheck={false}
                style={{
                  width: '100%',
                  padding: '1rem',
                  borderRadius: '14px',
                  border: `1px solid ${rawError ? '#fca5a5' : COLORS.inputBorder}`,
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                  background: '#0f172a',
                  color: '#e2e8f0',
                }}
              />
              <div
                style={{
                  marginTop: '0.6rem',
                  color: rawError ? COLORS.accentRedDark : COLORS.textSecondary,
                  fontSize: FONT.sm,
                }}
              >
                {rawError || 'Raw JSON is in sync with the current rule draft.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '14px',
                  padding: '1rem',
                  background: COLORS.contentBg,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    alignItems: 'center',
                    marginBottom: '1rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0, fontSize: FONT.lg, color: COLORS.textPrimary }}>
                      Rule conditions
                    </h3>
                    <div
                      style={{
                        marginTop: '0.3rem',
                        color: COLORS.textSecondary,
                        fontSize: FONT.sm,
                      }}
                    >
                      Keep conditions simple here. Switch to raw JSON for nested condition trees.
                    </div>
                  </div>
                  {visualConditions.supported && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: FONT.sm, color: COLORS.textSecondary }}>
                        Match when
                      </span>
                      <select
                        value={visualConditions.operator}
                        onChange={(event) =>
                          updateConditions(
                            visualConditions.leaves,
                            event.target.value as 'AND' | 'OR',
                          )
                        }
                        style={{
                          padding: '0.45rem 0.65rem',
                          borderRadius: '8px',
                          border: `1px solid ${COLORS.inputBorder}`,
                        }}
                      >
                        <option value="AND">All conditions pass</option>
                        <option value="OR">Any condition passes</option>
                      </select>
                    </div>
                  )}
                </div>

                {!visualConditions.supported ? (
                  <div
                    style={{
                      padding: '1rem',
                      borderRadius: '12px',
                      background: COLORS.accentAmberLight,
                      color: COLORS.accentAmberDark,
                    }}
                  >
                    This rule uses a nested condition tree that the first-pass visual editor does
                    not flatten safely. Use the raw JSON tab to edit it.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {visualConditions.leaves.map((leaf, index) => (
                      <div
                        key={`condition-${index}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns:
                            'minmax(9rem, 1fr) minmax(10rem, 12rem) minmax(10rem, 1fr) auto',
                          gap: '0.75rem',
                          alignItems: 'center',
                          padding: '0.9rem',
                          borderRadius: '12px',
                          border: `1px solid ${COLORS.border}`,
                          background: COLORS.cardBg,
                        }}
                      >
                        <div>
                          <label
                            style={{
                              display: 'block',
                              marginBottom: '0.25rem',
                              fontSize: FONT.xs,
                              color: COLORS.textSecondary,
                            }}
                          >
                            Field
                          </label>
                          <input
                            list={`approval-rule-fields-${index}`}
                            value={leaf.field}
                            onChange={(event) => {
                              const nextLeaves = visualConditions.leaves.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, field: event.target.value } : item,
                              );
                              updateConditions(nextLeaves, visualConditions.operator);
                            }}
                            style={{
                              width: '100%',
                              padding: '0.65rem',
                              borderRadius: '8px',
                              border: `1px solid ${COLORS.inputBorder}`,
                              boxSizing: 'border-box',
                            }}
                          />
                          <datalist id={`approval-rule-fields-${index}`}>
                            {FIELD_PRESETS.map((field) => (
                              <option key={field.value} value={field.value}>
                                {field.label}
                              </option>
                            ))}
                          </datalist>
                        </div>
                        <div>
                          <label
                            style={{
                              display: 'block',
                              marginBottom: '0.25rem',
                              fontSize: FONT.xs,
                              color: COLORS.textSecondary,
                            }}
                          >
                            Operator
                          </label>
                          <select
                            value={leaf.operator}
                            onChange={(event) => {
                              const nextLeaves = visualConditions.leaves.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, operator: event.target.value }
                                  : item,
                              );
                              updateConditions(nextLeaves, visualConditions.operator);
                            }}
                            style={{
                              width: '100%',
                              padding: '0.65rem',
                              borderRadius: '8px',
                              border: `1px solid ${COLORS.inputBorder}`,
                            }}
                          >
                            {COMPARISON_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label
                            style={{
                              display: 'block',
                              marginBottom: '0.25rem',
                              fontSize: FONT.xs,
                              color: COLORS.textSecondary,
                            }}
                          >
                            Value
                          </label>
                          <input
                            value={leaf.value}
                            onChange={(event) => {
                              const nextLeaves = visualConditions.leaves.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, value: event.target.value } : item,
                              );
                              updateConditions(nextLeaves, visualConditions.operator);
                            }}
                            placeholder="1000"
                            style={{
                              width: '100%',
                              padding: '0.65rem',
                              borderRadius: '8px',
                              border: `1px solid ${COLORS.inputBorder}`,
                              boxSizing: 'border-box',
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const nextLeaves = visualConditions.leaves.filter(
                              (_, itemIndex) => itemIndex !== index,
                            );
                            updateConditions(nextLeaves, visualConditions.operator);
                          }}
                          disabled={visualConditions.leaves.length === 1}
                          style={{
                            marginTop: '1rem',
                            padding: '0.65rem 0.75rem',
                            borderRadius: '8px',
                            border: 'none',
                            background:
                              visualConditions.leaves.length === 1
                                ? COLORS.tableBorder
                                : COLORS.accentRedLight,
                            color:
                              visualConditions.leaves.length === 1
                                ? COLORS.textMuted
                                : COLORS.accentRedDark,
                            cursor:
                              visualConditions.leaves.length === 1 ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          updateConditions(
                            [...visualConditions.leaves, { field: '', operator: '>=', value: '' }],
                            visualConditions.operator,
                          )
                        }
                        style={{
                          padding: '0.65rem 0.85rem',
                          borderRadius: '8px',
                          border: `1px solid ${COLORS.border}`,
                          background: COLORS.cardBg,
                          cursor: 'pointer',
                        }}
                      >
                        Add condition
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '14px',
                  padding: '1rem',
                  background: COLORS.contentBg,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    alignItems: 'center',
                    marginBottom: '1rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0, fontSize: FONT.lg, color: COLORS.textPrimary }}>
                      Approval flow
                    </h3>
                    <div
                      style={{
                        marginTop: '0.3rem',
                        color: COLORS.textSecondary,
                        fontSize: FONT.sm,
                      }}
                    >
                      Edit nodes directly and use the connectors to insert steps without dropping
                      into JSON.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => insertStep(draft.steps.length)}
                    style={{
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: `1px solid ${COLORS.border}`,
                      background: COLORS.cardBg,
                      cursor: 'pointer',
                    }}
                  >
                    Add terminal step
                  </button>
                </div>

                <div style={{ overflowX: 'auto', paddingBottom: '0.5rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'stretch',
                      gap: '0.75rem',
                      minWidth: 'fit-content',
                    }}
                  >
                    <div
                      style={{
                        minWidth: '10rem',
                        padding: '1rem',
                        borderRadius: '16px',
                        background: COLORS.cardBg,
                        border: `1px dashed ${COLORS.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        color: COLORS.textSecondary,
                      }}
                    >
                      <div
                        style={{
                          fontSize: FONT.xs,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                        }}
                      >
                        Start
                      </div>
                      <div style={{ marginTop: '0.35rem', fontWeight: 700 }}>Request submitted</div>
                    </div>

                    {draft.steps.map((step, index) => (
                      <div
                        key={`step-${index}`}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
                      >
                        <div
                          style={{
                            minWidth: '19rem',
                            maxWidth: '19rem',
                            padding: '1rem',
                            borderRadius: '16px',
                            background: COLORS.cardBg,
                            border: `1px solid ${COLORS.border}`,
                            boxShadow: SHADOWS.card,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '0.85rem',
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontSize: FONT.xs,
                                  color: COLORS.textSecondary,
                                  letterSpacing: '0.08em',
                                  textTransform: 'uppercase',
                                }}
                              >
                                Node {index + 1}
                              </div>
                              <div
                                style={{
                                  marginTop: '0.2rem',
                                  fontWeight: 700,
                                  color: COLORS.textPrimary,
                                }}
                              >
                                Approval step {index + 1}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.35rem' }}>
                              <button
                                type="button"
                                onClick={() => moveStep(index, -1)}
                                disabled={index === 0}
                                style={{
                                  padding: '0.35rem 0.55rem',
                                  borderRadius: '8px',
                                  border: `1px solid ${COLORS.border}`,
                                  background: COLORS.cardBg,
                                  cursor: index === 0 ? 'not-allowed' : 'pointer',
                                }}
                              >
                                ←
                              </button>
                              <button
                                type="button"
                                onClick={() => moveStep(index, 1)}
                                disabled={index === draft.steps.length - 1}
                                style={{
                                  padding: '0.35rem 0.55rem',
                                  borderRadius: '8px',
                                  border: `1px solid ${COLORS.border}`,
                                  background: COLORS.cardBg,
                                  cursor:
                                    index === draft.steps.length - 1 ? 'not-allowed' : 'pointer',
                                }}
                              >
                                →
                              </button>
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div>
                              <label
                                style={{
                                  display: 'block',
                                  marginBottom: '0.25rem',
                                  fontSize: FONT.xs,
                                  color: COLORS.textSecondary,
                                }}
                              >
                                Approver type
                              </label>
                              <select
                                value={step.approverType}
                                onChange={(event) =>
                                  updateStep(index, { approverType: event.target.value })
                                }
                                style={{
                                  width: '100%',
                                  padding: '0.65rem',
                                  borderRadius: '8px',
                                  border: `1px solid ${COLORS.inputBorder}`,
                                }}
                              >
                                {APPROVER_TYPE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {step.approverType === 'role' && (
                              <div>
                                <label
                                  style={{
                                    display: 'block',
                                    marginBottom: '0.25rem',
                                    fontSize: FONT.xs,
                                    color: COLORS.textSecondary,
                                  }}
                                >
                                  Role
                                </label>
                                <select
                                  value={step.approverRole || 'approver'}
                                  onChange={(event) =>
                                    updateStep(index, { approverRole: event.target.value })
                                  }
                                  style={{
                                    width: '100%',
                                    padding: '0.65rem',
                                    borderRadius: '8px',
                                    border: `1px solid ${COLORS.inputBorder}`,
                                  }}
                                >
                                  {ROLE_OPTIONS.map((role) => (
                                    <option key={role} value={role}>
                                      {role}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {step.approverType === 'user' && (
                              <div>
                                <label
                                  style={{
                                    display: 'block',
                                    marginBottom: '0.25rem',
                                    fontSize: FONT.xs,
                                    color: COLORS.textSecondary,
                                  }}
                                >
                                  User
                                </label>
                                <select
                                  value={step.approverId || ''}
                                  onChange={(event) =>
                                    updateStep(index, { approverId: event.target.value || null })
                                  }
                                  style={{
                                    width: '100%',
                                    padding: '0.65rem',
                                    borderRadius: '8px',
                                    border: `1px solid ${COLORS.inputBorder}`,
                                  }}
                                >
                                  <option value="">Select a user</option>
                                  {users.map((user) => (
                                    <option key={user.id} value={user.id}>
                                      {user.name} ({user.email})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            <div>
                              <label
                                style={{
                                  display: 'block',
                                  marginBottom: '0.25rem',
                                  fontSize: FONT.xs,
                                  color: COLORS.textSecondary,
                                }}
                              >
                                Required approvals
                              </label>
                              <input
                                type="number"
                                min={1}
                                value={step.requiredCount}
                                onChange={(event) =>
                                  updateStep(index, {
                                    requiredCount: Math.max(1, Number(event.target.value || 1)),
                                  })
                                }
                                style={{
                                  width: '100%',
                                  padding: '0.65rem',
                                  borderRadius: '8px',
                                  border: `1px solid ${COLORS.inputBorder}`,
                                  boxSizing: 'border-box',
                                }}
                              />
                            </div>

                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: '0.75rem',
                                alignItems: 'center',
                              }}
                            >
                              <span style={{ fontSize: FONT.sm, color: COLORS.textSecondary }}>
                                {formatStepSummary(step, users)}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeStep(index)}
                                disabled={draft.steps.length === 1}
                                style={{
                                  padding: '0.5rem 0.7rem',
                                  borderRadius: '8px',
                                  border: 'none',
                                  background:
                                    draft.steps.length === 1
                                      ? COLORS.tableBorder
                                      : COLORS.accentRedLight,
                                  color:
                                    draft.steps.length === 1
                                      ? COLORS.textMuted
                                      : COLORS.accentRedDark,
                                  cursor: draft.steps.length === 1 ? 'not-allowed' : 'pointer',
                                }}
                              >
                                Delete node
                              </button>
                            </div>
                          </div>
                        </div>

                        {index < draft.steps.length - 1 && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: '0.5rem',
                              color: COLORS.textSecondary,
                            }}
                          >
                            <div style={{ fontSize: '1.2rem' }}>→</div>
                            <button
                              type="button"
                              onClick={() => insertStep(index + 1)}
                              style={{
                                padding: '0.45rem 0.65rem',
                                borderRadius: '999px',
                                border: `1px solid ${COLORS.border}`,
                                background: COLORS.cardBg,
                                cursor: 'pointer',
                                fontSize: FONT.sm,
                              }}
                            >
                              + Insert
                            </button>
                          </div>
                        )}
                      </div>
                    ))}

                    <div
                      style={{
                        minWidth: '10rem',
                        padding: '1rem',
                        borderRadius: '16px',
                        background: COLORS.accentGreenLight,
                        border: `1px dashed #86efac`,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        color: COLORS.accentGreenDark,
                      }}
                    >
                      <div
                        style={{
                          fontSize: FONT.xs,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                        }}
                      >
                        End
                      </div>
                      <div style={{ marginTop: '0.35rem', fontWeight: 700 }}>Entity approved</div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '14px',
                  padding: '1rem',
                  background: COLORS.cardBg,
                }}
              >
                <h3 style={{ margin: 0, fontSize: FONT.lg, color: COLORS.textPrimary }}>
                  Serialized preview
                </h3>
                <div
                  style={{ marginTop: '0.35rem', color: COLORS.textSecondary, fontSize: FONT.sm }}
                >
                  The visual builder writes back to the current backend structure: `conditions` JSON
                  plus ordered `steps`.
                </div>
                <pre
                  style={{
                    marginTop: '0.85rem',
                    marginBottom: 0,
                    padding: '1rem',
                    borderRadius: '12px',
                    background: '#0f172a',
                    color: '#e2e8f0',
                    fontSize: '0.8rem',
                    overflowX: 'auto',
                  }}
                >
                  {stringifyDraft(draft)}
                </pre>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
