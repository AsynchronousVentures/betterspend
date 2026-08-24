import { evaluateGateState } from './review-gate-policy.mjs';

const requiredEnvironment = [
  'GATE_HEAD_SHA',
  'GITHUB_REPOSITORY',
  'GITHUB_TOKEN',
];

for (const name of requiredEnvironment) {
  if (!process.env[name]) {
    throw new Error(`${name} is required`);
  }
}

const [owner, repository] = process.env.GITHUB_REPOSITORY.split('/');
const headSha = process.env.GATE_HEAD_SHA;
const token = process.env.GITHUB_TOKEN;
const pollIntervalMs = Number(process.env.GATE_POLL_INTERVAL_MS ?? 10_000);
const startupGraceMs = Number(process.env.GATE_STARTUP_GRACE_MS ?? 60_000);
const timeoutMs = Number(process.env.GATE_TIMEOUT_MS ?? 15 * 60_000);

if (!owner || !repository) {
  throw new Error('GITHUB_REPOSITORY must have the form owner/repository');
}

const headers = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${token}`,
  'user-agent': 'betterspend-review-gate',
  'x-github-api-version': '2022-11-28',
};

async function githubResponse(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}: ${await response.text()}`);
  }

  return response;
}

function getNextPagePath(linkHeader) {
  if (!linkHeader) return null;

  for (const link of linkHeader.split(',')) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      const url = new URL(match[1]);
      return `${url.pathname}${url.search}`;
    }
  }

  return null;
}

async function githubPaginatedRequest(path, getItems) {
  const items = [];
  let nextPath = path;

  while (nextPath) {
    const response = await githubResponse(nextPath);
    items.push(...getItems(await response.json()));
    nextPath = getNextPagePath(response.headers.get('link'));
  }

  return items;
}

async function getGateState() {
  const checkRunItems = await githubPaginatedRequest(
    `/repos/${owner}/${repository}/commits/${headSha}/check-runs?filter=latest&per_page=100`,
    (response) => response.check_runs,
  );

  return evaluateGateState({ checkRunItems });
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const startedAt = Date.now();
let previousSummary = '';
let consecutiveGreenPolls = 0;

while (Date.now() - startedAt < timeoutMs) {
  const state = await getGateState();
  const summary = JSON.stringify(state);
  if (summary !== previousSummary) {
    const waitingFor = [...state.pending, ...state.missing.map((name) => `${name} to start`)];
    console.log(
      waitingFor.length
        ? `Waiting for: ${waitingFor.join(', ')}`
        : 'External review checks completed',
    );
    previousSummary = summary;
  }

  if (state.blockers.length) {
    throw new Error(`Review gate blocked by ${state.blockers.join(', ')}`);
  }

  if (state.missing.length && Date.now() - startedAt >= startupGraceMs) {
    throw new Error(
      `Review checks did not start within ${Math.round(startupGraceMs / 1_000)} seconds: ${state.missing.join(', ')}`,
    );
  }

  if (!state.missing.length && !state.pending.length) {
    consecutiveGreenPolls += 1;
    if (consecutiveGreenPolls === 2) {
      console.log('Review gate passed');
      process.exit(0);
    }
  } else {
    consecutiveGreenPolls = 0;
  }

  await sleep(pollIntervalMs);
}

throw new Error(`Review gate timed out after ${Math.round(timeoutMs / 60_000)} minutes`);
