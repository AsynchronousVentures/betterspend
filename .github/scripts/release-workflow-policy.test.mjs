import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isValidReleaseTag, releaseTagFromRef, releaseVersionFromTag } from './release-policy.mjs';
import {
  assertMatchingWorkspaceVersions,
  gitOutputIfPresent,
  normalizeRequestedVersion,
} from '../../scripts/release-tag.mjs';

const workflow = readFileSync(new URL('../workflows/docker-deploy.yml', import.meta.url), 'utf8');
const releasePolicy = readFileSync(new URL('./release-policy.mjs', import.meta.url), 'utf8');
const releaseTagScript = readFileSync(
  new URL('../../scripts/release-tag.mjs', import.meta.url),
  'utf8',
);
const rollbackScript = readFileSync(new URL('../../deploy/rollback.sh', import.meta.url), 'utf8');

test('accepts strict semantic version release tags only', () => {
  assert.equal(isValidReleaseTag('v0.2.4'), true);
  assert.equal(isValidReleaseTag('v1.20.300-rc.1'), true);
  assert.equal(isValidReleaseTag('v1.20.300-01'), false);
  assert.equal(isValidReleaseTag('v0.2.4+build.7'), false);
  assert.equal(isValidReleaseTag('v01.2.4'), false);
  assert.equal(isValidReleaseTag('release-0.2.4'), false);
  assert.equal(isValidReleaseTag('v0.2'), false);
  assert.equal(isValidReleaseTag(`v0.0.0-0.${'--.'.repeat(1_000)}`), false);
});

test('requires the requested release to match every workspace package version', () => {
  const synchronizedVersions = [
    { path: 'package.json', version: '0.2.4' },
    { path: 'apps/api/package.json', version: '0.2.4' },
  ];

  assert.equal(normalizeRequestedVersion('v0.2.4'), '0.2.4');
  assert.throws(() => normalizeRequestedVersion('1.2.3-01'), /Expected a semantic version/);
  assert.throws(() => normalizeRequestedVersion('0.2.4+build.7'), /Expected a semantic version/);
  assert.doesNotThrow(() => assertMatchingWorkspaceVersions(synchronizedVersions, '0.2.4'));
  assert.throws(
    () => assertMatchingWorkspaceVersions(synchronizedVersions, '0.2.5'),
    /does not match workspace version/,
  );
  assert.throws(
    () =>
      assertMatchingWorkspaceVersions(
        [...synchronizedVersions, { path: 'apps/web/package.json', version: '0.2.3' }],
        '0.2.4',
      ),
    /not synchronized/,
  );
  assert.match(releasePolicy, /assertMatchingWorkspaceVersions/);
  assert.match(releasePolicy, /releaseVersionFromTag\(tag\)/);
});

test('checks the live main tip and keeps rollback metadata tied to its target', () => {
  assert.match(releaseTagScript, /\['fetch', '--quiet', 'origin', 'main'\]/);
  assert.match(releaseTagScript, /\['rev-parse', 'FETCH_HEAD'\]/);
  assert.match(rollbackScript, /APP_VERSION="\$\(release_version_from_image_tag "\$IMAGE_TAG"\)"/);
  assert.doesNotMatch(rollbackScript, /APP_VERSION="\$\{APP_VERSION:-/);
  assert.equal(
    gitOutputIfPresent(
      new URL('../..', import.meta.url),
      ['rev-parse', '--verify', '--quiet', 'refs/tags/v9999.9999.9999-missing'],
      1,
    ),
    '',
  );
  assert.throws(
    () => gitOutputIfPresent(new URL('../..', import.meta.url), ['not-a-git-command'], 2),
    /failed/,
  );
});

test('extracts and normalizes a validated release ref', () => {
  assert.equal(releaseTagFromRef('refs/heads/main', 'main'), '');
  assert.equal(releaseTagFromRef('refs/tags/v0.2.4', 'v0.2.4'), 'v0.2.4');
  assert.equal(releaseVersionFromTag('v0.2.4'), '0.2.4');
});

test('derives runtime versions from supported deployment image tags', () => {
  const deriveVersion = (imageTag) =>
    execFileSync(
      'bash',
      [
        '-c',
        'source deploy/release-version.sh && release_version_from_image_tag "$1"',
        '_',
        imageTag,
      ],
      { cwd: new URL('../..', import.meta.url), encoding: 'utf8' },
    ).trim();

  assert.equal(deriveVersion('v0.2.4'), '0.2.4');
  assert.equal(deriveVersion('v1.2.3-rc.1'), '1.2.3-rc.1');
  assert.equal(deriveVersion('sha-0123456789abcdef'), 'sha-0123456789abcdef');
  const unsupported = spawnSync(
    'bash',
    [
      '-c',
      'source deploy/release-version.sh && release_version_from_image_tag "$1"',
      '_',
      'latest',
    ],
    { cwd: new URL('../..', import.meta.url), encoding: 'utf8' },
  );
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /Unsupported image tag/);
  const invalidPrerelease = spawnSync(
    'bash',
    [
      '-c',
      'source deploy/release-version.sh && release_version_from_image_tag "$1"',
      '_',
      'v1.2.3-01',
    ],
    { cwd: new URL('../..', import.meta.url), encoding: 'utf8' },
  );
  assert.notEqual(invalidPrerelease.status, 0);
});

test('keeps immutable SHA images as the publication source', () => {
  assert.match(workflow, /commit_sha="\$\(git rev-parse 'HEAD\^\{commit\}'\)"/);
  assert.match(workflow, /SOURCE_IMAGE_TAG: \$\{\{ steps\.source_commit\.outputs\.image_tag \}\}/);
  assert.doesNotMatch(workflow, /IMAGE_TAG: sha-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /tags: \$\{\{ steps\.image_settings\.outputs\.api_tag \}\}/);
  assert.match(workflow, /tags: \$\{\{ steps\.image_settings\.outputs\.web_tag \}\}/);
  assert.match(workflow, /tags: \$\{\{ steps\.image_settings\.outputs\.migrator_tag \}\}/);
});

test('promotes all release images to the version and latest aliases', () => {
  const sourceWaitIndex = workflow.indexOf('- name: Check for existing immutable images');
  const stageIndex = workflow.indexOf('- name: Stage release version aliases');
  const verifyIndex = workflow.indexOf('- name: Verify staged release aliases');
  const latestIndex = workflow.indexOf('- name: Update latest image aliases');
  assert.ok(
    sourceWaitIndex > -1 &&
      sourceWaitIndex < stageIndex &&
      stageIndex < verifyIndex &&
      verifyIndex < latestIndex,
  );

  const sourceWait = workflow.slice(sourceWaitIndex, stageIndex);
  const staging = workflow.slice(stageIndex, verifyIndex);
  const verification = workflow.slice(verifyIndex, latestIndex);
  const latest = workflow.slice(latestIndex, workflow.indexOf('  deploy-preflight:'));
  assert.match(sourceWait, /max_attempts=90/);
  assert.match(sourceWait, /Waiting for immutable image/);
  assert.match(staging, /inspect --raw "\$source_tag"/);
  assert.match(staging, /inspect --raw "\$release_tag"/);
  assert.match(staging, /already refers to a different manifest/);
  for (const image of ['API', 'WEB', 'MIGRATOR']) {
    assert.match(staging, new RegExp(`${image}_SOURCE_TAG`));
    assert.match(staging, new RegExp(`${image}_RELEASE_TAG`));
    assert.match(verification, new RegExp(`${image}_SOURCE_TAG`));
    assert.match(verification, new RegExp(`${image}_RELEASE_TAG`));
    assert.match(latest, new RegExp(`${image}_RELEASE_TAG`));
    assert.match(latest, new RegExp(`${image}_LATEST_TAG`));
  }
  assert.match(latest, /if: steps\.release_ref\.outputs\.release_tag != ''/);
});

test('deploys the validated release tag and runs the shared preflight in fast CI', () => {
  assert.match(workflow, /release_tag: \$\{\{ steps\.release_ref\.outputs\.release_tag \}\}/);
  assert.match(workflow, /RELEASE_TAG: \$\{\{ needs\.publish\.outputs\.release_tag \}\}/);
  assert.match(workflow, /printf '%s\\n' "\$RELEASE_TAG" \|/);
  assert.match(workflow, /IFS= read -r image_tag && \.\/deploy\/deploy\.sh "\$image_tag"/);
  assert.doesNotMatch(
    workflow,
    /\.\/deploy\/deploy\.sh[^\n]*\$\{\{ needs\.publish\.outputs\.release_tag \}\}/,
  );
  assert.equal(
    (workflow.match(/node --test \.github\/scripts\/release-workflow-policy\.test\.mjs/g) ?? [])
      .length,
    1,
  );
  assert.match(workflow, /name: Run local CI preflight\n        run: pnpm ci:preflight/);
});

test('avoids duplicate Blacksmith work for promoted PRs and validated commits', () => {
  assert.match(workflow, /permissions:\n  checks: read\n  contents: read\n  pull-requests: read/);
  assert.match(
    workflow,
    /pull_request:\n    types:\n      - opened\n      - reopened\n      - synchronize/,
  );
  assert.match(workflow, /name: Fast CI[\s\S]*?timeout-minutes: 15/);
  assert.doesNotMatch(workflow, /Mark PR Ready for Review|gh pr ready/);
  assert.doesNotMatch(workflow, /review-gate|Review Gate|REVIEW_GATE_RESULT/);
  assert.match(workflow, /name: Full CI Proof/);
  assert.match(workflow, /check-runs\?filter=all&per_page=100/);
  assert.match(workflow, /check\.name === 'Full CI'/);
  assert.match(workflow, /check\.app\?\.slug === 'github-actions'/);
  assert.match(
    workflow,
    /needs\.full-ci-proof\.outputs\.available != 'true'[\s\S]*?runs-on: blacksmith-2vcpu-ubuntu-2404[\s\S]*?timeout-minutes: 30/,
  );
  assert.match(
    workflow,
    /runs-on: \$\{\{ startsWith\(github\.ref, 'refs\/tags\/v'\) && 'ubuntu-latest' \|\| 'blacksmith-2vcpu-ubuntu-2404' \}\}/,
  );
  assert.match(
    workflow,
    /- name: Setup Blacksmith Builder\n        if: github\.ref == 'refs\/heads\/main'/,
  );
  assert.doesNotMatch(workflow, /blacksmith-4vcpu/);
  assert.match(
    workflow,
    /full-ci-proof:[\s\S]*?runs-on: ubuntu-slim[\s\S]*?validate:[\s\S]*?runs-on: ubuntu-slim/,
  );
  assert.match(
    workflow,
    /validate:[\s\S]*?runs-on: ubuntu-slim[\s\S]*?deploy-preflight:[\s\S]*?runs-on: ubuntu-slim/,
  );
  assert.match(
    workflow,
    /validate:\n    name: Validate\n    if: always\(\)\n    needs: \[fast-ci, full-ci-proof, full-ci\]/,
  );
  assert.match(workflow, /deploy:[\s\S]*?runs-on: ubuntu-latest[\s\S]*?timeout-minutes: 15/);
});
