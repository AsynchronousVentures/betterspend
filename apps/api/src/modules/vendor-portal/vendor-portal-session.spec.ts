import {
  PORTAL_SESSION_COOKIE,
  PORTAL_SESSION_TTL_MS,
  hashPortalSessionToken,
  portalSessionCookieOptions,
  readPortalSessionCookie,
} from './vendor-portal-session';

describe('vendor portal session boundary', () => {
  it('stores only a one-way digest of the session credential', () => {
    const credential = 'vendor-session-credential';

    expect(hashPortalSessionToken(credential)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPortalSessionToken(credential)).not.toContain(credential);
  });

  it('scopes the production cookie to the vendor portal API', () => {
    expect(portalSessionCookieOptions('production')).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/v1/vendor-portal',
      maxAge: PORTAL_SESSION_TTL_MS,
    });
  });

  it('allows the cookie over local HTTP only outside production', () => {
    expect(portalSessionCookieOptions('development').secure).toBe(false);
  });

  it('reads only the scoped session cookie from a request', () => {
    expect(
      readPortalSessionCookie(`other=value; ${PORTAL_SESSION_COOKIE}=session-token; final=value`),
    ).toBe('session-token');
    expect(readPortalSessionCookie('other=value')).toBeUndefined();
  });
});
