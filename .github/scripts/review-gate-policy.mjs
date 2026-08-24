export const requiredMacroscopeChecks = [
  'Macroscope - Correctness Check',
  'Macroscope - Security review',
];

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

export function evaluateGateState({ checkRunItems }) {
  const checkRuns = latestByName(checkRunItems, (checkRun) => checkRun.name);

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

  return { blockers, missing, pending };
}
