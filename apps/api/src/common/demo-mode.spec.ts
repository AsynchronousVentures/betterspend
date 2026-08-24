import { assertDemoModeIsSafe, isDemoModeEnabled } from './demo-mode';

describe('demo mode configuration', () => {
  it('is disabled unless explicitly set to true', () => {
    expect(isDemoModeEnabled({})).toBe(false);
    expect(isDemoModeEnabled({ DEMO_MODE: 'false' })).toBe(false);
    expect(isDemoModeEnabled({ DEMO_MODE: 'TRUE' })).toBe(false);
    expect(isDemoModeEnabled({ DEMO_MODE: 'true' })).toBe(true);
  });

  it('rejects demo mode in production', () => {
    expect(() => assertDemoModeIsSafe({ NODE_ENV: 'production', DEMO_MODE: 'true' })).toThrow(
      'DEMO_MODE cannot be enabled when NODE_ENV=production',
    );
  });
});
