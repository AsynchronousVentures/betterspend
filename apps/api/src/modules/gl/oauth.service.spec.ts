import axios from 'axios';
import type { Db } from '@betterspend/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import { CredentialCryptoService } from '../ai-providers/credential-crypto.service';
import { OAuthService, XERO_SCOPES } from './oauth.service';
import type { OAuthStateBinding, XeroPendingGrant } from './oauth-redis.service';

jest.mock('axios');

const auditProjection = [
  {
    changesJson: '{}',
    metadataJson: '{}',
    createdAtText: '2026-08-29T00:00:00.000000Z',
  },
];

class FakeOAuthRedis {
  private readonly states = new Map<string, OAuthStateBinding>();
  private lockTail = Promise.resolve();

  async createState(binding: OAuthStateBinding): Promise<string> {
    const state = 'opaque-state-value';
    this.states.set(state, binding);
    return state;
  }

  async consumeState(state: string): Promise<OAuthStateBinding | null> {
    const binding = this.states.get(state) ?? null;
    this.states.delete(state);
    return binding;
  }

  async withLock<T>(_key: string, callback: () => Promise<T>): Promise<T> {
    const result = this.lockTail.then(callback);
    this.lockTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

class FakeXeroOAuthRedis extends FakeOAuthRedis {
  private pendingGrant: XeroPendingGrant | null = null;
  private selectedTenantId: string | null = null;

  async createXeroPendingGrant(grant: XeroPendingGrant): Promise<string> {
    this.pendingGrant = grant;
    return 'pending-grant';
  }

  async getXeroPendingGrant(grantId: string): Promise<XeroPendingGrant | null> {
    return grantId === 'pending-grant' ? this.pendingGrant : null;
  }

  async consumeXeroPendingGrant(grantId: string): Promise<XeroPendingGrant | null> {
    if (grantId !== 'pending-grant') return null;
    const grant = this.pendingGrant;
    this.pendingGrant = null;
    this.selectedTenantId = null;
    return grant;
  }

  async claimXeroPendingTenant(
    grantId: string,
    tenantId: string,
  ): Promise<'claimed' | 'already_claimed' | 'conflict' | 'missing'> {
    if (grantId !== 'pending-grant' || !this.pendingGrant) return 'missing';
    if (!this.selectedTenantId) {
      this.selectedTenantId = tenantId;
      return 'claimed';
    }
    return this.selectedTenantId === tenantId ? 'already_claimed' : 'conflict';
  }

  async completeXeroPendingGrant(grantId: string, tenantId: string): Promise<boolean> {
    if (grantId !== 'pending-grant') return false;
    if (this.selectedTenantId && this.selectedTenantId !== tenantId) return false;
    this.pendingGrant = null;
    this.selectedTenantId = null;
    return true;
  }
}

class ExpiringAfterSaveXeroOAuthRedis extends FakeXeroOAuthRedis {
  async consumeXeroPendingGrant(_grantId: string): Promise<XeroPendingGrant | null> {
    return null;
  }

  async completeXeroPendingGrant(_grantId: string, _tenantId: string): Promise<boolean> {
    return false;
  }
}

class FailingAfterSaveXeroOAuthRedis extends FakeXeroOAuthRedis {
  private failCleanup = true;

  async consumeXeroPendingGrant(grantId: string): Promise<XeroPendingGrant | null> {
    if (this.failCleanup) {
      this.failCleanup = false;
      throw new Error('Redis unavailable while consuming grant');
    }
    return super.consumeXeroPendingGrant(grantId);
  }

  async completeXeroPendingGrant(grantId: string, tenantId: string): Promise<boolean> {
    if (this.failCleanup) {
      this.failCleanup = false;
      throw new Error('Redis unavailable while consuming grant');
    }
    return super.completeXeroPendingGrant(grantId, tenantId);
  }
}

class ConcurrentXeroOAuthRedis extends FakeXeroOAuthRedis {
  async withLock<T>(_key: string, callback: () => Promise<T>): Promise<T> {
    return callback();
  }
}

function insertCapturingDb(captured: Array<Record<string, unknown>>): Db {
  const db = {} as {
    execute: jest.Mock;
    select: jest.Mock;
    insert: jest.Mock;
    transaction: jest.Mock;
  };
  db.execute = jest.fn(async () => auditProjection);
  db.select = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        orderBy: jest.fn(() => ({ limit: jest.fn(async () => []) })),
        limit: jest.fn(async () => []),
      })),
    })),
  }));
  db.insert = jest.fn(() => ({
    values: jest.fn((values: Record<string, unknown>) => {
      captured.push(values);
      return {
        returning: jest.fn(async () => [values]),
        onConflictDoUpdate: jest.fn(() => ({
          returning: jest.fn(async () => [{ id: '00000000-0000-0000-0000-000000000010' }]),
        })),
      };
    }),
  }));
  db.transaction = jest.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
    callback(db),
  );
  return db as unknown as Db;
}

function auditTransaction(captured: Array<Record<string, unknown>>) {
  return {
    execute: jest.fn(async () => auditProjection),
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          orderBy: jest.fn(() => ({ limit: jest.fn(async () => []) })),
          limit: jest.fn(async () => []),
        })),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn((values: Record<string, unknown>) => {
        captured.push(values);
        return { returning: jest.fn(async () => [values]) };
      }),
    })),
  };
}

function qboSyncQueue(
  error?: Error,
  existingJob?: {
    id?: string;
    getState: jest.Mock<Promise<string>, []>;
    remove: jest.Mock<Promise<void>, []>;
  },
) {
  return {
    getJob: jest.fn(async () => existingJob ?? null),
    add: error
      ? jest.fn(async () => Promise.reject(error))
      : jest.fn(async () => ({ id: 'qbo-initial-sync-job' })),
  };
}

describe('OAuthService', () => {
  const organizationId = '00000000-0000-0000-0000-000000000001';
  const userId = '00000000-0000-0000-0000-000000000002';
  const sessionId = 'session-1';
  const crypto = new CredentialCryptoService();
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.isAxiosError.mockReturnValue(false);
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.QBO_CLIENT_ID = 'client-id';
    process.env.QBO_CLIENT_SECRET = 'client-secret';
    process.env.XERO_CLIENT_ID = 'xero-client-id';
    process.env.XERO_CLIENT_SECRET = 'xero-client-secret';
    delete process.env.QBO_REDIRECT_URI;
    delete process.env.XERO_REDIRECT_URI;
  });

  it('uses opaque server-side state and consumes it exactly once', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const stateStore = new FakeOAuthRedis();
    const queue = qboSyncQueue();
    const service = new OAuthService(
      insertCapturingDb(captured),
      crypto,
      stateStore as never,
      queue as never,
    );
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'plain-access-token',
        refresh_token: 'plain-refresh-token',
        expires_in: 3600,
      },
    });

    const url = new URL(await service.getQboAuthUrl(organizationId, userId, sessionId));
    const state = url.searchParams.get('state');
    expect(state).toBe('opaque-state-value');
    expect(state).not.toContain(organizationId);

    await service.completeQboOAuth(state!, 'authorization-code', 'realm-1', userId, sessionId);
    await expect(
      service.completeQboOAuth(state!, 'authorization-code', 'realm-1', userId, sessionId),
    ).rejects.toThrow('Invalid or expired OAuth state');

    const connection = captured.find((values) => 'accessTokenEncrypted' in values)!;
    const audit = captured.find((values) => values.action === 'connected');
    expect(connection.accessTokenEncrypted).not.toBe('plain-access-token');
    expect(connection.refreshTokenEncrypted).not.toBe('plain-refresh-token');
    expect(crypto.decrypt(String(connection.accessTokenEncrypted))).toBe('plain-access-token');
    expect(crypto.decrypt(String(connection.refreshTokenEncrypted))).toBe('plain-refresh-token');
    expect(connection.lastSyncAt).toBeNull();
    expect(audit).toEqual(
      expect.objectContaining({
        organizationId,
        userId,
        entityType: 'integration_connection',
        action: 'connected',
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'initial-sync',
      { kind: 'initial', organizationId },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('keeps the QBO connection durable but exposes an initial-sync enqueue failure', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const stateStore = new FakeOAuthRedis();
    const queue = qboSyncQueue(new Error('Redis unavailable'));
    const service = new OAuthService(
      insertCapturingDb(captured),
      crypto,
      stateStore as never,
      queue as never,
    );
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'plain-access-token',
        refresh_token: 'plain-refresh-token',
        expires_in: 3600,
      },
    });
    const url = new URL(await service.getQboAuthUrl(organizationId, userId, sessionId));

    await expect(
      service.completeQboOAuth(
        url.searchParams.get('state')!,
        'authorization-code',
        'realm-1',
        userId,
        sessionId,
      ),
    ).rejects.toThrow('QBO connection was stored, but its initial import could not be queued');

    expect(captured).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'qbo',
          organizationId,
          realmId: 'realm-1',
          lastSyncAt: null,
        }),
      ]),
    );
  });

  it('removes a failed initial-sync job before enqueueing a fresh import', async () => {
    const failedJob = {
      id: 'failed-initial-sync',
      getState: jest.fn(async () => 'failed'),
      remove: jest.fn(async () => undefined),
    };
    const stateStore = new FakeOAuthRedis();
    const queue = qboSyncQueue(undefined, failedJob);
    const service = new OAuthService(
      insertCapturingDb([]),
      crypto,
      stateStore as never,
      queue as never,
    );
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'plain-access-token',
        refresh_token: 'plain-refresh-token',
        expires_in: 3600,
      },
    });
    const url = new URL(await service.getQboAuthUrl(organizationId, userId, sessionId));

    await service.completeQboOAuth(
      url.searchParams.get('state')!,
      'authorization-code',
      'realm-1',
      userId,
      sessionId,
    );

    expect(failedJob.remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'initial-sync',
      { kind: 'initial', organizationId },
      expect.objectContaining({
        jobId: `qbo-initial-sync-${organizationId}`,
        removeOnFail: true,
      }),
    );
  });

  it('rejects unknown state before exchanging a code', async () => {
    const service = new OAuthService(insertCapturingDb([]), crypto, new FakeOAuthRedis() as never);

    await expect(
      service.completeQboOAuth('unknown', 'authorization-code', 'realm-1', userId, sessionId),
    ).rejects.toThrow('Invalid or expired OAuth state');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('keeps existing passphrase-derived v1 credentials readable', () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'existing-deployment-passphrase';

    const encrypted = crypto.encrypt('existing-token');

    expect(crypto.decrypt(encrypted)).toBe('existing-token');
  });

  it('reads legacy ciphertext while a replacement credential key is configured', () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'existing-deployment-passphrase';
    const encrypted = crypto.encrypt('existing-token');

    process.env.CREDENTIAL_ENCRYPTION_KEY = 'replacement-deployment-passphrase';

    expect(crypto.decrypt(encrypted)).toBe('existing-token');
  });

  it('rejects a callback from a different authenticated session before exchanging the code', async () => {
    const stateStore = new FakeOAuthRedis();
    const service = new OAuthService(insertCapturingDb([]), crypto, stateStore as never);
    const url = new URL(await service.getQboAuthUrl(organizationId, userId, sessionId));

    await expect(
      service.completeQboOAuth(
        url.searchParams.get('state')!,
        'authorization-code',
        'realm-1',
        userId,
        'different-session',
      ),
    ).rejects.toThrow('Invalid or expired OAuth state');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('single-flights concurrent refreshes and lets waiters read the rotated token', async () => {
    let refreshPredicate: unknown;
    const expiredAccessEncrypted = crypto.encrypt('expired-access');
    const connection = {
      id: '00000000-0000-0000-0000-000000000010',
      organizationId,
      provider: 'qbo',
      realmId: 'realm-1',
      realmName: null,
      accessTokenEncrypted: expiredAccessEncrypted,
      refreshTokenEncrypted: crypto.encrypt('refresh-token'),
      accessExpiresAt: new Date(0),
      status: 'active',
      scopes: 'com.intuit.quickbooks.accounting',
      connectedByUserId: userId,
      lastSyncAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const db = {
      query: {
        integrationConnections: {
          findFirst: jest.fn(async () => ({ ...connection })),
        },
      },
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => ({
          where: jest.fn(async (condition: unknown) => {
            refreshPredicate = condition;
            Object.assign(connection, values);
          }),
        })),
      })),
    } as unknown as Db;
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 },
    });
    const service = new OAuthService(db, crypto, new FakeOAuthRedis() as never);

    const [first, second] = await Promise.all([
      service.getQboToken(organizationId),
      service.getQboToken(organizationId),
    ]);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(first?.accessToken).toBe('rotated-access');
    expect(second?.accessToken).toBe('rotated-access');
    const query = new PgDialect().sqlToQuery(refreshPredicate as never);
    expect(query.sql).toContain('"access_token_enc" =');
    expect(query.params).toContain(expiredAccessEncrypted);
  });

  it('single-flights concurrent refreshes after QBO rejects a still-current token', async () => {
    const connection = {
      id: '00000000-0000-0000-0000-000000000010',
      organizationId,
      provider: 'qbo',
      realmId: 'realm-1',
      realmName: null,
      accessTokenEncrypted: crypto.encrypt('rejected-access'),
      refreshTokenEncrypted: crypto.encrypt('refresh-token'),
      accessExpiresAt: new Date(Date.now() + 3_600_000),
      status: 'active',
      scopes: 'com.intuit.quickbooks.accounting',
      connectedByUserId: userId,
      lastSyncAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const db = {
      query: {
        integrationConnections: {
          findFirst: jest.fn(async () => ({ ...connection })),
        },
      },
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => ({
          where: jest.fn(async () => {
            Object.assign(connection, values);
          }),
        })),
      })),
    } as unknown as Db;
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 },
    });
    const service = new OAuthService(db, crypto, new FakeOAuthRedis() as never);

    const [first, second] = await Promise.all([
      service.refreshQboToken(organizationId, 'rejected-access'),
      service.refreshQboToken(organizationId, 'rejected-access'),
    ]);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(first?.accessToken).toBe('rotated-access');
    expect(second?.accessToken).toBe('rotated-access');
  });

  it('returns no token after an invalid refresh marks the connection for reconnection', async () => {
    const connection = {
      id: '00000000-0000-0000-0000-000000000010',
      organizationId,
      provider: 'qbo',
      realmId: 'realm-1',
      realmName: null,
      accessTokenEncrypted: crypto.encrypt('rejected-access'),
      refreshTokenEncrypted: crypto.encrypt('invalid-refresh'),
      accessExpiresAt: new Date(Date.now() + 3_600_000),
      status: 'active',
      scopes: 'com.intuit.quickbooks.accounting',
      connectedByUserId: userId,
      lastSyncAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const transaction = {
      execute: jest.fn(async () => auditProjection),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({ limit: jest.fn(async () => []) })),
            limit: jest.fn(async () => []),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => ({
          where: jest.fn(() => ({
            returning: jest.fn(async () => {
              Object.assign(connection, values);
              return [{ id: connection.id }];
            }),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn((values: Record<string, unknown>) => ({
          returning: jest.fn(async () => [values]),
        })),
      })),
    };
    const db = {
      query: {
        integrationConnections: { findFirst: jest.fn(async () => ({ ...connection })) },
      },
      transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transaction),
      ),
    } as unknown as Db;
    const invalidGrant = Object.assign(new Error('invalid grant'), {
      response: { data: { error: 'invalid_grant' } },
    });
    mockedAxios.post.mockRejectedValue(invalidGrant);
    mockedAxios.isAxiosError.mockImplementation((error: unknown) => error === invalidGrant);
    const service = new OAuthService(db, crypto, new FakeOAuthRedis() as never);

    const result = await service.refreshQboToken(organizationId, 'rejected-access');

    expect(result).toBeNull();
    expect(connection.status).toBe('reconnect_required');
    expect(transaction.insert).toHaveBeenCalled();
  });

  it('does not disable credentials that changed after the rejected request began', async () => {
    const connection = {
      id: '00000000-0000-0000-0000-000000000010',
      organizationId,
      provider: 'qbo',
      accessTokenEncrypted: crypto.encrypt('newly-connected-access'),
      status: 'active',
    };
    const db = {
      query: { integrationConnections: { findFirst: jest.fn(async () => connection) } },
      transaction: jest.fn(),
    } as unknown as Db;
    const service = new OAuthService(db, crypto, new FakeOAuthRedis() as never);

    await service.markQboReconnectRequired(connection.id, 'stale-rejected-access');

    expect((db as unknown as { transaction: jest.Mock }).transaction).not.toHaveBeenCalled();
  });

  it('atomically audits a reconnect transition for the rejected credential version', async () => {
    let predicate: unknown;
    const audits: Array<Record<string, unknown>> = [];
    const encryptedAccessToken = crypto.encrypt('rejected-access');
    const connection = {
      id: '00000000-0000-0000-0000-000000000010',
      organizationId,
      provider: 'qbo',
      accessTokenEncrypted: encryptedAccessToken,
      status: 'active',
    };
    const transaction = {
      execute: jest.fn(async () => auditProjection),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({ limit: jest.fn(async () => []) })),
            limit: jest.fn(async () => []),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn((condition: unknown) => ({
            returning: jest.fn(async () => {
              predicate = condition;
              return [{ id: connection.id }];
            }),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn((values: Record<string, unknown>) => {
          audits.push(values);
          return { returning: jest.fn(async () => [values]) };
        }),
      })),
    };
    const db = {
      query: { integrationConnections: { findFirst: jest.fn(async () => connection) } },
      transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transaction),
      ),
    } as unknown as Db;
    const service = new OAuthService(db, crypto, new FakeOAuthRedis() as never);

    await service.markQboReconnectRequired(connection.id, 'rejected-access');

    const query = new PgDialect().sqlToQuery(predicate as never);
    expect(query.sql).toContain('"access_token_enc" =');
    expect(query.sql).toContain('"status" =');
    expect(query.params).toContain(encryptedAccessToken);
    expect(audits).toEqual([
      expect.objectContaining({
        organizationId,
        userId: null,
        entityType: 'integration_connection',
        entityId: connection.id,
        action: 'reconnect_required',
        metadata: { actor: 'system', provider: 'qbo', reason: 'second_401' },
      }),
    ]);
  });

  it('keeps an active connection retryable after a transient refresh failure', async () => {
    const connection = {
      id: '00000000-0000-0000-0000-000000000010',
      organizationId,
      provider: 'qbo',
      realmId: 'realm-1',
      realmName: null,
      accessTokenEncrypted: crypto.encrypt('expired-access'),
      refreshTokenEncrypted: crypto.encrypt('refresh-token'),
      accessExpiresAt: new Date(0),
      status: 'active',
      scopes: 'com.intuit.quickbooks.accounting',
      connectedByUserId: userId,
      lastSyncAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      query: { integrationConnections: { findFirst: jest.fn(async () => ({ ...connection })) } },
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          updates.push(values);
          return { where: jest.fn(async () => undefined) };
        }),
      })),
    } as unknown as Db;
    mockedAxios.post.mockRejectedValue(new Error('socket timed out'));
    const service = new OAuthService(db, crypto, new FakeOAuthRedis() as never);

    await expect(service.getQboToken(organizationId)).rejects.toThrow('socket timed out');
    expect(updates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'reconnect_required' })]),
    );
  });

  it('requests the exact granular Xero scopes and leaves tenant selection pending', async () => {
    const stateStore = new FakeXeroOAuthRedis();
    const service = new OAuthService(insertCapturingDb([]), crypto, stateStore as never);
    const url = new URL(await service.getXeroAuthUrl(organizationId, userId, sessionId));
    expect(url.searchParams.get('scope')).toBe(XERO_SCOPES.join(' '));

    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'xero-access',
        refresh_token: 'xero-refresh',
        expires_in: 1800,
      },
    });
    mockedAxios.get.mockResolvedValue({
      data: [
        { tenantId: 'tenant-1', tenantName: 'First tenant' },
        { tenantId: 'tenant-2', tenantName: 'Second tenant' },
      ],
    });

    const result = await service.completeXeroOAuth(
      url.searchParams.get('state')!,
      'authorization-code',
      userId,
      sessionId,
    );

    expect(result).toEqual({
      grantId: 'pending-grant',
      tenants: [
        { tenantId: 'tenant-1', tenantName: 'First tenant' },
        { tenantId: 'tenant-2', tenantName: 'Second tenant' },
      ],
    });
    expect(
      await service.getXeroPendingTenants('pending-grant', organizationId, userId, sessionId),
    ).toEqual(result.tenants);
  });

  it('stores only the selected Xero tenant and consumes the pending grant', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const stateStore = new FakeXeroOAuthRedis();
    const service = new OAuthService(insertCapturingDb(captured), crypto, stateStore as never);
    const url = new URL(await service.getXeroAuthUrl(organizationId, userId, sessionId));
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'xero-access',
        refresh_token: 'xero-refresh',
        expires_in: 1800,
        scope: XERO_SCOPES.join(' '),
      },
    });
    mockedAxios.get.mockResolvedValue({ data: [{ tenantId: 'tenant-1', tenantName: 'Tenant 1' }] });

    const { grantId } = await service.completeXeroOAuth(
      url.searchParams.get('state')!,
      'authorization-code',
      userId,
      sessionId,
    );
    await service.selectXeroTenant(grantId, 'tenant-1', organizationId, userId, sessionId);

    const connection = captured.find((values) => 'accessTokenEncrypted' in values);
    expect(connection).toEqual(
      expect.objectContaining({ organizationId, provider: 'xero', realmId: 'tenant-1' }),
    );
    expect(crypto.decrypt(String(connection?.accessTokenEncrypted))).toBe('xero-access');
    expect(crypto.decrypt(String(connection?.refreshTokenEncrypted))).toBe('xero-refresh');
    await expect(
      service.getXeroPendingTenants(grantId, organizationId, userId, sessionId),
    ).rejects.toThrow('Invalid or expired Xero grant');
  });

  it('does not report a failed selection when the grant expires after saving', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const stateStore = new ExpiringAfterSaveXeroOAuthRedis();
    const service = new OAuthService(insertCapturingDb(captured), crypto, stateStore as never);
    const url = new URL(await service.getXeroAuthUrl(organizationId, userId, sessionId));
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'xero-access',
        refresh_token: 'xero-refresh',
        expires_in: 1800,
        scope: XERO_SCOPES.join(' '),
      },
    });
    mockedAxios.get.mockResolvedValue({ data: [{ tenantId: 'tenant-1', tenantName: 'Tenant 1' }] });

    const { grantId } = await service.completeXeroOAuth(
      url.searchParams.get('state')!,
      'authorization-code',
      userId,
      sessionId,
    );

    await expect(
      service.selectXeroTenant(grantId, 'tenant-1', organizationId, userId, sessionId),
    ).resolves.toBeUndefined();
    expect(captured).toEqual(
      expect.arrayContaining([expect.objectContaining({ realmId: 'tenant-1', status: 'active' })]),
    );
  });

  it('keeps a grant bound to its first tenant when cleanup fails after saving', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const stateStore = new FailingAfterSaveXeroOAuthRedis();
    const service = new OAuthService(insertCapturingDb(captured), crypto, stateStore as never);
    const url = new URL(await service.getXeroAuthUrl(organizationId, userId, sessionId));
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'xero-access',
        refresh_token: 'xero-refresh',
        expires_in: 1800,
        scope: XERO_SCOPES.join(' '),
      },
    });
    mockedAxios.get.mockResolvedValue({
      data: [
        { tenantId: 'tenant-1', tenantName: 'Tenant 1' },
        { tenantId: 'tenant-2', tenantName: 'Tenant 2' },
      ],
    });

    const { grantId } = await service.completeXeroOAuth(
      url.searchParams.get('state')!,
      'authorization-code',
      userId,
      sessionId,
    );

    await expect(
      service.selectXeroTenant(grantId, 'tenant-1', organizationId, userId, sessionId),
    ).rejects.toThrow('Redis unavailable while consuming grant');
    await expect(
      service.selectXeroTenant(grantId, 'tenant-2', organizationId, userId, sessionId),
    ).rejects.toThrow('already bound to another tenant');
    await expect(
      service.selectXeroTenant(grantId, 'tenant-1', organizationId, userId, sessionId),
    ).resolves.toBeUndefined();

    expect(captured.filter((values) => 'accessTokenEncrypted' in values)).toEqual(
      expect.arrayContaining([expect.objectContaining({ realmId: 'tenant-1', status: 'active' })]),
    );
    expect(
      captured.filter(
        (values) => values.realmId === 'tenant-2' && 'accessTokenEncrypted' in values,
      ),
    ).toHaveLength(0);
  });

  it('atomically rotates Xero refresh credentials and checks the old refresh version', async () => {
    let refreshPredicate: unknown;
    const audits: Array<Record<string, unknown>> = [];
    const oldRefreshTokenEncrypted = crypto.encrypt('old-refresh');
    const connection = {
      id: '00000000-0000-0000-0000-000000000010',
      organizationId,
      provider: 'xero',
      realmId: 'tenant-1',
      realmName: 'Tenant 1',
      accessTokenEncrypted: crypto.encrypt('expired-access'),
      refreshTokenEncrypted: oldRefreshTokenEncrypted,
      accessExpiresAt: new Date(0),
      status: 'active',
      scopes: XERO_SCOPES.join(' '),
      connectedByUserId: userId,
      lastSyncAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const transaction = {
      ...auditTransaction(audits),
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          Object.assign(connection, values);
          return {
            where: jest.fn((condition: unknown) => {
              refreshPredicate = condition;
              return {
                returning: jest.fn(async () => [{ id: connection.id }]),
              };
            }),
          };
        }),
      })),
    };
    const db = {
      query: {
        integrationConnections: { findFirst: jest.fn(async () => ({ ...connection })) },
      },
      transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transaction),
      ),
    } as unknown as Db;
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 1800 },
    });
    mockedAxios.get.mockResolvedValue({ data: [{ tenantId: 'tenant-1', tenantName: 'Tenant 1' }] });
    const service = new OAuthService(db, crypto, new FakeXeroOAuthRedis() as never);

    const result = await service.getXeroToken(organizationId);

    expect(result).toEqual({
      accessToken: 'rotated-access',
      tenantId: 'tenant-1',
      connectionId: connection.id,
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(refreshPredicate as never);
    expect(query.sql).toContain('"refresh_token_enc" =');
    expect(query.params).toContain(oldRefreshTokenEncrypted);
    expect(audits).toEqual([
      expect.objectContaining({
        organizationId,
        userId: null,
        entityType: 'integration_connection',
        entityId: connection.id,
        action: 'token_refreshed',
        metadata: { actor: 'system', provider: 'xero', reason: 'token_refresh' },
      }),
    ]);
  });

  it('keeps a concurrent Xero refresh usable during the grace window', async () => {
    const connection = {
      id: '00000000-0000-0000-0000-000000000010',
      organizationId,
      provider: 'xero',
      realmId: 'tenant-1',
      realmName: 'Tenant 1',
      accessTokenEncrypted: crypto.encrypt('expired-access'),
      refreshTokenEncrypted: crypto.encrypt('old-refresh'),
      accessExpiresAt: new Date(0),
      status: 'active',
      scopes: XERO_SCOPES.join(' '),
      connectedByUserId: userId,
      lastSyncAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const audits: Array<Record<string, unknown>> = [];
    const postBodies: unknown[] = [];
    let resolveFirstPost!: (response: {
      data: { access_token: string; refresh_token: string; expires_in: number };
    }) => void;
    const firstPost = new Promise<{
      data: { access_token: string; refresh_token: string; expires_in: number };
    }>((resolve) => {
      resolveFirstPost = resolve;
    });
    let rejectSecondPost!: (error: unknown) => void;
    const secondPost = new Promise<never>((_resolve, reject) => {
      rejectSecondPost = reject;
    });
    let resolveFirstPostStarted!: () => void;
    const firstPostStarted = new Promise<void>((resolve) => {
      resolveFirstPostStarted = resolve;
    });
    let resolveSecondPostStarted!: () => void;
    const secondPostStarted = new Promise<void>((resolve) => {
      resolveSecondPostStarted = resolve;
    });
    let resolveFirstPersisted!: () => void;
    const firstPersisted = new Promise<void>((resolve) => {
      resolveFirstPersisted = resolve;
    });

    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post
      .mockImplementationOnce(async (_url, body) => {
        postBodies.push(body);
        resolveFirstPostStarted();
        return firstPost;
      })
      .mockImplementationOnce(async (_url, body) => {
        postBodies.push(body);
        resolveSecondPostStarted();
        return secondPost;
      });
    mockedAxios.get.mockResolvedValue({ data: [{ tenantId: 'tenant-1', tenantName: 'Tenant 1' }] });

    const transaction = {
      ...auditTransaction(audits),
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          Object.assign(connection, values);
          resolveFirstPersisted();
          return {
            where: jest.fn(() => ({
              returning: jest.fn(async () => [{ id: connection.id }]),
            })),
          };
        }),
      })),
    };
    const db = {
      query: {
        integrationConnections: {
          findFirst: jest.fn(async () => ({ ...connection })),
        },
      },
      transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transaction),
      ),
    } as unknown as Db;
    const service = new OAuthService(db, crypto, new ConcurrentXeroOAuthRedis() as never);

    const firstResult = service.getXeroToken(organizationId);
    await firstPostStarted;
    const secondResult = service.getXeroToken(organizationId);
    await secondPostStarted;

    resolveFirstPost({
      data: { access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 1800 },
    });
    await firstPersisted;
    rejectSecondPost({ response: { data: { error: 'invalid_grant' } } });

    const expectedToken = {
      accessToken: 'rotated-access',
      tenantId: 'tenant-1',
      connectionId: connection.id,
    };
    await expect(firstResult).resolves.toEqual(expectedToken);
    await expect(secondResult).resolves.toEqual(expectedToken);
    expect(connection.status).toBe('active');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(postBodies).toHaveLength(2);
    expect(postBodies.every((body) => String(body).includes('refresh_token=old-refresh'))).toBe(
      true,
    );
    expect(transaction.update).toHaveBeenCalledTimes(1);
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'token_refreshed',
        metadata: { actor: 'system', provider: 'xero', reason: 'token_refresh' },
      }),
    ]);
  });

  it('persists rotated Xero credentials before transient tenant discovery', async () => {
    const events: string[] = [];
    const audits: Array<Record<string, unknown>> = [];
    const connection = {
      id: '00000000-0000-0000-0000-000000000010',
      organizationId,
      provider: 'xero',
      realmId: 'tenant-1',
      realmName: 'Tenant 1',
      accessTokenEncrypted: crypto.encrypt('expired-access'),
      refreshTokenEncrypted: crypto.encrypt('old-refresh'),
      accessExpiresAt: new Date(0),
      status: 'active',
      scopes: XERO_SCOPES.join(' '),
      connectedByUserId: userId,
      lastSyncAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const transaction = {
      ...auditTransaction(audits),
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          events.push('persist');
          Object.assign(connection, values);
          return {
            where: jest.fn(() => ({
              returning: jest.fn(async () => [{ id: connection.id }]),
            })),
          };
        }),
      })),
    };
    const db = {
      query: {
        integrationConnections: { findFirst: jest.fn(async () => ({ ...connection })) },
      },
      transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transaction),
      ),
    } as unknown as Db;
    mockedAxios.post.mockImplementation(async () => {
      events.push('refresh');
      return {
        data: {
          access_token: 'rotated-access',
          refresh_token: 'rotated-refresh',
          expires_in: 1800,
        },
      };
    });
    mockedAxios.get.mockImplementation(async () => {
      events.push('discover');
      throw new Error('temporary tenant discovery failure');
    });
    const service = new OAuthService(db, crypto, new FakeXeroOAuthRedis() as never);

    await expect(service.getXeroToken(organizationId)).rejects.toThrow(
      'temporary tenant discovery failure',
    );

    expect(events).toEqual(['refresh', 'persist', 'discover']);
    expect(crypto.decrypt(String(connection.accessTokenEncrypted))).toBe('rotated-access');
    expect(crypto.decrypt(String(connection.refreshTokenEncrypted))).toBe('rotated-refresh');
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'token_refreshed',
        metadata: { actor: 'system', provider: 'xero', reason: 'token_refresh' },
      }),
    ]);

    await expect(service.getXeroToken(organizationId)).resolves.toEqual({
      accessToken: 'rotated-access',
      tenantId: 'tenant-1',
      connectionId: connection.id,
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('revokes Xero credentials when refresh no longer includes the configured tenant', async () => {
    const connection = {
      id: '00000000-0000-0000-0000-000000000010',
      organizationId,
      provider: 'xero',
      realmId: 'tenant-1',
      realmName: 'Tenant 1',
      accessTokenEncrypted: crypto.encrypt('expired-access'),
      refreshTokenEncrypted: crypto.encrypt('old-refresh'),
      accessExpiresAt: new Date(0),
      status: 'active',
      scopes: XERO_SCOPES.join(' '),
      connectedByUserId: userId,
      lastSyncAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const audits: Array<Record<string, unknown>> = [];
    const transaction = {
      ...auditTransaction(audits),
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          Object.assign(connection, values);
          return {
            where: jest.fn(() => ({
              returning: jest.fn(async () => [{ id: connection.id }]),
            })),
          };
        }),
      })),
    };
    const db = {
      query: {
        integrationConnections: { findFirst: jest.fn(async () => ({ ...connection })) },
      },
      transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transaction),
      ),
    } as unknown as Db;
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 1800 },
    });
    mockedAxios.get.mockResolvedValue({
      data: [{ tenantId: 'tenant-2', tenantName: 'Other tenant' }],
    });
    const service = new OAuthService(db, crypto, new FakeXeroOAuthRedis() as never);

    await expect(service.getXeroToken(organizationId)).resolves.toBeNull();
    expect(connection.status).toBe('revoked');
    expect(connection.accessTokenEncrypted).toBeNull();
    expect(connection.refreshTokenEncrypted).toBeNull();
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'revoked',
          metadata: { actor: 'system', provider: 'xero', reason: 'configured_tenant_missing' },
        }),
      ]),
    );
  });

  it('revokes Xero credentials when refresh succeeds but /connections is empty', async () => {
    const connection = {
      id: '00000000-0000-0000-0000-000000000010',
      organizationId,
      provider: 'xero',
      realmId: 'tenant-1',
      realmName: 'Tenant 1',
      accessTokenEncrypted: crypto.encrypt('expired-access'),
      refreshTokenEncrypted: crypto.encrypt('old-refresh'),
      accessExpiresAt: new Date(0),
      status: 'active',
      scopes: XERO_SCOPES.join(' '),
      connectedByUserId: userId,
      lastSyncAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const audits: Array<Record<string, unknown>> = [];
    const transaction = {
      ...auditTransaction(audits),
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          Object.assign(connection, values);
          return {
            where: jest.fn(() => ({
              returning: jest.fn(async () => [{ id: connection.id }]),
            })),
          };
        }),
      })),
    };
    const db = {
      query: {
        integrationConnections: { findFirst: jest.fn(async () => ({ ...connection })) },
      },
      transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transaction),
      ),
    } as unknown as Db;
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 1800 },
    });
    mockedAxios.get.mockResolvedValue({ data: [] });
    const service = new OAuthService(db, crypto, new FakeXeroOAuthRedis() as never);

    await expect(service.getXeroToken(organizationId)).resolves.toBeNull();
    expect(connection.status).toBe('revoked');
    expect(connection.accessTokenEncrypted).toBeNull();
    expect(connection.refreshTokenEncrypted).toBeNull();
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'revoked',
          metadata: { actor: 'system', provider: 'xero', reason: 'empty_connections' },
        }),
      ]),
    );
  });
});
