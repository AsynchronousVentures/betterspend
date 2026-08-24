import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { VendorPortalController } from './vendor-portal.controller';
import { PORTAL_SESSION_COOKIE, PORTAL_SESSION_TTL_MS } from './vendor-portal-session';

describe('VendorPortalController session boundary', () => {
  const vendorId = '00000000-0000-0000-0000-000000000001';
  const organizationId = '00000000-0000-0000-0000-000000000002';

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
});
