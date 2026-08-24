import { UnauthorizedException } from '@nestjs/common';
import { resolveCurrentOrgId } from './current-org-id.decorator';
import { resolveCurrentUserId } from './current-user-id.decorator';

describe('current request identity', () => {
  afterEach(() => {
    delete process.env.DEMO_MODE;
  });

  it('uses only the authenticated identity outside demo mode', () => {
    const request = {
      authUser: { id: 'user-id', organizationId: 'org-id' },
      headers: { 'x-org-id': 'spoofed-org', 'x-user-id': 'spoofed-user' },
    } as never;

    expect(resolveCurrentOrgId(request)).toBe('org-id');
    expect(resolveCurrentUserId(request)).toBe('user-id');
  });

  it('rejects header identity fallbacks outside demo mode', () => {
    const request = {
      headers: { 'x-org-id': 'spoofed-org', 'x-user-id': 'spoofed-user' },
    } as never;

    expect(() => resolveCurrentOrgId(request)).toThrow(UnauthorizedException);
    expect(() => resolveCurrentUserId(request)).toThrow(UnauthorizedException);
  });

  it('allows header identity overrides in explicit demo mode', () => {
    process.env.DEMO_MODE = 'true';
    const request = {
      headers: { 'x-org-id': 'demo-org', 'x-user-id': 'demo-user' },
    } as never;

    expect(resolveCurrentOrgId(request)).toBe('demo-org');
    expect(resolveCurrentUserId(request)).toBe('demo-user');
  });
});
