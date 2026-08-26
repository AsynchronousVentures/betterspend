import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const arguments_ = process.argv.slice(2);

if (arguments_.includes('--help')) {
  console.log(`Usage: pnpm ci:preflight [--docker]

Runs the local checks required before pushing. Add --docker when Dockerfiles,
workspace dependencies, Compose files, or deployment packaging changed.`);
  process.exit(0);
}

const unknownArguments = arguments_.filter((argument) => argument !== '--docker');
if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument: ${unknownArguments.join(', ')}`);
}

function run(name, command, commandArguments, options = {}) {
  console.log(`\n> ${name}`);
  const result = spawnSync(command, commandArguments, {
    cwd: repositoryRoot,
    env: { ...process.env, ...options.env },
    stdio: options.quiet ? ['inherit', 'ignore', 'inherit'] : 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('Workflow policy tests', 'node', [
  '--test',
  '.github/scripts/review-policy.test.mjs',
  '.github/scripts/release-workflow-policy.test.mjs',
  'scripts/pre-push.test.mjs',
]);
run('Lint', 'pnpm', ['lint']);
run('Tests', 'pnpm', ['test', '--', '--runInBand']);
run('Typecheck', 'pnpm', ['typecheck']);
run('Application builds', 'pnpm', ['build']);

run(
  'Development Compose configuration',
  'docker',
  ['compose', '--profile', 'app', '--profile', 'tools', 'config'],
  {
    env: { CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64') },
    quiet: true,
  },
);
run(
  'Production Compose configuration',
  'docker',
  [
    'compose',
    '--profile',
    'migrate',
    '--env-file',
    '.env.production.example',
    '-f',
    'compose.yaml',
    '-f',
    'compose.prod.yaml',
    'config',
  ],
  {
    env: {
      IMAGE_TAG: 'sha-local-preflight',
      PRODUCTION_ENV_FILE: '.env.production.example',
    },
    quiet: true,
  },
);

if (arguments_.includes('--docker')) {
  for (const [name, dockerfile] of [
    ['API image', 'docker/api.Dockerfile'],
    ['Web image', 'docker/web.Dockerfile'],
    ['Migrator image', 'docker/migrator.Dockerfile'],
  ]) {
    run(name, 'docker', [
      'buildx',
      'build',
      '--file',
      dockerfile,
      '--platform',
      'linux/amd64',
      '--output',
      'type=cacheonly',
      '.',
    ]);
  }
}

console.log('\nLocal CI preflight passed.');
