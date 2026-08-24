const requiredEnvironment = [
  'GATE_HEAD_SHA',
  'GATE_PR_NUMBER',
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
const pullRequestNumber = Number(process.env.GATE_PR_NUMBER);
const token = process.env.GITHUB_TOKEN;
const pollIntervalMs = Number(process.env.GATE_POLL_INTERVAL_MS ?? 10_000);
const timeoutMs = Number(process.env.GATE_TIMEOUT_MS ?? 15 * 60_000);
const requiredMacroscopeChecks = ['Macroscope - Correctness Check', 'Macroscope - Security review'];

if (!owner || !repository) {
  throw new Error('GITHUB_REPOSITORY must have the form owner/repository');
}

if (!Number.isInteger(pullRequestNumber)) {
  throw new Error('GATE_PR_NUMBER must be an integer');
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

async function githubRequest(path, init = {}) {
  return (await githubResponse(path, init)).json();
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

async function graphql(query, variables) {
  const response = await githubRequest('/graphql', {
    body: JSON.stringify({ query, variables }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

  if (response.errors) {
    throw new Error(`GitHub GraphQL error: ${JSON.stringify(response.errors)}`);
  }

  return response.data;
}

async function getUnresolvedCodeRabbitThreads() {
  const unresolvedThreads = [];
  let after = null;

  do {
    const data = await graphql(
      `
        query ReviewThreads(
          $owner: String!
          $repository: String!
          $pullRequestNumber: Int!
          $after: String
        ) {
          repository(owner: $owner, name: $repository) {
            pullRequest(number: $pullRequestNumber) {
              reviewThreads(first: 100, after: $after) {
                nodes {
                  isResolved
                  comments(first: 1) {
                    nodes {
                      author {
                        login
                      }
                      path
                      url
                    }
                  }
                }
                pageInfo {
                  endCursor
                  hasNextPage
                }
              }
            }
          }
        }
      `,
      { after, owner, pullRequestNumber, repository },
    );

    const threads = data.repository.pullRequest.reviewThreads;
    for (const thread of threads.nodes) {
      const comment = thread.comments.nodes[0];
      if (!thread.isResolved && comment?.author?.login.toLowerCase().startsWith('coderabbitai')) {
        unresolvedThreads.push(comment);
      }
    }

    after = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
  } while (after);

  return unresolvedThreads;
}

function latestByName(items, getName) {
  const latestItems = new Map();
  for (const item of items) {
    const name = getName(item).toLowerCase();
    if (!latestItems.has(name)) {
      latestItems.set(name, item);
    }
  }
  return latestItems;
}

async function getGateState() {
  const [checkRunItems, statusItems] = await Promise.all([
    githubPaginatedRequest(
      `/repos/${owner}/${repository}/commits/${headSha}/check-runs?filter=latest&per_page=100`,
      (response) => response.check_runs,
    ),
    githubPaginatedRequest(
      `/repos/${owner}/${repository}/commits/${headSha}/status?per_page=100`,
      (response) => response.statuses,
    ),
  ]);

  const checkRuns = latestByName(checkRunItems, (checkRun) => checkRun.name);
  const statuses = latestByName(statusItems, (status) => status.context);

  const blockers = [];
  const pending = [];

  for (const name of requiredMacroscopeChecks) {
    const checkRun = checkRuns.get(name.toLowerCase());
    if (!checkRun || checkRun.status !== 'completed') {
      pending.push(name);
    } else if (checkRun.conclusion !== 'success') {
      blockers.push(`${name}: ${checkRun.conclusion}`);
    }
  }

  const codeRabbitStatus = statuses.get('coderabbit');
  const codeRabbitCheckRun = checkRuns.get('coderabbit');
  if (codeRabbitStatus) {
    if (codeRabbitStatus.state === 'pending') {
      pending.push('CodeRabbit');
    } else if (codeRabbitStatus.state !== 'success') {
      blockers.push(`CodeRabbit: ${codeRabbitStatus.state}`);
    }
  } else if (codeRabbitCheckRun) {
    if (codeRabbitCheckRun.status !== 'completed') {
      pending.push('CodeRabbit');
    } else if (codeRabbitCheckRun.conclusion !== 'success') {
      blockers.push(`CodeRabbit: ${codeRabbitCheckRun.conclusion}`);
    }
  } else {
    pending.push('CodeRabbit');
  }

  return { blockers, pending };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const startedAt = Date.now();
let previousSummary = '';
let consecutiveGreenPolls = 0;

while (Date.now() - startedAt < timeoutMs) {
  const state = await getGateState();
  const summary = JSON.stringify(state);
  if (summary !== previousSummary) {
    console.log(
      state.pending.length
        ? `Waiting for: ${state.pending.join(', ')}`
        : 'External review checks completed',
    );
    previousSummary = summary;
  }

  if (state.blockers.length) {
    throw new Error(`Review gate blocked by ${state.blockers.join(', ')}`);
  }

  if (!state.pending.length) {
    const unresolvedThreads = await getUnresolvedCodeRabbitThreads();
    if (unresolvedThreads.length) {
      for (const thread of unresolvedThreads) {
        console.error(`Unresolved CodeRabbit finding: ${thread.path} ${thread.url}`);
      }
      throw new Error(
        `Review gate blocked by ${unresolvedThreads.length} unresolved CodeRabbit finding(s)`,
      );
    }

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
