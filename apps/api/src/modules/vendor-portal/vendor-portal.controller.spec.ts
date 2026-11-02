import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { VendorPortalController } from './vendor-portal.controller';
import { PORTAL_SESSION_COOKIE, PORTAL_SESSION_TTL_MS } from './vendor-portal-session';

describe('VendorPortalController session boundary', () => {
  const vendorId = '00000000-0000-0000-0000-000000000001';
  const organizationId = '00000000-0000-0000-0000-000000000002';

  it('passes the current access policy when sending a portal link', async () => {
    const access = {} as never;
    const service = {
      sendAccessLink: jest.fn(async () => ({ success: true })),
    };
    const controller = new VendorPortalController(service as never, {} as never);

    await expect(controller.sendAccess({ vendorId }, organizationId, access)).resolves.toEqual({
      success: true,
    });
    expect(service.sendAccessLink).toHaveBeenCalledWith(vendorId, organizationId, access);
  });

  it('signs in with a portal login and sets the same scoped HttpOnly cookie', async () => {
    const service = {
      loginWithPassword: jest.fn(async () => ({
        sessionToken: 'login-secret',
        expiresAt: new Date(Date.now() + PORTAL_SESSION_TTL_MS),
      })),
    };
    const response = { cookie: jest.fn() };
    const controller = new VendorPortalController(service as never, {} as never);

    await expect(
      controller.login(
        { email: 'billing@vendor.test', password: 'hunter2hunter2' },
        response as unknown as Response,
      ),
    ).resolves.toEqual({ success: true });
    expect(service.loginWithPassword).toHaveBeenCalledWith('billing@vendor.test', 'hunter2hunter2');
    expect(response.cookie).toHaveBeenCalledWith(
      PORTAL_SESSION_COOKIE,
      'login-secret',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/v1/vendor-portal',
      }),
    );
  });

  it('refuses a password change on a link-only session', async () => {
    const service = {
      validateSessionContext: jest.fn(async () => ({
        vendorId,
        organizationId,
        portalUserId: null,
      })),
    };
    const users = { changePassword: jest.fn() };
    const controller = new VendorPortalController(service as never, {} as never, users as never);
    const request = { headers: { cookie: `${PORTAL_SESSION_COOKIE}=abc` } } as Request;

    await expect(
      controller.changeOwnPassword(request, { currentPassword: 'a', newPassword: 'longenough' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.changePassword).not.toHaveBeenCalled();
  });

  it('exchanges the link token for a scoped HttpOnly cookie', async () => {
    const service = {
      exchangeLinkToken: jest.fn(async () => ({
        sessionToken: 'session-secret',
        expiresAt: new Date(Date.now() + PORTAL_SESSION_TTL_MS),
      })),
    };
    const response = { cookie: jest.fn() };
    const controller = new VendorPortalController(service as never, {} as never);

    await expect(
      controller.exchangeSession({ token: 'one-time-link' }, response as unknown as Response),
    ).resolves.toEqual({ success: true });

    expect(service.exchangeLinkToken).toHaveBeenCalledWith('one-time-link');
    expect(response.cookie).toHaveBeenCalledWith(
      PORTAL_SESSION_COOKIE,
      'session-secret',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/v1/vendor-portal',
        maxAge: PORTAL_SESSION_TTL_MS,
      }),
    );
  });

  it('authenticates dashboard requests from the cookie', async () => {
    const service = {
      validateSessionContext: jest.fn(async () => ({ vendorId, organizationId })),
      getVendorDashboard: jest.fn(async () => ({ vendorId })),
    };
    const controller = new VendorPortalController(service as never, {} as never);
    const request = {
      headers: { cookie: `${PORTAL_SESSION_COOKIE}=session-secret` },
    } as Request;

    await controller.getDashboard(request);

    expect(service.validateSessionContext).toHaveBeenCalledWith('session-secret');
    expect(service.getVendorDashboard).toHaveBeenCalledWith(vendorId, organizationId);
  });

  it('rejects a query credential when the session cookie is missing', async () => {
    const controller = new VendorPortalController({} as never, {} as never);
    const request = { headers: {}, query: { token: 'legacy-token' } } as unknown as Request;

    await expect(controller.getDashboard(request)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes the session and clears the scoped cookie', async () => {
    const service = { revokeSession: jest.fn(async () => undefined) };
    const response = { clearCookie: jest.fn() };
    const controller = new VendorPortalController(service as never, {} as never);
    const request = {
      headers: { cookie: `${PORTAL_SESSION_COOKIE}=session-secret` },
    } as Request;

    await expect(
      controller.revokeSession(request, response as unknown as Response),
    ).resolves.toEqual({ success: true });

    expect(service.revokeSession).toHaveBeenCalledWith('session-secret');
    expect(response.clearCookie).toHaveBeenCalledWith(
      PORTAL_SESSION_COOKIE,
      expect.objectContaining({
        httpOnly: true,
        path: '/api/v1/vendor-portal',
      }),
    );
  });
});
