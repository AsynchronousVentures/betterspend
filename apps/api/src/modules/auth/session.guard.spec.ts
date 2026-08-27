import { UnauthorizedException } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SessionGuard } from './session.guard';

class PublicController {
  @Public()
  handler() {}
}

class UnclassifiedController {
  handler() {}
}

function contextFor(controller: object, handler: object, request: Record<string, unknown>) {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

function createGuard(
  auth = { api: { getSession: jest.fn(async () => null) } },
  db = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn().mockResolvedValueOnce([{ id: 'demo-org' }]).mockResolvedValueOnce([
            { id: 'demo-user' },
          ]),
        })),
      })),
    })),
  },
) {
  return new SessionGuard(auth as never, db as never, {} as never);
}

describe('SessionGuard', () => {
  afterEach(() => {
    delete process.env.DEMO_MODE;
  });

  it('allows an explicitly public request without resolving a session', async () => {
    const auth = { api: { getSession: jest.fn() } };
    const guard = createGuard(auth);

    await expect(
      guard.canActivate(
        contextFor(PublicController, PublicController.prototype.handler, { headers: {} }) as never,
      ),
    ).resolves.toBe(true);
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it('rejects an unclassified request without a bearer or cookie session', async () => {
    const guard = createGuard();

    await expect(
      guard.canActivate(
        contextFor(UnclassifiedController, UnclassifiedController.prototype.handler, {
          headers: {},
        }) as never,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows a missing session only when demo mode is explicitly enabled', async () => {
    process.env.DEMO_MODE = 'true';
    const guard = createGuard();

    await expect(
      guard.canActivate(
        contextFor(UnclassifiedController, UnclassifiedController.prototype.handler, {
          headers: {},
        }) as never,
      ),
    ).resolves.toBe(true);
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
      { api: { getSession: jest.fn() } } as never,
      db as never,
      accessPolicy as never,
    );

    await expect(
      guard.canActivate(
        contextFor(UnclassifiedController, UnclassifiedController.prototype.handler, {
          headers: { authorization: 'Bearer token-1' },
        }) as never,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(accessPolicy.resolve).not.toHaveBeenCalled();
  });
});
