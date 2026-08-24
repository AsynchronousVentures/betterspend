import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateBudgetPolicy, noBudgetDecision } from './budget-enforcement';

const budget = {
  id: 'budget-1',
  name: 'Engineering 2026',
  currency: 'USD',
  totalAmount: 1_000,
  spentAmount: 400,
};

describe('evaluateBudgetPolicy', () => {
  it('allows requests when no matching budget exists', () => {
    const decision = noBudgetDecision();

    assert.equal(decision.action, 'allow');
    assert.equal(decision.reason, 'no_budget');
  });

  it('allows a request that remains within available budget', () => {
    const decision = evaluateBudgetPolicy({
      budget,
      mode: 'hard_stop',
      pendingPolicy: 'approved_only',
      committedAmount: 100,
      requestedAmount: 500,
      ownerUserId: null,
    });

    assert.equal(decision.action, 'allow');
    assert.equal(decision.withinBudget, true);
    assert.equal(decision.remainingAfter, 0);
  });

  it('blocks a hard-stop overrun with the calculated availability', () => {
    const decision = evaluateBudgetPolicy({
      budget,
      mode: 'hard_stop',
      pendingPolicy: 'include_pending',
      committedAmount: 250,
      requestedAmount: 500,
      ownerUserId: null,
    });

    assert.equal(decision.action, 'block');
    assert.equal(decision.overrun, 150);
    assert.equal(decision.remainingBefore, 350);
    assert.match(decision.message, /exceeded by USD 150\.00/);
  });

  it('allows a visibility-only overrun while returning the warning details', () => {
    const decision = evaluateBudgetPolicy({
      budget,
      mode: 'visibility_only',
      pendingPolicy: 'approved_only',
      committedAmount: 100,
      requestedAmount: 700,
      ownerUserId: null,
    });

    assert.equal(decision.action, 'allow');
    assert.equal(decision.withinBudget, false);
    assert.equal(decision.overrun, 200);
  });

  it('requires the configured owner for an owner-approval overrun', () => {
    const decision = evaluateBudgetPolicy({
      budget,
      mode: 'owner_approval',
      pendingPolicy: 'approved_only',
      committedAmount: 100,
      requestedAmount: 700,
      ownerUserId: 'owner-1',
    });

    assert.equal(decision.action, 'require_approval');
    assert.equal(decision.ownerUserId, 'owner-1');
  });

  it('fails closed when owner approval has no active owner', () => {
    const decision = evaluateBudgetPolicy({
      budget,
      mode: 'owner_approval',
      pendingPolicy: 'approved_only',
      committedAmount: 100,
      requestedAmount: 700,
      ownerUserId: null,
    });

    assert.equal(decision.action, 'block');
    assert.equal(decision.reason, 'owner_missing');
  });
});
