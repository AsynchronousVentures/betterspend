import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../workflows/docker-deploy.yml', import.meta.url), 'utf8');
const codeRabbitConfig = readFileSync(new URL('../../.coderabbit.yaml', import.meta.url), 'utf8');
const approvabilityConfig = readFileSync(
  new URL('../../.macroscope/approvability.md', import.meta.url),
  'utf8',
);
const reviewPolicy = readFileSync(
  new URL('../../docs/agents/pr-review-policy.md', import.meta.url),
  'utf8',
);

test('uses native approvals instead of a polling review gate', () => {
  assert.doesNotMatch(workflow, /review-gate|Review Gate|wait-for-review-gate/);
  assert.match(
    reviewPolicy,
    /Require the stable `Validate` check, one approving review, and resolved review threads\./,
  );
  assert.match(reviewPolicy, /approval from Macroscope Approvability or a human reviewer/);
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
