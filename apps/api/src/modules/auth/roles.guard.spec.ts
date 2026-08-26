import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RolesGuard } from './roles.guard';

class PublicController {
  @Public()
  handler() {}
}

@Authenticated()
class AuthenticatedController {
  handler() {}
}

class PermissionController {
  @Permissions('vendors:view')
  handler() {}
}

class UnclassifiedController {
  handler() {}
}

function contextFor(controller: object, handler: object, request: Record<string, unknown> = {}) {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

describe('RolesGuard', () => {
  afterEach(() => {
    delete process.env.DEMO_MODE;
  });

  it('allows an explicitly public route without a session', () => {
    const guard = new RolesGuard();

    expect(
      guard.canActivate(contextFor(PublicController, PublicController.prototype.handler) as never),
    ).toBe(true);
  });

  it('allows an authenticated-only route after SessionGuard resolved a user', () => {
    const guard = new RolesGuard();
    const request = { authUser: { id: 'user-1' }, authAccess: {} };

    expect(
      guard.canActivate(
        contextFor(
          AuthenticatedController,
          AuthenticatedController.prototype.handler,
          request,
        ) as never,
      ),
    ).toBe(true);
  });

  it('rejects a permission-protected request without an authenticated user', () => {
    const guard = new RolesGuard();

    expect(() =>
      guard.canActivate(
        contextFor(PermissionController, PermissionController.prototype.handler) as never,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a user who lacks a required permission', () => {
    const guard = new RolesGuard();
    const request = {
      authUser: { id: 'user-1' },
      authAccess: { can: jest.fn(() => false) },
    };

    expect(() =>
      guard.canActivate(
        contextFor(PermissionController, PermissionController.prototype.handler, request) as never,
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows a user with every required permission', () => {
    const guard = new RolesGuard();
    const request = {
      authUser: { id: 'user-1' },
      authAccess: { can: jest.fn(() => true) },
    };

    expect(
      guard.canActivate(
        contextFor(PermissionController, PermissionController.prototype.handler, request) as never,
      ),
    ).toBe(true);
  });

  it('fails closed for a route without an explicit classification', () => {
    const guard = new RolesGuard();
    const request = { authUser: { id: 'user-1' }, authAccess: {} };

    expect(() =>
      guard.canActivate(
        contextFor(
          UnclassifiedController,
          UnclassifiedController.prototype.handler,
          request,
        ) as never,
      ),
    ).toThrow('Route access classification is required');
  });

  it('retains the explicit demo-mode escape hatch for classified routes', () => {
    process.env.DEMO_MODE = 'true';
    const guard = new RolesGuard();

    expect(
      guard.canActivate(
        contextFor(PermissionController, PermissionController.prototype.handler) as never,
      ),
    ).toBe(true);
  });
});
