import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const zeroObjectId = /^0+$/;

export function requiresDockerPreflight(paths) {
  return paths.some((path) =>
    [
      /^\.dockerignore$/,
      /^\.husky\/install\.mjs$/,
      /^compose(?:\.[^/]+)?\.ya?ml$/,
      /^deploy\//,
      /^docker\//,
      /(?:^|\/)Dockerfile(?:\.[^/]*)?$/,
      /(?:^|\/)package\.json$/,
      /^patches\//,
      /^pnpm-lock\.yaml$/,
      /^pnpm-workspace\.yaml$/,
      /^tsconfig\.json$/,
      /^turbo\.json$/,
    ].some((pattern) => pattern.test(path)),
  );
}

function gitOutput(arguments_, options = {}) {
  return execFileSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: options.encoding ?? 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function tryGitOutput(arguments_) {
  try {
    return gitOutput(arguments_).trim();
  } catch {
    return '';
  }
}

function newRefBase(localObjectId, remoteName) {
  const candidates = [
    tryGitOutput(['symbolic-ref', '--quiet', `refs/remotes/${remoteName}/HEAD`]),
    `refs/remotes/${remoteName}/main`,
    'main',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const mergeBase = tryGitOutput(['merge-base', localObjectId, candidate]);
    if (mergeBase) return mergeBase;
  }

  return tryGitOutput(['rev-list', '--max-parents=0', localObjectId]).split('\n')[0];
}

function changedPaths(baseObjectId, localObjectId) {
  if (!baseObjectId) return [];
  const output = gitOutput(['diff', '--name-only', '-z', baseObjectId, localObjectId], {
    encoding: 'buffer',
  });
  return output.toString('utf8').split('\0').filter(Boolean);
}

export function pushedPaths(input, remoteName) {
  const paths = new Set();

  for (const line of input.trim().split('\n')) {
    if (!line) continue;
    const [, localObjectId, , remoteObjectId] = line.trim().split(/\s+/);
    if (!localObjectId || !remoteObjectId || zeroObjectId.test(localObjectId)) continue;

    const baseObjectId = zeroObjectId.test(remoteObjectId)
      ? newRefBase(localObjectId, remoteName)
      : remoteObjectId;
    for (const path of changedPaths(baseObjectId, localObjectId)) paths.add(path);
  }

  return [...paths];
}

export function runPrePush({ input, remoteName }) {
  const paths = pushedPaths(input, remoteName);
  const script = requiresDockerPreflight(paths) ? 'ci:preflight:docker' : 'ci:preflight';
  console.log(`Pre-push selected pnpm ${script}.`);

  const result = spawnSync('pnpm', [script], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runPrePush({
    input: readFileSync(0, 'utf8'),
    remoteName: process.argv[2] || 'origin',
  });
}
