import axios from 'axios';
import type { Db } from '@betterspend/db';
import { CredentialCryptoService } from '../ai-providers/credential-crypto.service';
import { OAuthService } from './oauth.service';
import type { OAuthStateBinding } from './oauth-redis.service';

jest.mock('axios');

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

function insertCapturingDb(captured: Array<Record<string, unknown>>): Db {
  const db = {} as { insert: jest.Mock; transaction: jest.Mock };
  db.insert = jest.fn(() => ({
    values: jest.fn((values: Record<string, unknown>) => {
      captured.push(values);
      return {
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

describe('OAuthService', () => {
  const organizationId = '00000000-0000-0000-0000-000000000001';
  const userId = '00000000-0000-0000-0000-000000000002';
  const sessionId = 'session-1';
  const crypto = new CredentialCryptoService();
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.QBO_CLIENT_ID = 'client-id';
    process.env.QBO_CLIENT_SECRET = 'client-secret';
    delete process.env.QBO_REDIRECT_URI;
  });

  it('uses opaque server-side state and consumes it exactly once', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const stateStore = new FakeOAuthRedis();
    const service = new OAuthService(insertCapturingDb(captured), crypto, stateStore as never);
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
    expect(audit).toEqual(
      expect.objectContaining({
        organizationId,
        userId,
        entityType: 'integration_connection',
        action: 'connected',
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
      service.getQboToken(organizationId),
      service.getQboToken(organizationId),
    ]);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(first?.accessToken).toBe('rotated-access');
    expect(second?.accessToken).toBe('rotated-access');
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
});
