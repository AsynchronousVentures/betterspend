import { UnauthorizedException } from '@nestjs/common';
import { SessionGuard } from './session.guard';

describe('SessionGuard', () => {
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
});
