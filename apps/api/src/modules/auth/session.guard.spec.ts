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
    );
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn(() => ({ getRequest: () => ({ headers: {} }) })),
    };

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });
});
