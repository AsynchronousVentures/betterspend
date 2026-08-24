import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  afterEach(() => {
    delete process.env.DEMO_MODE;
  });

  it('rejects a role-protected request without an authenticated user', () => {
    const guard = new RolesGuard({
      getAllAndOverride: jest.fn().mockReturnValueOnce(['admin']).mockReturnValueOnce(undefined),
    } as never);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn(() => ({ getRequest: () => ({}) })),
    };

    expect(() => guard.canActivate(context as never)).toThrow(UnauthorizedException);
  });

  it('leaves routes without authorization metadata to SessionGuard', () => {
    const guard = new RolesGuard({
      getAllAndOverride: jest.fn(() => undefined),
    } as never);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
    };

    expect(guard.canActivate(context as never)).toBe(true);
  });

  it('allows a missing user only when demo mode is explicitly enabled', () => {
    process.env.DEMO_MODE = 'true';
    const guard = new RolesGuard({
      getAllAndOverride: jest.fn().mockReturnValueOnce(['admin']).mockReturnValueOnce(undefined),
    } as never);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn(() => ({ getRequest: () => ({}) })),
    };

    expect(guard.canActivate(context as never)).toBe(true);
  });

  it('does not grant admin access based on the seeded demo user id', () => {
    const guard = new RolesGuard({
      getAllAndOverride: jest.fn().mockReturnValueOnce(['admin']).mockReturnValueOnce(undefined),
    } as never);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn(() => ({
        getRequest: () => ({
          authUser: {
            id: '00000000-0000-0000-0000-000000000002',
            roles: [],
          },
        }),
      })),
    };

    expect(() => guard.canActivate(context as never)).toThrow(ForbiddenException);
  });
});
