import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceManifestPaths = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/db/package.json',
  'packages/shared/package.json',
];

function isAsciiDigit(character) {
  return character >= '0' && character <= '9';
}

function isValidNumericIdentifier(value) {
  if (!value || (value.length > 1 && value.startsWith('0'))) return false;
  return [...value].every(isAsciiDigit);
}

function isValidPrereleaseIdentifier(value) {
  if (!value) return false;
  let hasNonDigit = false;

  for (const character of value) {
    const isLetter =
      (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');
    if (!isAsciiDigit(character) && !isLetter && character !== '-') return false;
    if (!isAsciiDigit(character)) hasNonDigit = true;
  }

  return hasNonDigit || isValidNumericIdentifier(value);
}

export function isValidReleaseVersion(value) {
  if (typeof value !== 'string' || !value || value.length > 127 || value.includes('+'))
    return false;

  const prereleaseSeparator = value.indexOf('-');
  const core = prereleaseSeparator === -1 ? value : value.slice(0, prereleaseSeparator);
  const prerelease = prereleaseSeparator === -1 ? null : value.slice(prereleaseSeparator + 1);
  const coreIdentifiers = core.split('.');

  if (coreIdentifiers.length !== 3 || !coreIdentifiers.every(isValidNumericIdentifier))
    return false;
  return prerelease === null || prerelease.split('.').every(isValidPrereleaseIdentifier);
}

export function normalizeRequestedVersion(value) {
  const trimmed = value.trim();
  const version = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  if (!isValidReleaseVersion(version))
    throw new Error(`Expected a semantic version such as 0.2.4, received "${value}".`);
  return version;
}

export function readWorkspaceVersions(rootDirectory) {
  return workspaceManifestPaths.map((relativePath) => {
    const manifest = JSON.parse(readFileSync(resolve(rootDirectory, relativePath), 'utf8'));
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      !('version' in manifest) ||
      typeof manifest.version !== 'string'
    ) {
      throw new Error(`${relativePath} does not contain a string version.`);
    }
    return { path: relativePath, version: manifest.version };
  });
}

export function assertMatchingWorkspaceVersions(versions, requestedVersion) {
  const uniqueVersions = new Set(versions.map(({ version }) => version));
  if (uniqueVersions.size !== 1) {
    throw new Error(
      `Workspace package versions are not synchronized: ${versions.map(({ path, version }) => `${path}=${version}`).join(', ')}`,
    );
  }

  const [workspaceVersion] = uniqueVersions;
  if (workspaceVersion !== requestedVersion) {
    throw new Error(
      `Requested version ${requestedVersion} does not match workspace version ${workspaceVersion}. Update every workspace package version first.`,
    );
  }
}

function runGit(rootDirectory, args) {
  return execFileSync('git', args, { cwd: rootDirectory, encoding: 'utf8' }).trim();
}

export function gitOutputIfPresent(rootDirectory, args, notFoundStatus) {
  const result = spawnSync('git', args, { cwd: rootDirectory, encoding: 'utf8' });
  if (result.status === 0) return result.stdout.trim();
  if (result.status === notFoundStatus) return '';

  const detail = result.stderr.trim() || result.error?.message || 'unknown git error';
  throw new Error(`git ${args.join(' ')} failed: ${detail}`);
}

export function assertReleaseState(rootDirectory, requestedVersion) {
  const versions = readWorkspaceVersions(rootDirectory);
  assertMatchingWorkspaceVersions(versions, requestedVersion);

  if (runGit(rootDirectory, ['status', '--porcelain']))
    throw new Error('The working tree must be clean before creating a release tag.');
  if (runGit(rootDirectory, ['branch', '--show-current']) !== 'main')
    throw new Error('Release tags must be created from the main branch.');

  runGit(rootDirectory, ['fetch', '--quiet', 'origin', 'main']);
  const originMain = runGit(rootDirectory, ['rev-parse', 'FETCH_HEAD']);
  if (runGit(rootDirectory, ['rev-parse', 'HEAD']) !== originMain) {
    throw new Error('The local main branch must match origin/main before creating a release tag.');
  }

  if (
    gitOutputIfPresent(
      rootDirectory,
      ['rev-parse', '--verify', '--quiet', `refs/tags/v${requestedVersion}`],
      1,
    )
  ) {
    throw new Error(`Tag v${requestedVersion} already exists.`);
  }

  if (
    gitOutputIfPresent(
      rootDirectory,
      ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/v${requestedVersion}`],
      2,
    )
  ) {
    throw new Error(`Tag v${requestedVersion} already exists on origin.`);
  }
}

export function main(
  argv = process.argv.slice(2),
  rootDirectory = resolve(fileURLToPath(import.meta.url), '..', '..'),
) {
  const requestedVersion = normalizeRequestedVersion(argv[0] ?? '');
  assertReleaseState(rootDirectory, requestedVersion);
  execFileSync('git', ['tag', '-a', `v${requestedVersion}`, '-m', `Release v${requestedVersion}`], {
    cwd: rootDirectory,
    stdio: 'inherit',
  });
  console.log(`Created annotated tag v${requestedVersion}. Push it manually when ready.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
