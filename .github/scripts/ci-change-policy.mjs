import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const nonRuntimeFiles = new Set([
  '.coderabbit.yaml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/dependabot.yml',
  '.gitignore',
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'skills-lock.json',
]);

const nonRuntimeDirectories = [
  '.agents/',
  '.claude/',
  '.github/ISSUE_TEMPLATE/',
  '.github/skills/',
  '.macroscope/',
  'docs/',
];

/**
 * This is deliberately an allowlist. Unknown files require runtime validation.
 */
export function isNonRuntimePath(filePath) {
  const normalizedPath = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  const fileName = normalizedPath.split('/').at(-1);

  return (
    nonRuntimeFiles.has(normalizedPath) ||
    nonRuntimeDirectories.some((directory) => normalizedPath.startsWith(directory)) ||
    normalizedPath.endsWith('.md') ||
    fileName === 'AGENTS.md' ||
    fileName === 'CLAUDE.md'
  );
}

export function requiresRuntimeValidation(filePaths) {
  return filePaths.length === 0 || filePaths.some((filePath) => !isNonRuntimePath(filePath));
}

function readNullDelimitedPaths() {
  return readFileSync(0, 'utf8').split('\0').filter(Boolean);
}

function run() {
  const arguments_ = process.argv.slice(2);
  const unknownArguments = arguments_.filter(
    (argument) => argument !== '--stdin0' && argument !== '--force-runtime',
  );
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown argument: ${unknownArguments.join(', ')}`);
  }

  const filePaths = arguments_.includes('--stdin0') ? readNullDelimitedPaths() : [];
  const runtime = arguments_.includes('--force-runtime') || requiresRuntimeValidation(filePaths);
  const summary = runtime
    ? 'Runtime validation required.'
    : `Skipping runtime validation for ${filePaths.length} non-runtime file(s).`;

  console.log(summary);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `runtime=${runtime}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
