export function isDemoModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEMO_MODE === 'true';
}

export function assertDemoModeIsSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && isDemoModeEnabled(env)) {
    throw new Error('DEMO_MODE cannot be enabled when NODE_ENV=production');
  }
}
