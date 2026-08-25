import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isValidReleaseTag, releaseTagFromRef, releaseVersionFromTag } from './release-policy.mjs';
import {
  assertMatchingWorkspaceVersions,
  normalizeRequestedVersion,
} from '../../scripts/release-tag.mjs';

const workflow = readFileSync(new URL('../workflows/docker-deploy.yml', import.meta.url), 'utf8');
const releasePolicy = readFileSync(new URL('./release-policy.mjs', import.meta.url), 'utf8');

test('accepts strict semantic version release tags only', () => {
  assert.equal(isValidReleaseTag('v0.2.4'), true);
  assert.equal(isValidReleaseTag('v1.20.300-rc.1'), true);
  assert.equal(isValidReleaseTag('v0.2.4+build.7'), false);
  assert.equal(isValidReleaseTag('v01.2.4'), false);
  assert.equal(isValidReleaseTag('release-0.2.4'), false);
  assert.equal(isValidReleaseTag('v0.2'), false);
});

test('requires the requested release to match every workspace package version', () => {
  const synchronizedVersions = [
    { path: 'package.json', version: '0.2.4' },
    { path: 'apps/api/package.json', version: '0.2.4' },
  ];

  assert.equal(normalizeRequestedVersion('v0.2.4'), '0.2.4');
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
    ['-c', 'source deploy/release-version.sh && release_version_from_image_tag "$1"', '_', 'latest'],
    { cwd: new URL('../..', import.meta.url), encoding: 'utf8' },
  );
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /Unsupported image tag/);
});

test('keeps immutable SHA images as the publication source', () => {
  assert.match(workflow, /IMAGE_TAG: sha-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /tags: \$\{\{ steps\.image_settings\.outputs\.api_tag \}\}/);
  assert.match(workflow, /tags: \$\{\{ steps\.image_settings\.outputs\.web_tag \}\}/);
  assert.match(workflow, /tags: \$\{\{ steps\.image_settings\.outputs\.migrator_tag \}\}/);
});

test('promotes all release images to the version and latest aliases', () => {
  const promotion = workflow.slice(workflow.indexOf('- name: Promote release image aliases'));
  assert.match(promotion, /if: steps\.release_ref\.outputs\.release_tag != ''/);
  for (const image of ['API', 'WEB', 'MIGRATOR']) {
    assert.match(promotion, new RegExp(`${image}_SOURCE_TAG`));
    assert.match(promotion, new RegExp(`${image}_RELEASE_TAG`));
    assert.match(promotion, new RegExp(`${image}_LATEST_TAG`));
  }
  assert.doesNotMatch(workflow, /Update latest image aliases/);
});

test('deploys the validated release tag and runs this policy in fast and full CI', () => {
  assert.match(workflow, /release_tag: \$\{\{ steps\.release_ref\.outputs\.release_tag \}\}/);
  assert.match(
    workflow,
    /\.\/deploy\/deploy\.sh '\$\{\{ needs\.publish\.outputs\.release_tag \}\}'/,
  );
  assert.equal(
    (workflow.match(/node --test \.github\/scripts\/release-workflow-policy\.test\.mjs/g) ?? [])
      .length,
    2,
  );
});
