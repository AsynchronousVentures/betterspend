export const requiredMacroscopeChecks = [
  'Macroscope - Correctness Check',
  'Macroscope - Security review',
];

const codeRabbitOptionalAuthors = new Set(['blacksmith-sh[bot]']);

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

export function evaluateGateState({ checkRunItems, pullRequestAuthor, statusItems }) {
  const checkRuns = latestByName(checkRunItems, (checkRun) => checkRun.name);
  const statuses = latestByName(statusItems, (status) => status.context);

  const blockers = [];
  const missing = [];
  const pending = [];

  for (const name of requiredMacroscopeChecks) {
    const checkRun = checkRuns.get(name.toLowerCase());
    if (!checkRun) {
      missing.push(name);
    } else if (checkRun.status !== 'completed') {
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
  } else if (!codeRabbitOptionalAuthors.has(pullRequestAuthor)) {
    missing.push('CodeRabbit');
  }

  return { blockers, missing, pending };
}
