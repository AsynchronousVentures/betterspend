import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertMatchingWorkspaceVersions,
  readWorkspaceVersions,
} from '../../scripts/release-tag.mjs';

const SEMVER_TAG_PATTERN =
  /^v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/;

export function isValidReleaseTag(value) {
  return typeof value === 'string' && SEMVER_TAG_PATTERN.test(value);
}

export function releaseVersionFromTag(value) {
  if (!isValidReleaseTag(value)) throw new Error(`Invalid release tag: ${value}`);
  return value.slice(1);
}

export function releaseTagFromRef(ref, refName = '') {
  if (!ref.startsWith('refs/tags/')) return '';
  const tag = refName || ref.slice('refs/tags/'.length);
  if (!isValidReleaseTag(tag)) throw new Error(`Invalid release tag: ${tag}`);
  return tag;
}

function writeGithubOutputs(tag) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error('GITHUB_OUTPUT is required');
  const version = tag ? releaseVersionFromTag(tag) : '';
  appendFileSync(outputPath, `release_tag=${tag}\nrelease_version=${version}\n`);
}

function main() {
  if (process.argv[2] !== 'validate-ref') {
    throw new Error('Usage: release-policy.mjs validate-ref');
  }

  const tag = releaseTagFromRef(process.env.GITHUB_REF ?? '', process.env.GITHUB_REF_NAME ?? '');
  if (tag) {
    const repositoryRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
    assertMatchingWorkspaceVersions(
      readWorkspaceVersions(repositoryRoot),
      releaseVersionFromTag(tag),
    );
  }
  writeGithubOutputs(tag);
  if (tag) console.log(`Validated release tag ${tag} (${releaseVersionFromTag(tag)})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
