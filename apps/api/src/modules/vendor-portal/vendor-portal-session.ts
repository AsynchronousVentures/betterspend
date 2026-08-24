import { createHash } from 'crypto';
import type { CookieOptions } from 'express';

export const PORTAL_SESSION_COOKIE = 'bs_vendor_portal_session';
export const PORTAL_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function hashPortalSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function portalSessionCookieOptions(nodeEnv = process.env.NODE_ENV): CookieOptions {
  return {
    httpOnly: true,
    secure: nodeEnv === 'production',
    sameSite: 'strict',
    path: '/api/v1/vendor-portal',
    maxAge: PORTAL_SESSION_TTL_MS,
  };
}

export function readPortalSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;

  for (const entry of cookieHeader.split(';')) {
    const [name, ...valueParts] = entry.trim().split('=');
    if (name === PORTAL_SESSION_COOKIE) {
      return valueParts.join('=') || undefined;
    }
  }

  return undefined;
}
