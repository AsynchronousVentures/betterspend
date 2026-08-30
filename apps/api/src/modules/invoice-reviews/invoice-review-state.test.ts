import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialReviewCaseState,
  nextReviewCaseState,
  type ReviewSignalState,
} from './invoice-review-state';

const signal = (
  severity: ReviewSignalState['severity'],
  status: ReviewSignalState['status'] = 'open',
): ReviewSignalState => ({ severity, status });

test('an actionable first signal opens a case while informational evidence is resolved', () => {
  assert.equal(initialReviewCaseState(signal('blocking')), 'open');
  assert.equal(initialReviewCaseState(signal('review_required')), 'open');
  assert.equal(initialReviewCaseState(signal('informational')), 'resolved');
  assert.equal(initialReviewCaseState(signal('blocking', 'resolved')), 'resolved');
});

test('a newly actionable signal reopens a resolved case', () => {
  assert.equal(nextReviewCaseState('resolved', [signal('blocking')]), 'open');
  assert.equal(nextReviewCaseState('resolved', [signal('review_required')]), 'open');
  assert.equal(nextReviewCaseState('resolved', [signal('informational')]), 'resolved');
});

test('an unclaimed case resolves when no blocking signal remains', () => {
  assert.equal(nextReviewCaseState('open', [signal('blocking', 'resolved')]), 'resolved');
  assert.equal(nextReviewCaseState('open', [signal('informational')]), 'resolved');
  assert.equal(nextReviewCaseState('open', [signal('review_required')]), 'open');
});

test('producer refreshes do not overwrite command-owned case states', () => {
  const signals = [signal('blocking', 'resolved')];
  assert.equal(nextReviewCaseState('in_review', signals), 'in_review');
  assert.equal(nextReviewCaseState('waiting_on_supplier', signals), 'waiting_on_supplier');
});
