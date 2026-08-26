import assert from 'node:assert/strict';
import test from 'node:test';

import { requiresDockerPreflight } from './pre-push.mjs';

test('selects Docker preflight for production packaging inputs', () => {
  for (const path of [
    '.dockerignore',
    '.husky/install.mjs',
    'apps/api/package.json',
    'compose.prod.yaml',
    'deploy/deploy.sh',
    'docker/api.Dockerfile',
    'package.json',
    'patches/example.patch',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'turbo.json',
  ]) {
    assert.equal(requiresDockerPreflight([path]), true, path);
  }
});

test('keeps application-only changes on the standard preflight', () => {
  assert.equal(
    requiresDockerPreflight([
      'AGENTS.md',
      'apps/api/src/app.module.ts',
      'apps/web/src/app/page.tsx',
      'packages/shared/src/index.ts',
    ]),
    false,
  );
});
