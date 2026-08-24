import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateGateState, requiredMacroscopeChecks } from './review-gate-policy.mjs';

const completedMacroscopeChecks = requiredMacroscopeChecks.map((name) => ({
  conclusion: 'success',
  name,
  status: 'completed',
}));

test('passes when all required Macroscope checks succeed', () => {
  assert.deepEqual(
    evaluateGateState({
      checkRunItems: completedMacroscopeChecks,
    }),
    { blockers: [], missing: [], pending: [] },
  );
});

test('reports missing Macroscope checks', () => {
  assert.deepEqual(
    evaluateGateState({
      checkRunItems: [],
    }),
    { blockers: [], missing: requiredMacroscopeChecks, pending: [] },
  );
});

test('waits for pending Macroscope checks', () => {
  assert.deepEqual(
    evaluateGateState({
      checkRunItems: completedMacroscopeChecks.map((checkRun, index) =>
        index === 1 ? { ...checkRun, conclusion: null, status: 'in_progress' } : checkRun,
      ),
    }),
    { blockers: [], missing: [], pending: [requiredMacroscopeChecks[1]] },
  );
});

test('blocks failed Macroscope checks', () => {
  assert.deepEqual(
    evaluateGateState({
      checkRunItems: completedMacroscopeChecks.map((checkRun, index) =>
        index === 1 ? { ...checkRun, conclusion: 'failure' } : checkRun,
      ),
    }),
    { blockers: [`${requiredMacroscopeChecks[1]}: failure`], missing: [], pending: [] },
  );
});

test('accepts a skipped scoped Macroscope check', () => {
  assert.deepEqual(
    evaluateGateState({
      checkRunItems: completedMacroscopeChecks.map((checkRun, index) =>
        index === 0 ? { ...checkRun, conclusion: 'skipped' } : checkRun,
      ),
    }),
    { blockers: [], missing: [], pending: [] },
  );
});

test('ignores CodeRabbit check runs', () => {
  assert.deepEqual(
    evaluateGateState({
      checkRunItems: [
        ...completedMacroscopeChecks,
        { conclusion: 'failure', name: 'CodeRabbit', status: 'completed' },
      ],
    }),
    { blockers: [], missing: [], pending: [] },
  );
});
