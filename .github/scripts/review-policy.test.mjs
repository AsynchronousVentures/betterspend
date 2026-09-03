import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../workflows/docker-ci.yml', import.meta.url), 'utf8');
const codeRabbitConfig = readFileSync(new URL('../../.coderabbit.yaml', import.meta.url), 'utf8');
const approvabilityConfig = readFileSync(
  new URL('../../.macroscope/approvability.md', import.meta.url),
  'utf8',
);
const reviewPolicy = readFileSync(
  new URL('../../docs/agents/pr-reviews.md', import.meta.url),
  'utf8',
);

test('documents the enforced GitHub gates without requiring native approval', () => {
  assert.doesNotMatch(workflow, /review-gate|Review Gate|wait-for-review-gate/);
  assert.match(
    reviewPolicy,
    /The enforced GitHub gates are the stable `Validate` check, resolved review threads, and the merge queue\./,
  );
  assert.match(reviewPolicy, /GitHub requires zero approving reviews and has no bypass actors\./);
  assert.match(reviewPolicy, /Merge BetterSpend PRs through the merge queue as squash merges, never by bypassing it\./);
  assert.doesNotMatch(reviewPolicy, /one approving review/);
  assert.doesNotMatch(reviewPolicy, /Approvability supplies the required approval/);
});

test('preserves advisory review triage and author-specific review requirements', () => {
  assert.match(reviewPolicy, /Approvability is useful evidence for low-risk PRs, but it is not a required merge gate\./);
  assert.match(reviewPolicy, /`Eligibility: Not approved` alone does not block merge/);
  assert.match(reviewPolicy, /a Macroscope correctness or security finding, a `CHANGES_REQUESTED` review, or another verified must-fix finding/);
  assert.match(reviewPolicy, /External-contributor PRs require human maintainer review before merge\./);
  assert.match(reviewPolicy, /Maintainer- and agent-authored PRs may proceed without a native GitHub approval/);
  assert.match(reviewPolicy, /Do not manufacture self-approval on maintainer-authored PRs\./);
});

test('leaves ready-for-review promotion to the watching agent', () => {
  assert.doesNotMatch(workflow, /gh pr ready|pull-requests: write/);
  assert.match(reviewPolicy, /run `gh pr ready <PR URL>`/);
});

test('keeps CodeRabbit manual', () => {
  assert.match(
    codeRabbitConfig,
    /auto_review:\n    enabled: false\n    drafts: false\n    auto_incremental_review: false/,
  );
});

test('waits for Fast CI before Macroscope evaluates approvability', () => {
  assert.match(approvabilityConfig, /^---\nwaitsFor:\n  - "Fast CI"\nconclusion: neutral\n---\n/);
  assert.match(
    approvabilityConfig,
    /Auto-approve only after the Fast CI check for the pull request's current head has completed successfully\./,
  );
  assert.match(approvabilityConfig, /skipped, cancelled, neutral, or failed Fast CI check/);
});

test('records the supported reviewer feedback mechanisms', () => {
  assert.match(reviewPolicy, /react with 👍 when the finding is useful and correct or 👎/);
  assert.match(reviewPolicy, /CodeRabbit learns from direct natural-language replies/);
  assert.match(reviewPolicy, /Do not create a learning for a one-off exception/);
});
