import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import { and, desc, eq } from 'drizzle-orm';
import { auditLog, integrationConnections, type Db } from '@betterspend/db';
import { INTEGRATION_CONNECTION_STATUS } from '@betterspend/shared';
import { DB_TOKEN } from '../../database/database.module';
import { CredentialCryptoService } from '../ai-providers/credential-crypto.service';
import {
  OAuthRedisService,
  type OAuthProvider,
  type OAuthStateBinding,
} from './oauth-redis.service';

const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_REVOKE_URL = 'https://identity.xero.com/connect/revocation';

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
};

type ConnectionRow = typeof integrationConnections.$inferSelect;

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly crypto: CredentialCryptoService,
    private readonly oauthRedis: OAuthRedisService,
  ) {}

  async getQboAuthUrl(organizationId: string, userId: string, sessionId: string): Promise<string> {
    return this.buildAuthorizationUrl('qbo', {
      provider: 'qbo',
      organizationId,
      userId,
      sessionId,
    });
  }

  async getXeroAuthUrl(organizationId: string, userId: string, sessionId: string): Promise<string> {
    return this.buildAuthorizationUrl('xero', {
      provider: 'xero',
      organizationId,
      userId,
      sessionId,
    });
  }

  async completeQboOAuth(
    state: string,
    code: string,
    realmId: string,
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const binding = await this.consumeState('qbo', state, userId, sessionId);
    if (!code || !realmId) throw new BadRequestException('QBO callback is missing code or realmId');

    const token = await this.exchangeToken('qbo', code);
    await this.saveConnection('qbo', binding, realmId, token);
    this.logger.log(`QBO connection stored for org ${binding.organizationId}, realmId=${realmId}`);
  }

  async completeXeroOAuth(
    state: string,
    code: string,
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const binding = await this.consumeState('xero', state, userId, sessionId);
    if (!code) throw new BadRequestException('Xero callback is missing code');

    const token = await this.exchangeToken('xero', code);
    const response = await axios.get<Array<{ tenantId: string; tenantName?: string }>>(
      'https://api.xero.com/connections',
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    const tenant = response.data[0];
    if (!tenant?.tenantId) throw new BadRequestException('Xero returned no connected tenant');

    await this.saveConnection('xero', binding, tenant.tenantId, token, tenant.tenantName);
    this.logger.log(
      `Xero connection stored for org ${binding.organizationId}, tenantId=${tenant.tenantId}`,
    );
  }

  async getQboToken(
    organizationId: string,
  ): Promise<{ accessToken: string; realmId: string; connectionId: string } | null> {
    const connection = await this.getValidConnection(organizationId, 'qbo');
    if (!connection?.accessTokenEncrypted) return null;
    return {
      accessToken: this.crypto.decrypt(connection.accessTokenEncrypted),
      realmId: connection.realmId,
      connectionId: connection.id,
    };
  }

  async getXeroToken(
    organizationId: string,
  ): Promise<{ accessToken: string; tenantId: string; connectionId: string } | null> {
    const connection = await this.getValidConnection(organizationId, 'xero');
    if (!connection?.accessTokenEncrypted) return null;
    return {
      accessToken: this.crypto.decrypt(connection.accessTokenEncrypted),
      tenantId: connection.realmId,
      connectionId: connection.id,
    };
  }

  async disconnectQbo(organizationId: string, userId: string): Promise<void> {
    await this.disconnect(organizationId, 'qbo', userId);
  }

  async disconnectXero(organizationId: string, userId: string): Promise<void> {
    await this.disconnect(organizationId, 'xero', userId);
  }

  async getConnectionStatus(organizationId: string): Promise<{
    qbo: boolean;
    xero: boolean;
    qboRealmId?: string;
    xeroTenantId?: string;
    qboConfigured: boolean;
    xeroConfigured: boolean;
    qboConnectionMode: 'platform';
    xeroConnectionMode: 'platform';
  }> {
    const [qbo, xero] = await Promise.all([
      this.findConnection(organizationId, 'qbo'),
      this.findConnection(organizationId, 'xero'),
    ]);
    return {
      qbo: qbo?.status === 'active',
      xero: xero?.status === 'active',
      qboRealmId: qbo?.realmId,
      xeroTenantId: xero?.realmId,
      qboConfigured: Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET),
      xeroConfigured: Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET),
      qboConnectionMode: 'platform',
      xeroConnectionMode: 'platform',
    };
  }

  private async buildAuthorizationUrl(
    provider: OAuthProvider,
    binding: OAuthStateBinding,
  ): Promise<string> {
    const state = await this.oauthRedis.createState(binding);
    const isQbo = provider === 'qbo';
    const params = new URLSearchParams({
      client_id: isQbo ? process.env.QBO_CLIENT_ID || '' : process.env.XERO_CLIENT_ID || '',
      scope: this.defaultScopes(provider),
      redirect_uri: this.redirectUri(provider),
      response_type: 'code',
      state,
    });
    return `${isQbo ? QBO_AUTH_URL : XERO_AUTH_URL}?${params}`;
  }

  private async consumeState(
    provider: OAuthProvider,
    state: string,
    userId: string,
    sessionId: string,
  ): Promise<OAuthStateBinding> {
    const binding = await this.oauthRedis.consumeState(state);
    if (
      !binding ||
      binding.provider !== provider ||
      binding.userId !== userId ||
      binding.sessionId !== sessionId
    ) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
    return binding;
  }

  private async exchangeToken(provider: OAuthProvider, code: string): Promise<TokenResponse> {
    const response = await axios.post<TokenResponse>(
      provider === 'qbo' ? QBO_TOKEN_URL : XERO_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri(provider),
      }),
      { headers: this.tokenHeaders(provider) },
    );
    return response.data;
  }

  private async saveConnection(
    provider: OAuthProvider,
    binding: OAuthStateBinding,
    realmId: string,
    token: TokenResponse,
    realmName?: string,
  ): Promise<void> {
    const values = {
      organizationId: binding.organizationId,
      provider,
      realmId,
      realmName: realmName ?? null,
      accessTokenEncrypted: this.crypto.encrypt(token.access_token),
      refreshTokenEncrypted: this.crypto.encrypt(token.refresh_token),
      accessExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      status: INTEGRATION_CONNECTION_STATUS.ACTIVE,
      scopes: token.scope ?? this.defaultScopes(provider),
      connectedByUserId: binding.userId,
      updatedAt: new Date(),
    };
    await this.db.transaction(async (transaction) => {
      const [connection] = await transaction
        .insert(integrationConnections)
        .values(values)
        .onConflictDoUpdate({
          target: [integrationConnections.organizationId, integrationConnections.provider],
          set: values,
        })
        .returning({ id: integrationConnections.id });
      await transaction.insert(auditLog).values({
        organizationId: binding.organizationId,
        userId: binding.userId,
        entityType: 'integration_connection',
        entityId: connection.id,
        action: 'connected',
        changes: { provider, realmId, realmName: realmName ?? null },
      });
    });
  }

  private async getValidConnection(
    organizationId: string,
    provider: OAuthProvider,
  ): Promise<ConnectionRow | null> {
    let connection = await this.findConnection(organizationId, provider);
    if (!connection || connection.status !== 'active') return null;

    if (
      !connection.accessExpiresAt ||
      Date.now() >= connection.accessExpiresAt.getTime() - 60_000
    ) {
      await this.refreshConnection(connection.id, provider);
      connection = await this.findConnectionById(connection.id);
    }
    return connection?.status === 'active' ? connection : null;
  }

  private async refreshConnection(connectionId: string, provider: OAuthProvider): Promise<void> {
    await this.oauthRedis.withLock(`refresh:${connectionId}`, async () => {
      const connection = await this.findConnectionById(connectionId);
      if (!connection || connection.status !== 'active') return;
      if (connection.accessExpiresAt && Date.now() < connection.accessExpiresAt.getTime() - 60_000)
        return;
      if (!connection.refreshTokenEncrypted)
        throw new BadRequestException('Connection has no refresh token');

      try {
        const refreshToken = this.crypto.decrypt(connection.refreshTokenEncrypted);
        const response = await axios.post<TokenResponse>(
          provider === 'qbo' ? QBO_TOKEN_URL : XERO_TOKEN_URL,
          new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
          { headers: this.tokenHeaders(provider) },
        );
        await this.db
          .update(integrationConnections)
          .set({
            accessTokenEncrypted: this.crypto.encrypt(response.data.access_token),
            refreshTokenEncrypted: this.crypto.encrypt(response.data.refresh_token),
            accessExpiresAt: new Date(Date.now() + response.data.expires_in * 1000),
            scopes: response.data.scope ?? connection.scopes,
            status: 'active',
            updatedAt: new Date(),
          })
          .where(eq(integrationConnections.id, connectionId));
      } catch (error: unknown) {
        if (this.isInvalidRefreshToken(error)) {
          await this.db
            .update(integrationConnections)
            .set({ status: 'reconnect_required', updatedAt: new Date() })
            .where(eq(integrationConnections.id, connectionId));
        }
        throw error;
      }
    });
  }

  private async disconnect(
    organizationId: string,
    provider: OAuthProvider,
    userId: string,
  ): Promise<void> {
    const connections = await this.db.query.integrationConnections.findMany({
      where: (connection, { and: andFn, eq: eqFn }) =>
        andFn(eqFn(connection.organizationId, organizationId), eqFn(connection.provider, provider)),
    });
    if (connections.length === 0) return;

    let revocationError: unknown;
    try {
      for (const connection of connections) {
        const encryptedToken = connection.refreshTokenEncrypted ?? connection.accessTokenEncrypted;
        if (!encryptedToken) continue;
        try {
          await this.revoke(provider, this.crypto.decrypt(encryptedToken));
        } catch (error: unknown) {
          revocationError ??= error;
        }
      }
    } finally {
      await this.db.transaction(async (transaction) => {
        const purged = await transaction
          .update(integrationConnections)
          .set({
            accessTokenEncrypted: null,
            refreshTokenEncrypted: null,
            accessExpiresAt: null,
            status: 'revoked',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(integrationConnections.organizationId, organizationId),
              eq(integrationConnections.provider, provider),
            ),
          )
          .returning({ id: integrationConnections.id, realmId: integrationConnections.realmId });
        for (const connection of purged) {
          await transaction.insert(auditLog).values({
            organizationId,
            userId,
            entityType: 'integration_connection',
            entityId: connection.id,
            action: 'disconnected',
            changes: { provider, realmId: connection.realmId },
            metadata: { providerRevoked: !revocationError },
          });
        }
      });
    }
    if (revocationError) throw revocationError;
    this.logger.log(`${provider.toUpperCase()} disconnected for org ${organizationId}`);
  }

  private isInvalidRefreshToken(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false;
    const data = error.response?.data;
    if (!data || typeof data !== 'object') return false;
    const code = 'error' in data ? data.error : undefined;
    return code === 'invalid_grant' || code === 'invalid_token';
  }

  private async revoke(provider: OAuthProvider, token: string): Promise<void> {
    const isQbo = provider === 'qbo';
    await axios.post(
      isQbo ? QBO_REVOKE_URL : XERO_REVOKE_URL,
      isQbo ? { token } : new URLSearchParams({ token }),
      {
        headers: {
          ...this.tokenHeaders(provider),
          'Content-Type': isQbo ? 'application/json' : 'application/x-www-form-urlencoded',
        },
      },
    );
  }

  private findConnection(
    organizationId: string,
    provider: OAuthProvider,
  ): Promise<ConnectionRow | undefined> {
    return this.db.query.integrationConnections.findFirst({
      where: (connection, { and, eq: eqFn }) =>
        and(eqFn(connection.organizationId, organizationId), eqFn(connection.provider, provider)),
      orderBy: (connection) => desc(connection.updatedAt),
    });
  }

  private findConnectionById(id: string): Promise<ConnectionRow | undefined> {
    return this.db.query.integrationConnections.findFirst({
      where: (connection) => eq(connection.id, id),
    });
  }

  private redirectUri(provider: OAuthProvider): string {
    const apiUrl = (process.env.API_URL || 'http://localhost:4001').replace(/\/$/, '');
    const expected = `${apiUrl}/api/v1/gl/oauth/${provider}/callback`;
    const configured =
      provider === 'qbo' ? process.env.QBO_REDIRECT_URI : process.env.XERO_REDIRECT_URI;
    if (configured && configured !== expected) {
      throw new InternalServerErrorException(
        `${provider.toUpperCase()} redirect URI must exactly match ${expected}`,
      );
    }
    return expected;
  }

  private tokenHeaders(provider: OAuthProvider): Record<string, string> {
    const isQbo = provider === 'qbo';
    const credentials = Buffer.from(
      `${isQbo ? process.env.QBO_CLIENT_ID || '' : process.env.XERO_CLIENT_ID || ''}:${
        isQbo ? process.env.QBO_CLIENT_SECRET || '' : process.env.XERO_CLIENT_SECRET || ''
      }`,
    ).toString('base64');
    return {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
  }

  private defaultScopes(provider: OAuthProvider): string {
    return provider === 'qbo'
      ? 'com.intuit.quickbooks.accounting'
      : 'accounting.transactions accounting.contacts accounting.settings offline_access';
  }
}
