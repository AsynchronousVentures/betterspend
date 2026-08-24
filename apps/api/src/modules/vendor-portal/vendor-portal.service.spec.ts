import { Logger, UnauthorizedException } from '@nestjs/common';
import type { Db } from '@betterspend/db';
import { VendorPortalService } from './vendor-portal.service';
import { hashPortalSessionToken, PORTAL_SESSION_TTL_MS } from './vendor-portal-session';

function createService(db: unknown, settingsService: unknown = {}) {
  return new VendorPortalService(
    db as Db,
    {} as never,
    settingsService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('VendorPortalService sessions', () => {
  const vendorId = '00000000-0000-0000-0000-000000000001';
  const organizationId = '00000000-0000-0000-0000-000000000002';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects expired sessions', async () => {
    const db = {
      query: {
        vendorPortalSessions: {
          findFirst: jest.fn(async () => ({
            vendorId,
            organizationId,
            expiresAt: new Date(Date.now() - 1),
            revokedAt: null,
          })),
        },
      },
    };

    await expect(createService(db).validateSessionContext('expired')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects revoked sessions', async () => {
    const db = {
      query: {
        vendorPortalSessions: {
          findFirst: jest.fn(async () => ({
            vendorId,
            organizationId,
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: new Date(),
          })),
        },
      },
    };

    await expect(createService(db).validateSessionContext('revoked')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('resolves a live session to the vendor organization', async () => {
    const db = {
      query: {
        vendorPortalSessions: {
          findFirst: jest.fn(async () => ({
            vendorId,
            organizationId,
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
          })),
        },
      },
    };

    await expect(createService(db).validateSessionContext('live-session')).resolves.toEqual({
      vendorId,
      organizationId,
    });
  });

  it('rejects an already-consumed link during exchange', async () => {
    const transactionDb = {
      query: {
        vendorPortalTokens: {
          findFirst: jest.fn(async () => ({
            id: '00000000-0000-0000-0000-000000000003',
            vendorId,
          })),
        },
        vendors: {
          findFirst: jest.fn(async () => ({ organizationId })),
        },
      },
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({ returning: jest.fn(async () => []) })),
        })),
      })),
    };
    const db = {
      transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transactionDb),
      ),
    };

    await expect(createService(db).exchangeLinkToken('already-used')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('consumes a link and stores only the session credential hash', async () => {
    const insertedSessions: Array<Record<string, unknown>> = [];
    const transactionDb = {
      query: {
        vendorPortalTokens: {
          findFirst: jest.fn(async () => ({
            id: '00000000-0000-0000-0000-000000000003',
            vendorId,
          })),
        },
        vendors: {
          findFirst: jest.fn(async () => ({ organizationId })),
        },
      },
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            returning: jest.fn(async () => [{ id: '00000000-0000-0000-0000-000000000003' }]),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn(async (values: Record<string, unknown>) => insertedSessions.push(values)),
      })),
    };
    const db = {
      transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transactionDb),
      ),
    };
    const before = Date.now();

    const result = await createService(db).exchangeLinkToken('one-time-link');

    expect(insertedSessions).toEqual([
      expect.objectContaining({
        organizationId,
        vendorId,
        tokenHash: hashPortalSessionToken(result.sessionToken),
      }),
    ]);
    expect(insertedSessions[0].tokenHash).not.toBe(result.sessionToken);
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + PORTAL_SESSION_TTL_MS);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + PORTAL_SESSION_TTL_MS);
  });

  it('never writes an access credential to fallback logs', async () => {
    let insertedToken = '';
    const db = {
      query: {
        vendors: {
          findFirst: jest.fn(async () => ({
            id: vendorId,
            name: 'Vendor',
            contactInfo: { email: 'vendor@example.com' },
          })),
        },
      },
      insert: jest.fn(() => ({
        values: jest.fn(async (values: { token: string }) => {
          insertedToken = values.token;
        }),
      })),
    };
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await createService(db, {
      getAll: jest.fn(async () => ({ app_url: 'https://app.example.com' })),
    }).sendAccessLink(vendorId, organizationId);

    const messages = [...warn.mock.calls, ...log.mock.calls].flat().join(' ');
    expect(insertedToken).toHaveLength(64);
    expect(messages).not.toContain(insertedToken);
    expect(messages).not.toContain('token=');
  });
});
