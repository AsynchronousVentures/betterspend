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
const deployScript = readFileSync(new URL('../../deploy/deploy.sh', import.meta.url), 'utf8');

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
  assert.match(sourceWait, /max_attempts=1[\s\S]*?max_attempts=3/);
  assert.match(sourceWait, /Retrying immutable image lookup/);
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
  assert.match(
    workflow,
    /name: Start Redis for lease integration[\s\S]*?--health-cmd "redis-cli ping"[\s\S]*?redis:7-alpine/,
  );
  assert.match(
    workflow,
    /name: Run local CI preflight\n        if: needs\.change-scope\.outputs\.runtime == 'true'\n        env:\n          REDIS_TEST_URL: redis:\/\/127\.0\.0\.1:6379\n          REQUIRE_REDIS_TEST: 'true'\n        run: pnpm ci:preflight/,
  );
});

test('quiesces API writes for a final migration sweep before replacing the stack', () => {
  const onlineMigration = deployScript.indexOf('compose_with_migrate_profile run --rm migrator');
  const stopApi = deployScript.indexOf('compose stop api');
  const catchUpMigration = deployScript.indexOf(
    'compose_with_migrate_profile run --rm migrator',
    onlineMigration + 1,
  );
  const startStack = deployScript.indexOf('compose up -d --remove-orphans');

  assert.ok(
    onlineMigration > -1 &&
      onlineMigration < stopApi &&
      stopApi < catchUpMigration &&
      catchUpMigration < startStack,
  );
  assert.match(deployScript, /compose start api/);
});

test('restores the API when deployment exits during the final migration sweep', () => {
  const trap = deployScript.indexOf('restore_api_on_exit()');
  const stopApi = deployScript.indexOf('api_quiesced=true');
  const startStack = deployScript.indexOf('compose up -d --remove-orphans');
  const markStarted = deployScript.indexOf('new_stack_started=true');

  assert.ok(trap > -1 && trap < stopApi);
  assert.ok(stopApi > -1 && stopApi < startStack && startStack < markStarted);
  assert.match(deployScript, /trap restore_api_on_exit EXIT/);
  assert.match(deployScript, /trap 'exit 130' INT/);
  assert.match(deployScript, /trap 'exit 143' TERM/);
  assert.match(
    deployScript,
    /\[ "\$api_quiesced" = true \] && \[ "\$new_stack_started" != true \][\s\S]*?compose start api/,
  );
});

test('requires the Redis lease integration in both fast and full CI', () => {
  const fullCiStart = workflow.indexOf('  full-ci:\n');
  const validateStart = workflow.indexOf('  validate:\n');
  const fullCi = workflow.slice(fullCiStart, validateStart);

  assert.match(fullCi, /REQUIRE_REDIS_TEST: 'true'/);
  assert.match(fullCi, /REDIS_TEST_URL: redis:\/\/127\.0\.0\.1:6379/);
  assert.match(
    fullCi,
    /redis:\n        image: redis:7-alpine[\s\S]*?--health-cmd "redis-cli ping"/,
  );
  assert.equal((workflow.match(/REQUIRE_REDIS_TEST: 'true'/g) ?? []).length, 2);
});

test('uses standard GitHub-hosted runners without duplicate validation', () => {
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
    /name: Fast CI[\s\S]*?runs-on: \$\{\{ needs\.change-scope\.outputs\.runtime == 'true' && 'ubuntu-24\.04' \|\| 'ubuntu-slim' \}\}/,
  );
  assert.match(
    workflow,
    /needs\.change-scope\.outputs\.runtime == 'true'[\s\S]*?needs\.full-ci-proof\.outputs\.available != 'true'[\s\S]*?runs-on: ubuntu-24\.04[\s\S]*?timeout-minutes: 30/,
  );
  assert.match(
    workflow,
    /publish:\n    name: Publish Images[\s\S]*?runs-on: ubuntu-24\.04[\s\S]*?timeout-minutes: 30/,
  );
  assert.equal((workflow.match(/uses: docker\/setup-buildx-action@v3/g) ?? []).length, 2);
  assert.equal((workflow.match(/uses: docker\/build-push-action@v6/g) ?? []).length, 6);
  assert.doesNotMatch(workflow, /blacksmith|useblacksmith/i);
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
    /validate:\n    name: Validate\n    if: always\(\)\n    needs: \[change-scope, fast-ci, full-ci-proof, full-ci\]/,
  );
  assert.match(workflow, /deploy:[\s\S]*?runs-on: ubuntu-24\.04[\s\S]*?timeout-minutes: 15/);
});

test('keeps the required Validate check while skipping expensive non-runtime validation', () => {
  assert.match(workflow, /change-scope:\n    name: Classify Changes/);
  assert.match(workflow, /merge_group\) base_sha="\$MERGE_GROUP_BASE_SHA"/);
  assert.match(workflow, /git diff --no-renames --name-only -z "\$base_sha" "\$GITHUB_SHA"/);
  assert.match(workflow, /node \.github\/scripts\/ci-change-policy\.mjs --force-runtime/);
  assert.match(
    workflow,
    /name: Fast CI[\s\S]*?Accept non-runtime changes[\s\S]*?needs\.change-scope\.outputs\.runtime != 'true'/,
  );
  assert.match(workflow, /full-ci:[\s\S]*?needs\.change-scope\.outputs\.runtime == 'true'/);
  assert.match(
    workflow,
    /elif \[ "\$RUNTIME_VALIDATION" = "false" \]; then[\s\S]*?test "\$FULL_CI_RESULT" = "skipped"/,
  );
  assert.match(
    workflow,
    /publish:\n    name: Publish Images[\s\S]*?needs\.change-scope\.outputs\.runtime == 'true'[\s\S]*?needs: \[change-scope, validate\]/,
  );
  assert.doesNotMatch(workflow, /paths-ignore:/);
});

test('builds missing immutable sources with the standard Docker actions after validation', () => {
  assert.match(
    workflow,
    /push\)[\s\S]*?if \[\[ "\$GITHUB_REF" == refs\/tags\/\* \]\]; then[\s\S]*?ci-change-policy\.mjs --force-runtime/,
  );
  assert.match(
    workflow,
    /publish:\n    name: Publish Images[\s\S]*?needs\.validate\.result == 'success'[\s\S]*?name: Set up Docker builder\n        uses: docker\/setup-buildx-action@v3/,
  );
  for (const image of ['API', 'web', 'migrator']) {
    assert.match(
      workflow,
      new RegExp(
        `name: Build and push ${image} image[\\s\\S]*?if: steps\\.existing_images\\.outputs\\.${image.toLowerCase()}_exists != 'true'[\\s\\S]*?uses: docker/build-push-action@v6`,
      ),
    );
  }
  assert.doesNotMatch(workflow, /name: Require immutable source images for release/);
  assert.match(workflow, /name: Stage release version aliases[\s\S]*?inspect --raw "\$source_tag"/);
});
