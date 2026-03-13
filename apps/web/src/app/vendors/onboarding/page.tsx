'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { COLORS, SHADOWS } from '../../../lib/theme';

type DraftQuestion = {
  id: string;
  label: string;
  type: 'short_text' | 'long_text' | 'yes_no' | 'date';
  required: boolean;
  riskPointsIfNegative?: number;
};

const cardStyle: React.CSSProperties = {
  background: COLORS.cardBg,
  border: `1px solid ${COLORS.tableBorder}`,
  borderRadius: '10px',
  boxShadow: SHADOWS.card,
};

function riskPill(level: string) {
  if (level === 'high') return { bg: '#fef2f2', text: '#b91c1c' };
  if (level === 'medium') return { bg: '#fffbeb', text: '#b45309' };
  return { bg: '#ecfdf5', text: '#047857' };
}

export default function VendorOnboardingPage() {
  const [queue, setQueue] = useState<any[]>([]);
  const [questionnaires, setQuestionnaires] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [questionnaireName, setQuestionnaireName] = useState('Default Supplier Onboarding');
  const [makeDefault, setMakeDefault] = useState(true);
  const [questions, setQuestions] = useState<DraftQuestion[]>([
    { id: 'tax_registered', label: 'Are you tax registered in your operating jurisdiction?', type: 'yes_no', required: true, riskPointsIfNegative: 30 },
    { id: 'sanctions_program', label: 'Do you maintain sanctions and denied-party screening controls?', type: 'yes_no', required: true, riskPointsIfNegative: 35 },
  ]);

  async function load() {
    setLoading(true);
    try {
      const [queueData, questionnaireData] = await Promise.all([
        api.vendors.onboardingQueue(),
        api.vendors.onboardingQuestionnaires(),
      ]);
      setQueue(queueData);
      setQuestionnaires(questionnaireData);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreateQuestionnaire() {
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: '2rem', display: 'grid', gap: '1.25rem' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: COLORS.textPrimary }}>Vendor Onboarding</h1>
        <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: COLORS.textSecondary }}>
          Review onboarding submissions, risk levels, and the questionnaire template used in the vendor portal.
        </p>
      </div>

      <div style={{ ...cardStyle, padding: '1rem' }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: COLORS.textPrimary, marginBottom: '0.85rem' }}>
          Questionnaire Builder
        </div>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <input
            value={questionnaireName}
            onChange={(event) => setQuestionnaireName(event.target.value)}
            placeholder="Questionnaire name"
            style={{ width: '100%', padding: '0.65rem 0.8rem', borderRadius: '8px', border: `1px solid ${COLORS.inputBorder}`, boxSizing: 'border-box' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: COLORS.textSecondary }}>
            <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
            Make this the default supplier onboarding questionnaire
          </label>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {questions.map((question, index) => (
              <div key={question.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: '8px', padding: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                <input
                  value={question.label}
                  onChange={(event) => setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))}
                  placeholder="Question label"
                  style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: '8px', border: `1px solid ${COLORS.inputBorder}`, boxSizing: 'border-box' }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.5rem' }}>
                  <select
                    value={question.type}
                    onChange={(event) => setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as DraftQuestion['type'] } : item))}
                    style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: `1px solid ${COLORS.inputBorder}` }}
                  >
                    <option value="short_text">Short text</option>
                    <option value="long_text">Long text</option>
                    <option value="yes_no">Yes / No</option>
                    <option value="date">Date</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    value={question.riskPointsIfNegative ?? 0}
                    onChange={(event) => setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, riskPointsIfNegative: Number(event.target.value) } : item))}
                    placeholder="Risk points"
                    style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: `1px solid ${COLORS.inputBorder}` }}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: COLORS.textSecondary }}>
                    <input
                      type="checkbox"
                      checked={question.required}
                      onChange={(event) => setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item))}
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() => setQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    style={{ border: 'none', borderRadius: '8px', background: '#fef2f2', color: '#b91c1c', padding: '0.55rem 0.75rem', cursor: 'pointer', fontWeight: 700 }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setQuestions((current) => [...current, { id: `q_${Date.now()}`, label: '', type: 'short_text', required: false, riskPointsIfNegative: 0 }])}
              style={{ padding: '0.65rem 1rem', borderRadius: '8px', border: `1px solid ${COLORS.border}`, background: COLORS.hoverBg, color: COLORS.textPrimary, fontWeight: 700, cursor: 'pointer' }}
            >
              Add Question
            </button>
            <button
              type="button"
              onClick={handleCreateQuestionnaire}
              disabled={saving}
              style={{ padding: '0.65rem 1rem', borderRadius: '8px', border: 'none', background: COLORS.accentBlue, color: '#fff', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}
            >
              {saving ? 'Saving...' : 'Save Questionnaire'}
            </button>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ padding: '0.9rem 1rem', borderBottom: `1px solid ${COLORS.border}`, fontWeight: 700, color: COLORS.textPrimary }}>
          Pending Reviews
        </div>
        {loading ? (
          <div style={{ padding: '2rem', color: COLORS.textMuted }}>Loading onboarding queue...</div>
        ) : queue.length === 0 ? (
          <div style={{ padding: '2rem', color: COLORS.textMuted }}>No vendor onboarding submissions are waiting for review.</div>
        ) : (
          <div style={{ display: 'grid' }}>
            {queue.map((submission) => {
              const risk = riskPill(submission.riskLevel);
              return (
                <div key={submission.id} style={{ padding: '1rem', borderBottom: `1px solid ${COLORS.contentBg}`, display: 'grid', gap: '0.45rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                    <div>
                      <Link href={`/vendors/${submission.vendorId}`} style={{ color: COLORS.accentBlueDark, textDecoration: 'none', fontWeight: 700 }}>
                        {submission.vendor?.name ?? 'Unknown vendor'}
                      </Link>
                      <div style={{ fontSize: '0.8rem', color: COLORS.textSecondary }}>
                        {submission.questionnaire?.name ?? 'Default questionnaire'} • Submitted {submission.submittedAt ? new Date(submission.submittedAt).toLocaleString() : 'draft'}
                      </div>
                    </div>
                    <span style={{ background: risk.bg, color: risk.text, borderRadius: '999px', padding: '0.2rem 0.55rem', fontSize: '0.72rem', fontWeight: 700, textTransform: 'capitalize' }}>
                      {submission.riskLevel} risk
                    </span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: COLORS.textMuted }}>
                    Risk score: {submission.riskScore} • Status: {String(submission.status).replace(/_/g, ' ')}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ padding: '0.9rem 1rem', borderBottom: `1px solid ${COLORS.border}`, fontWeight: 700, color: COLORS.textPrimary }}>
          Saved Questionnaires
        </div>
        {questionnaires.length === 0 ? (
          <div style={{ padding: '1rem', color: COLORS.textMuted }}>No saved questionnaires yet.</div>
        ) : (
          <div style={{ display: 'grid' }}>
            {questionnaires.map((questionnaire) => (
              <div key={questionnaire.id} style={{ padding: '1rem', borderBottom: `1px solid ${COLORS.contentBg}` }}>
                <div style={{ fontWeight: 700, color: COLORS.textPrimary }}>
                  {questionnaire.name} {questionnaire.isDefault ? '• Default' : ''}
                </div>
                <div style={{ fontSize: '0.8rem', color: COLORS.textSecondary, marginTop: '0.25rem' }}>
                  {(questionnaire.questions ?? []).length} questions • {(questionnaire.scoringRules ?? []).length} scoring rules
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
