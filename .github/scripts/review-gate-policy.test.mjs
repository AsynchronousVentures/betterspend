import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateGateState, requiredMacroscopeChecks } from './review-gate-policy.mjs';

const completedMacroscopeChecks = requiredMacroscopeChecks.map((name) => ({
  conclusion: 'success',
  name,
  status: 'completed',
}));

test('does not require CodeRabbit for a Blacksmith-authored PR', () => {
  assert.deepEqual(
    evaluateGateState({
      checkRunItems: completedMacroscopeChecks,
      pullRequestAuthor: 'blacksmith-sh[bot]',
      statusItems: [],
    }),
    { blockers: [], missing: [], pending: [] },
  );
});

test('still requires Macroscope for a Blacksmith-authored PR', () => {
  assert.deepEqual(
    evaluateGateState({
      checkRunItems: [],
      pullRequestAuthor: 'blacksmith-sh[bot]',
      statusItems: [],
    }),
    { blockers: [], missing: requiredMacroscopeChecks, pending: [] },
  );
});

test('blocks CodeRabbit for a Blacksmith PR when the review did run and failed', () => {
  assert.deepEqual(
    evaluateGateState({
      checkRunItems: completedMacroscopeChecks,
      pullRequestAuthor: 'blacksmith-sh[bot]',
      statusItems: [{ context: 'CodeRabbit', state: 'failure' }],
    }),
    { blockers: ['CodeRabbit: failure'], missing: [], pending: [] },
  );
});

test('reports an absent CodeRabbit review separately from a pending review', () => {
  assert.deepEqual(
    evaluateGateState({
      checkRunItems: completedMacroscopeChecks,
      pullRequestAuthor: 'av-tw',
      statusItems: [],
    }),
    { blockers: [], missing: ['CodeRabbit'], pending: [] },
  );
});

test('continues waiting when CodeRabbit registered a pending status', () => {
  assert.deepEqual(
    evaluateGateState({
      checkRunItems: completedMacroscopeChecks,
      pullRequestAuthor: 'av-tw',
      statusItems: [{ context: 'CodeRabbit', state: 'pending' }],
    }),
    { blockers: [], missing: [], pending: ['CodeRabbit'] },
  );
});

test('blocks a failed CodeRabbit status', () => {
  assert.deepEqual(
    evaluateGateState({
      checkRunItems: completedMacroscopeChecks,
      pullRequestAuthor: 'av-tw',
      statusItems: [{ context: 'CodeRabbit', state: 'failure' }],
    }),
    { blockers: ['CodeRabbit: failure'], missing: [], pending: [] },
  );
});
