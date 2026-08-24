import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  convertMoney,
  convertMoneyFromBase,
  evaluateBudgetPolicy,
  noBudgetDecision,
} from './budget-enforcement';

const budget = {
  id: 'budget-1',
  name: 'Engineering 2026',
  currency: 'USD',
  totalAmount: '1000.00',
  spentAmount: '400.00',
};

describe('evaluateBudgetPolicy', () => {
  it('converts persisted decimals without floating-point drift', () => {
    assert.equal(convertMoney('0.10', '0.20000000'), '0.02');
    assert.equal(convertMoney('999999999999.99', '1.00000000'), '999999999999.99');
    assert.equal(convertMoneyFromBase('120.00', '1.20000000'), '100.00');
  });

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
      committedAmount: '100.00',
      requestedAmount: '500.00',
      ownerUserId: null,
    });

    assert.equal(decision.action, 'allow');
    assert.equal(decision.withinBudget, true);
    assert.equal(decision.remainingAfter, '0.00');
  });

  it('blocks a hard-stop overrun with the calculated availability', () => {
    const decision = evaluateBudgetPolicy({
      budget,
      mode: 'hard_stop',
      pendingPolicy: 'include_pending',
      committedAmount: '250.00',
      requestedAmount: '500.00',
      ownerUserId: null,
    });

    assert.equal(decision.action, 'block');
    assert.equal(decision.overrun, '150.00');
    assert.equal(decision.remainingBefore, '350.00');
    assert.match(decision.message, /exceeded by USD 150\.00/);
  });

  it('allows a visibility-only overrun while returning the warning details', () => {
    const decision = evaluateBudgetPolicy({
      budget,
      mode: 'visibility_only',
      pendingPolicy: 'approved_only',
      committedAmount: '100.00',
      requestedAmount: '700.00',
      ownerUserId: null,
    });

    assert.equal(decision.action, 'allow');
    assert.equal(decision.withinBudget, false);
    assert.equal(decision.overrun, '200.00');
  });

  it('requires the configured owner for an owner-approval overrun', () => {
    const decision = evaluateBudgetPolicy({
      budget,
      mode: 'owner_approval',
      pendingPolicy: 'approved_only',
      committedAmount: '100.00',
      requestedAmount: '700.00',
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
      committedAmount: '100.00',
      requestedAmount: '700.00',
      ownerUserId: null,
    });

    assert.equal(decision.action, 'block');
    assert.equal(decision.reason, 'owner_missing');
  });

  it('fails closed for an unrecognized persisted enforcement mode', () => {
    const decision = evaluateBudgetPolicy({
      budget,
      mode: 'legacy_mode' as never,
      pendingPolicy: 'approved_only',
      committedAmount: '100.00',
      requestedAmount: '700.00',
      ownerUserId: 'owner-1',
    });

    assert.equal(decision.action, 'block');
    assert.equal(decision.withinBudget, false);
  });

  it('compares exact decimal cents at the budget boundary', () => {
    const decision = evaluateBudgetPolicy({
      budget: { ...budget, totalAmount: '0.30', spentAmount: '0.10' },
      mode: 'hard_stop',
      pendingPolicy: 'approved_only',
      committedAmount: '0.00',
      requestedAmount: '0.20',
      ownerUserId: null,
    });

    assert.equal(decision.action, 'allow');
    assert.equal(decision.remainingAfter, '0.00');
  });
});
