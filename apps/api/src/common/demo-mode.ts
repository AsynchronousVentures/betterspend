export const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000001';
export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000002';

export function isDemoModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEMO_MODE === 'true';
}

export function assertDemoModeIsSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && isDemoModeEnabled(env)) {
    throw new Error('DEMO_MODE cannot be enabled when NODE_ENV=production');
  }
}
