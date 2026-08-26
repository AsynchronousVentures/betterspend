import { UnauthorizedException } from '@nestjs/common';
import { SessionGuard } from './session.guard';

describe('SessionGuard', () => {
  afterEach(() => {
    delete process.env.DEMO_MODE;
  });

  it('rejects a non-public request without a bearer or cookie session', async () => {
    const guard = new SessionGuard(
      { getAllAndOverride: jest.fn(() => false) } as never,
      { api: { getSession: jest.fn(async () => null) } } as never,
      {} as never,
      {} as never,
    );
    const request = { headers: {} };
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn(() => ({ getRequest: () => request })),
    };

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows a missing session only when demo mode is explicitly enabled', async () => {
    process.env.DEMO_MODE = 'true';
    const guard = new SessionGuard(
      { getAllAndOverride: jest.fn(() => false) } as never,
      { api: { getSession: jest.fn(async () => null) } } as never,
      {} as never,
      {} as never,
    );
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn(() => ({ getRequest: () => ({ headers: {} }) })),
    };

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });

  it('rejects an inactive user for an otherwise valid bearer session', async () => {
    const session = {
      id: 'session-1',
      userId: 'user-1',
      token: 'token-1',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const inactiveUser = {
      id: 'user-1',
      organizationId: 'org-1',
      email: 'inactive@example.test',
      name: 'Inactive',
      emailVerified: true,
      isActive: false,
    };
    const limit = jest.fn().mockResolvedValueOnce([session]).mockResolvedValueOnce([inactiveUser]);
    const db = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ limit })),
        })),
      })),
    };
    const accessPolicy = { resolve: jest.fn() };
    const guard = new SessionGuard(
      { getAllAndOverride: jest.fn(() => false) } as never,
      { api: { getSession: jest.fn() } } as never,
      db as never,
      accessPolicy as never,
    );
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn(() => ({
        getRequest: () => ({ headers: { authorization: 'Bearer token-1' } }),
      })),
    };

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(accessPolicy.resolve).not.toHaveBeenCalled();
  });
});
