import assert from 'node:assert/strict';
import test from 'node:test';
import { isNonRuntimePath, requiresRuntimeValidation } from './ci-change-policy.mjs';

test('recognizes documentation and agent metadata as non-runtime changes', () => {
  for (const filePath of [
    'README.md',
    'packages/example/README.md',
    'CHANGELOG.md',
    'LICENSE',
    'docs/deployment.md',
    'docs/reviews/example.html',
    'AGENTS.md',
    'packages/example/AGENTS.md',
    'CLAUDE.md',
    '.agents/skills/example/SKILL.md',
    '.claude/settings.json',
    '.macroscope/approvability.md',
    '.coderabbit.yaml',
    '.github/ISSUE_TEMPLATE/bug_report.md',
    '.github/skills/example/SKILL.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/dependabot.yml',
    '.gitignore',
    'skills-lock.json',
  ]) {
    assert.equal(isNonRuntimePath(filePath), true, filePath);
  }
});

test('fails closed for runtime, packaging, validation, and unknown changes', () => {
  for (const filePath of [
    '.github/workflows/docker-ci.yml',
    '.github/scripts/review-policy.test.mjs',
    'docker/api.Dockerfile',
    '.dockerignore',
    'package.json',
    'apps/api/package.json',
    'pnpm-lock.yaml',
    'scripts/ci-preflight.mjs',
    'apps/web/src/app/page.tsx',
    'packages/db/src/schema/users.ts',
    'compose.yaml',
    'turbo.json',
    'unknown-file.txt',
  ]) {
    assert.equal(isNonRuntimePath(filePath), false, filePath);
  }
});

test('requires runtime validation for mixed or empty change sets', () => {
  assert.equal(requiresRuntimeValidation(['docs/deployment.md', 'AGENTS.md']), false);
  assert.equal(requiresRuntimeValidation(['docs/deployment.md', 'apps/api/src/main.ts']), true);
  assert.equal(requiresRuntimeValidation([]), true);
});
