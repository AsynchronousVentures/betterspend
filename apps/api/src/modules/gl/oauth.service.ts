import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import axios from 'axios';
import { and, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import {
  appendAuditLog,
  externalEntityMappings,
  integrationConnections,
  type Db,
} from '@betterspend/db';
import { INTEGRATION_CONNECTION_STATUS } from '@betterspend/shared';
import { DB_TOKEN } from '../../database/database.module';
import {
  findReusableQboInitialSyncJob,
  QBO_INITIAL_SYNC_JOB_NAME,
  qboInitialSyncJobOptions,
  QBO_SYNC_QUEUE_NAME,
} from '../../common/qbo-sync-queue';
import { CredentialCryptoService } from '../ai-providers/credential-crypto.service';
import {
  OAuthRedisService,
  type OAuthLockGuard,
  type OAuthProvider,
  type OAuthStateBinding,
  type XeroPendingGrant,
} from './oauth-redis.service';

const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_REVOKE_URL = 'https://identity.xero.com/connect/revocation';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

export const XERO_SCOPES = [
  'accounting.invoices',
  'accounting.payments',
  'accounting.contacts',
  'accounting.settings',
  'accounting.attachments',
  'offline_access',
] as const;
export const XERO_SCOPE_STRING = XERO_SCOPES.join(' ');
export const XERO_REFRESH_GRACE_MS = 30 * 60 * 1000;

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
};

type ConnectionRow = typeof integrationConnections.$inferSelect;

export type QboToken = {
  accessToken: string;
  realmId: string;
  connectionId: string;
};

export type XeroToken = {
  accessToken: string;
  tenantId: string;
  connectionId: string;
};

export type XeroTenant = {
  tenantId: string;
  tenantName: string | null;
};

export type XeroOAuthResult = {
  grantId: string;
  tenants: readonly XeroTenant[];
};

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly crypto: CredentialCryptoService,
    private readonly oauthRedis: OAuthRedisService,
    @Optional() @InjectQueue(QBO_SYNC_QUEUE_NAME) private readonly qboSyncQueue?: Queue,
    @Optional() @InjectQueue('qbo-cdc') private readonly qboCdcQueue?: Queue,
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
    userId?: string,
    sessionId?: string,
  ): Promise<void> {
    const binding = await this.consumeState('qbo', state, userId, sessionId);
    if (!code || !realmId) throw new BadRequestException('QBO callback is missing code or realmId');

    const token = await this.exchangeToken('qbo', code);
    await this.oauthRedis.withLock(`qbo-sync:${binding.organizationId}`, async (assertHeld) => {
      await assertHeld();
      await this.saveConnection('qbo', binding, realmId, token, undefined, assertHeld);
      await assertHeld();
      await this.enqueueQboInitialSync(binding.organizationId, assertHeld);
    });
    this.logger.log(`QBO connection stored for org ${binding.organizationId}, realmId=${realmId}`);
  }

  async completeXeroOAuth(
    state: string,
    code: string,
    userId?: string,
    sessionId?: string,
  ): Promise<XeroOAuthResult> {
    const binding = await this.consumeState('xero', state, userId, sessionId);
    if (!code) throw new BadRequestException('Xero callback is missing code');

    const token = await this.exchangeToken('xero', code);
    const tenants = await this.fetchXeroTenants(token.access_token);
    if (tenants.length === 0) throw new BadRequestException('Xero returned no connected tenant');

    const grant: XeroPendingGrant = {
      binding,
      accessTokenEncrypted: this.crypto.encrypt(token.access_token),
      refreshTokenEncrypted: this.crypto.encrypt(token.refresh_token),
      accessExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      scopes: this.scopesFor('xero', token.scope),
      tenants,
    };
    const grantId = await this.oauthRedis.createXeroPendingGrant(grant);
    return { grantId, tenants };
  }

  async getXeroPendingTenants(
    grantId: string,
    organizationId: string,
    userId: string,
    sessionId?: string,
  ): Promise<readonly XeroTenant[]> {
    const grant = await this.getAuthorizedXeroGrant(grantId, organizationId, userId, sessionId);
    return grant.tenants;
  }

  /** Claims the selected tenant before saving it, then consumes the one-time grant. */
  async selectXeroTenant(
    grantId: string,
    tenantId: string,
    organizationId: string,
    userId: string,
    sessionId?: string,
  ): Promise<void> {
    await this.oauthRedis.withLock(`xero-grant:${grantId}`, async (assertHeld) => {
      await assertHeld();
      const grant = await this.getAuthorizedXeroGrant(grantId, organizationId, userId, sessionId);
      await assertHeld();
      const tenant = grant.tenants.find((candidate) => candidate.tenantId === tenantId);
      if (!tenant) throw new BadRequestException('Xero tenant is not part of this grant');

      await assertHeld();
      const claim = await this.oauthRedis.claimXeroPendingTenant(grantId, tenant.tenantId);
      if (claim === 'missing') throw new BadRequestException('Invalid or expired Xero grant');
      if (claim === 'conflict') {
        throw new BadRequestException('Xero tenant selection is already bound to another tenant');
      }

      await assertHeld();
      await this.saveConnection(
        'xero',
        grant.binding,
        tenant.tenantId,
        {
          access_token: this.crypto.decrypt(grant.accessTokenEncrypted),
          refresh_token: this.crypto.decrypt(grant.refreshTokenEncrypted),
          expires_in: Math.max(
            1,
            Math.floor((Date.parse(grant.accessExpiresAt) - Date.now()) / 1000),
          ),
          scope: grant.scopes,
        },
        tenant.tenantName ?? undefined,
        assertHeld,
      );
      await assertHeld();
      const consumed = await this.oauthRedis.completeXeroPendingGrant(grantId, tenant.tenantId);
      if (!consumed) {
        this.logger.log(
          `Xero connection stored for org ${organizationId}, but the pending grant expired`,
        );
        return;
      }
      this.logger.log(
        `Xero connection stored for org ${organizationId}, tenantId=${tenant.tenantId}`,
      );
    });
  }

  private async getAuthorizedXeroGrant(
    grantId: string,
    organizationId: string,
    userId: string,
    sessionId?: string,
  ): Promise<XeroPendingGrant> {
    const grant = await this.oauthRedis.getXeroPendingGrant(grantId);
    if (
      !grant ||
      grant.binding.provider !== 'xero' ||
      grant.binding.organizationId !== organizationId ||
      grant.binding.userId !== userId ||
      (sessionId !== undefined && grant.binding.sessionId !== sessionId)
    ) {
      throw new BadRequestException('Invalid or expired Xero grant');
    }
    return grant;
  }

  private async fetchXeroTenants(accessToken: string): Promise<readonly XeroTenant[]> {
    const response = await axios.get<unknown>(XERO_CONNECTIONS_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!Array.isArray(response.data)) return [];
    return response.data.flatMap((value): XeroTenant[] => {
      if (!isRecord(value) || typeof value.tenantId !== 'string' || value.tenantId.length === 0) {
        return [];
      }
      return [
        {
          tenantId: value.tenantId,
          tenantName: typeof value.tenantName === 'string' ? value.tenantName : null,
        },
      ];
    });
  }

  async getQboToken(organizationId: string): Promise<QboToken | null> {
    const connection = await this.getValidConnection(organizationId, 'qbo');
    return this.toQboToken(connection);
  }

  /** Rotates a rejected QBO token once, while concurrent callers share the same refresh. */
  async refreshQboToken(
    organizationId: string,
    rejectedAccessToken: string,
  ): Promise<QboToken | null> {
    const connection = await this.findConnection(organizationId, 'qbo');
    if (!connection || connection.status !== 'active') return null;

    await this.refreshConnection(connection.id, 'qbo', rejectedAccessToken);
    return this.toQboToken(await this.findConnectionById(connection.id));
  }

  async markQboReconnectRequired(connectionId: string, rejectedAccessToken: string): Promise<void> {
    const connection = await this.findConnectionById(connectionId);
    if (
      !connection?.accessTokenEncrypted ||
      connection.provider !== 'qbo' ||
      connection.status !== INTEGRATION_CONNECTION_STATUS.ACTIVE ||
      this.crypto.decrypt(connection.accessTokenEncrypted) !== rejectedAccessToken
    ) {
      return;
    }

    await this.transitionToReconnectRequired(connection, 'second_401');
  }

  async getXeroToken(organizationId: string): Promise<XeroToken | null> {
    const connection = await this.getValidConnection(organizationId, 'xero');
    return this.toXeroToken(connection);
  }

  /** Rotates one Xero grant, sharing the Redis-serialized refresh with all callers. */
  async refreshXeroToken(
    organizationId: string,
    rejectedAccessToken: string,
  ): Promise<XeroToken | null> {
    const connection = await this.findConnection(organizationId, 'xero');
    if (!connection || connection.status !== INTEGRATION_CONNECTION_STATUS.ACTIVE) return null;

    await this.refreshConnection(connection.id, 'xero', rejectedAccessToken);
    return this.toXeroToken(await this.findConnectionById(connection.id));
  }

  async markXeroReconnectRequired(
    connectionId: string,
    rejectedAccessToken: string,
  ): Promise<void> {
    const connection = await this.findConnectionById(connectionId);
    if (
      !connection?.accessTokenEncrypted ||
      connection.provider !== 'xero' ||
      connection.status !== INTEGRATION_CONNECTION_STATUS.ACTIVE ||
      this.crypto.decrypt(connection.accessTokenEncrypted) !== rejectedAccessToken
    ) {
      return;
    }

    await this.transitionToReconnectRequired(connection, 'second_401');
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
    userId?: string,
    sessionId?: string,
  ): Promise<OAuthStateBinding> {
    const binding = await this.oauthRedis.consumeState(state);
    if (
      !binding ||
      binding.provider !== provider ||
      (userId !== undefined && binding.userId !== userId) ||
      (sessionId !== undefined && binding.sessionId !== sessionId) ||
      (userId === undefined) !== (sessionId === undefined)
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
    assertHeld?: OAuthLockGuard,
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
      scopes: this.scopesFor(provider, token.scope),
      connectedByUserId: binding.userId,
      ...(provider === 'qbo' ? { lastSyncAt: null } : {}),
      updatedAt: new Date(),
    };
    await assertHeld?.();
    await this.db.transaction(async (transaction) => {
      await assertHeld?.();
      if (provider === 'qbo') {
        const [existingConnection] = await transaction
          .select({ id: integrationConnections.id, realmId: integrationConnections.realmId })
          .from(integrationConnections)
          .where(
            and(
              eq(integrationConnections.organizationId, binding.organizationId),
              eq(integrationConnections.provider, provider),
            ),
          )
          .for('update')
          .limit(1);

        if (existingConnection && existingConnection.realmId !== realmId) {
          const linkedMappings = await transaction
            .select({
              id: externalEntityMappings.id,
              localId: externalEntityMappings.localId,
              localKey: externalEntityMappings.localKey,
              isDefault: externalEntityMappings.isDefault,
              autoCreated: externalEntityMappings.autoCreated,
            })
            .from(externalEntityMappings)
            .where(
              and(
                eq(externalEntityMappings.organizationId, binding.organizationId),
                eq(externalEntityMappings.connectionId, existingConnection.id),
                eq(externalEntityMappings.provider, 'qbo'),
                eq(externalEntityMappings.direction, 'inbound'),
                or(
                  isNotNull(externalEntityMappings.localId),
                  isNotNull(externalEntityMappings.localKey),
                  eq(externalEntityMappings.isDefault, true),
                  eq(externalEntityMappings.autoCreated, true),
                ),
              ),
            )
            .for('update');

          if (linkedMappings.length > 0) {
            const resetAt = new Date();
            await assertHeld?.();
            await transaction
              .update(externalEntityMappings)
              .set({
                localId: null,
                localKey: null,
                isDefault: false,
                autoCreated: false,
                updatedAt: resetAt,
              })
              .where(
                and(
                  eq(externalEntityMappings.organizationId, binding.organizationId),
                  eq(externalEntityMappings.connectionId, existingConnection.id),
                  eq(externalEntityMappings.provider, 'qbo'),
                  eq(externalEntityMappings.direction, 'inbound'),
                  or(
                    isNotNull(externalEntityMappings.localId),
                    isNotNull(externalEntityMappings.localKey),
                    eq(externalEntityMappings.isDefault, true),
                    eq(externalEntityMappings.autoCreated, true),
                  ),
                ),
              )
              .returning({ id: externalEntityMappings.id });

            for (const mapping of linkedMappings) {
              await assertHeld?.();
              await appendAuditLog(transaction, {
                organizationId: binding.organizationId,
                userId: binding.userId,
                entityType: 'external_entity_mapping',
                entityId: mapping.id,
                action: 'unlinked',
                changes: {
                  localId: { from: mapping.localId, to: null },
                  localKey: { from: mapping.localKey, to: null },
                  isDefault: { from: mapping.isDefault, to: false },
                  autoCreated: { from: mapping.autoCreated, to: false },
                },
                metadata: {
                  actor: binding.userId ? 'user' : 'system',
                  provider: 'qbo',
                  source: 'oauth',
                  reason: 'realm_changed',
                },
                createdAt: resetAt,
              });
            }
          }
        }
      }
      await assertHeld?.();
      const [connection] = await transaction
        .insert(integrationConnections)
        .values(values)
        .onConflictDoUpdate({
          target: [integrationConnections.organizationId, integrationConnections.provider],
          set: values,
        })
        .returning({ id: integrationConnections.id });
      await assertHeld?.();
      await appendAuditLog(transaction, {
        organizationId: binding.organizationId,
        userId: binding.userId,
        entityType: 'integration_connection',
        entityId: connection.id,
        action: 'connected',
        changes: { provider, realmId, realmName: realmName ?? null },
      });
    });
  }

  private async enqueueQboInitialSync(
    organizationId: string,
    assertHeld?: OAuthLockGuard,
  ): Promise<void> {
    if (!this.qboSyncQueue) {
      this.logger.error(
        `Unable to queue initial QBO sync for ${organizationId}: QBO sync queue is unavailable`,
      );
      return;
    }
    const options = qboInitialSyncJobOptions(organizationId);
    let existing: { id: string | undefined } | null;
    try {
      existing = await findReusableQboInitialSyncJob(this.qboSyncQueue, organizationId, assertHeld);
    } catch (error: unknown) {
      await assertHeld?.();
      this.logger.error(`Unable to queue initial QBO sync for ${organizationId}: ${String(error)}`);
      return;
    }
    if (existing) return;

    await assertHeld?.();
    try {
      await this.qboSyncQueue.add(
        QBO_INITIAL_SYNC_JOB_NAME,
        { kind: 'initial', organizationId },
        options,
      );
    } catch (error: unknown) {
      this.logger.error(`Unable to queue initial QBO sync for ${organizationId}: ${String(error)}`);
    }
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

  private async refreshConnection(
    connectionId: string,
    provider: OAuthProvider,
    rejectedAccessToken?: string,
  ): Promise<void> {
    await this.oauthRedis.withLock(`refresh:${connectionId}`, async (assertHeld) => {
      await assertHeld();
      const connection = await this.findConnectionById(connectionId);
      await assertHeld();
      if (!connection || connection.status !== 'active') return;
      const encryptedAccessToken = connection.accessTokenEncrypted;
      const accessToken = encryptedAccessToken ? this.crypto.decrypt(encryptedAccessToken) : null;
      if (rejectedAccessToken) {
        if (accessToken !== rejectedAccessToken) return;
      } else if (
        connection.accessExpiresAt &&
        Date.now() < connection.accessExpiresAt.getTime() - 60_000
      ) {
        return;
      }
      if (!connection.refreshTokenEncrypted)
        throw new BadRequestException('Connection has no refresh token');

      const encryptedRefreshToken = connection.refreshTokenEncrypted;
      try {
        await assertHeld();
        const refreshToken = this.crypto.decrypt(encryptedRefreshToken);
        await assertHeld();
        const response = await axios.post<TokenResponse>(
          provider === 'qbo' ? QBO_TOKEN_URL : XERO_TOKEN_URL,
          new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
          { headers: this.tokenHeaders(provider) },
        );
        if (provider === 'xero') {
          if (!response.data.refresh_token) {
            throw new Error('Xero token refresh did not return a rotated refresh token');
          }
          const persisted = await this.persistXeroRefresh(
            connection,
            encryptedAccessToken,
            encryptedRefreshToken,
            response.data,
          );
          if (!persisted) return;

          await assertHeld();
          const tenants = await this.fetchXeroTenants(response.data.access_token);
          await assertHeld();
          const configuredTenantStillAvailable = tenants.some(
            (tenant) => tenant.tenantId === connection.realmId,
          );
          if (!configuredTenantStillAvailable) {
            await assertHeld();
            const latest = await this.findConnectionById(connection.id);
            await assertHeld();
            if (latest) {
              await this.transitionToRevoked(
                latest,
                tenants.length === 0 ? 'empty_connections' : 'configured_tenant_missing',
                assertHeld,
              );
            }
            return;
          }
          return;
        }

        await assertHeld();
        await this.db
          .update(integrationConnections)
          .set({
            accessTokenEncrypted: this.crypto.encrypt(response.data.access_token),
            refreshTokenEncrypted: this.crypto.encrypt(response.data.refresh_token),
            accessExpiresAt: new Date(Date.now() + response.data.expires_in * 1000),
            scopes: this.scopesFor(provider, response.data.scope ?? connection.scopes),
            status: 'active',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(integrationConnections.id, connectionId),
              eq(integrationConnections.provider, provider),
              eq(integrationConnections.status, INTEGRATION_CONNECTION_STATUS.ACTIVE),
              encryptedAccessToken
                ? eq(integrationConnections.accessTokenEncrypted, encryptedAccessToken)
                : isNull(integrationConnections.accessTokenEncrypted),
              eq(integrationConnections.refreshTokenEncrypted, encryptedRefreshToken),
            ),
          );
        await assertHeld();
      } catch (error: unknown) {
        if (this.isInvalidRefreshToken(error)) {
          if (
            await this.wasXeroRefreshRotatedRecently(connection, encryptedRefreshToken, assertHeld)
          ) {
            return;
          }
          await assertHeld();
          await this.transitionToReconnectRequired(connection, 'invalid_refresh_token', assertHeld);
          return;
        }
        throw error;
      }
    });
  }

  private async persistXeroRefresh(
    connection: ConnectionRow,
    encryptedAccessToken: string | null,
    encryptedRefreshToken: string,
    token: TokenResponse,
    assertHeld?: OAuthLockGuard,
  ): Promise<boolean> {
    await assertHeld?.();
    return this.db.transaction(async (transaction) => {
      await assertHeld?.();
      const [updated] = await transaction
        .update(integrationConnections)
        .set({
          accessTokenEncrypted: this.crypto.encrypt(token.access_token),
          refreshTokenEncrypted: this.crypto.encrypt(token.refresh_token),
          accessExpiresAt: new Date(Date.now() + token.expires_in * 1000),
          scopes: this.scopesFor('xero', token.scope ?? connection.scopes),
          status: INTEGRATION_CONNECTION_STATUS.ACTIVE,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(integrationConnections.id, connection.id),
            eq(integrationConnections.provider, 'xero'),
            eq(integrationConnections.status, INTEGRATION_CONNECTION_STATUS.ACTIVE),
            encryptedAccessToken
              ? eq(integrationConnections.accessTokenEncrypted, encryptedAccessToken)
              : isNull(integrationConnections.accessTokenEncrypted),
            eq(integrationConnections.refreshTokenEncrypted, encryptedRefreshToken),
          ),
        )
        .returning({ id: integrationConnections.id });
      if (!updated) return false;

      await assertHeld?.();
      await appendAuditLog(transaction, {
        organizationId: connection.organizationId,
        userId: null,
        entityType: 'integration_connection',
        entityId: connection.id,
        action: 'token_refreshed',
        changes: { accessTokenRotated: true, refreshTokenRotated: true },
        metadata: { actor: 'system', provider: 'xero', reason: 'token_refresh' },
      });
      return true;
    });
  }

  private async wasXeroRefreshRotatedRecently(
    connection: ConnectionRow,
    encryptedRefreshToken: string,
    assertHeld?: OAuthLockGuard,
  ): Promise<boolean> {
    if (connection.provider !== 'xero') return false;
    await assertHeld?.();
    const latest = await this.findConnectionById(connection.id);
    await assertHeld?.();
    if (!latest || latest.status !== INTEGRATION_CONNECTION_STATUS.ACTIVE) return false;
    if (latest.refreshTokenEncrypted === encryptedRefreshToken) return false;
    return !latest.updatedAt || Date.now() - latest.updatedAt.getTime() <= XERO_REFRESH_GRACE_MS;
  }

  private async disconnect(
    organizationId: string,
    provider: OAuthProvider,
    userId: string,
  ): Promise<void> {
    const run = async (assertHeld?: OAuthLockGuard): Promise<void> => {
      await assertHeld?.();
      const connections = await this.db.query.integrationConnections.findMany({
        where: (connection, { and: andFn, eq: eqFn }) =>
          andFn(
            eqFn(connection.organizationId, organizationId),
            eqFn(connection.provider, provider),
          ),
      });
      await assertHeld?.();
      if (connections.length === 0) return;

      if (provider === 'qbo') {
        await assertHeld?.();
        await this.removeQboSchedules(organizationId, assertHeld);
      }

      let revocationError: unknown;
      try {
        for (const connection of connections) {
          const encryptedToken =
            connection.refreshTokenEncrypted ?? connection.accessTokenEncrypted;
          if (!encryptedToken) continue;
          try {
            await assertHeld?.();
            await this.revoke(provider, this.crypto.decrypt(encryptedToken));
            await assertHeld?.();
          } catch (error: unknown) {
            revocationError ??= error;
          }
        }
      } finally {
        await assertHeld?.();
        await this.db.transaction(async (transaction) => {
          await assertHeld?.();
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
            await assertHeld?.();
            await appendAuditLog(transaction, {
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
    };

    if (provider === 'qbo') {
      await this.oauthRedis.withLock(`qbo-sync:${organizationId}`, run);
      return;
    }
    await run();
  }

  private async removeQboSchedules(
    organizationId: string,
    assertHeld?: OAuthLockGuard,
  ): Promise<void> {
    await Promise.all([
      this.removeQboSchedule(this.qboSyncQueue, `qbo-hourly-sync-${organizationId}`, assertHeld),
      this.removeQboSchedule(this.qboCdcQueue, `qbo-daily-cdc-${organizationId}`, assertHeld),
    ]);
  }

  private async removeQboSchedule(
    queue: Queue | undefined,
    jobId: string,
    assertHeld?: OAuthLockGuard,
  ): Promise<void> {
    if (!queue) return;
    await assertHeld?.();
    const repeatableJobs = await queue.getRepeatableJobs();
    await Promise.all(
      repeatableJobs
        .filter((job) => job.id === jobId || job.key === jobId)
        .map(async (job) => {
          await assertHeld?.();
          await queue.removeRepeatableByKey(job.key);
        }),
    );
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

  private toQboToken(connection: ConnectionRow | null | undefined): QboToken | null {
    if (
      !connection?.accessTokenEncrypted ||
      connection.provider !== 'qbo' ||
      connection.status !== INTEGRATION_CONNECTION_STATUS.ACTIVE
    ) {
      return null;
    }
    return {
      accessToken: this.crypto.decrypt(connection.accessTokenEncrypted),
      realmId: connection.realmId,
      connectionId: connection.id,
    };
  }

  private toXeroToken(connection: ConnectionRow | null | undefined): XeroToken | null {
    if (
      !connection?.accessTokenEncrypted ||
      connection.provider !== 'xero' ||
      connection.status !== INTEGRATION_CONNECTION_STATUS.ACTIVE
    ) {
      return null;
    }
    return {
      accessToken: this.crypto.decrypt(connection.accessTokenEncrypted),
      tenantId: connection.realmId,
      connectionId: connection.id,
    };
  }

  private async transitionToReconnectRequired(
    connection: Pick<
      ConnectionRow,
      'id' | 'organizationId' | 'provider' | 'accessTokenEncrypted' | 'status'
    >,
    reason: 'invalid_refresh_token' | 'second_401',
    assertHeld?: OAuthLockGuard,
  ): Promise<void> {
    const encryptedAccessToken = connection.accessTokenEncrypted;
    if (!encryptedAccessToken || connection.status !== 'active') return;

    await assertHeld?.();
    await this.db.transaction(async (transaction) => {
      await assertHeld?.();
      const [updated] = await transaction
        .update(integrationConnections)
        .set({ status: INTEGRATION_CONNECTION_STATUS.RECONNECT_REQUIRED, updatedAt: new Date() })
        .where(
          and(
            eq(integrationConnections.id, connection.id),
            eq(integrationConnections.provider, connection.provider),
            eq(integrationConnections.status, INTEGRATION_CONNECTION_STATUS.ACTIVE),
            eq(integrationConnections.accessTokenEncrypted, encryptedAccessToken),
          ),
        )
        .returning({ id: integrationConnections.id });
      if (!updated) return;

      await assertHeld?.();
      await appendAuditLog(transaction, {
        organizationId: connection.organizationId,
        userId: null,
        entityType: 'integration_connection',
        entityId: connection.id,
        action: 'reconnect_required',
        changes: {
          status: {
            from: INTEGRATION_CONNECTION_STATUS.ACTIVE,
            to: INTEGRATION_CONNECTION_STATUS.RECONNECT_REQUIRED,
          },
        },
        metadata: { actor: 'system', provider: connection.provider, reason },
      });
    });
  }

  private async transitionToRevoked(
    connection: Pick<
      ConnectionRow,
      'id' | 'organizationId' | 'provider' | 'accessTokenEncrypted' | 'status' | 'realmId'
    >,
    reason: 'empty_connections' | 'configured_tenant_missing',
    assertHeld?: OAuthLockGuard,
  ): Promise<void> {
    const encryptedAccessToken = connection.accessTokenEncrypted;
    if (!encryptedAccessToken || connection.status !== INTEGRATION_CONNECTION_STATUS.ACTIVE) return;

    await assertHeld?.();
    await this.db.transaction(async (transaction) => {
      await assertHeld?.();
      const [updated] = await transaction
        .update(integrationConnections)
        .set({
          accessTokenEncrypted: null,
          refreshTokenEncrypted: null,
          accessExpiresAt: null,
          status: INTEGRATION_CONNECTION_STATUS.REVOKED,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(integrationConnections.id, connection.id),
            eq(integrationConnections.provider, 'xero'),
            eq(integrationConnections.status, INTEGRATION_CONNECTION_STATUS.ACTIVE),
            eq(integrationConnections.accessTokenEncrypted, encryptedAccessToken),
          ),
        )
        .returning({ id: integrationConnections.id });
      if (!updated) return;

      await assertHeld?.();
      await appendAuditLog(transaction, {
        organizationId: connection.organizationId,
        userId: null,
        entityType: 'integration_connection',
        entityId: connection.id,
        action: 'revoked',
        changes: {
          status: {
            from: INTEGRATION_CONNECTION_STATUS.ACTIVE,
            to: INTEGRATION_CONNECTION_STATUS.REVOKED,
          },
          realmId: connection.realmId,
        },
        metadata: { actor: 'system', provider: 'xero', reason },
      });
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
    return provider === 'qbo' ? 'com.intuit.quickbooks.accounting' : XERO_SCOPE_STRING;
  }

  private scopesFor(provider: OAuthProvider, grantedScopes?: string | null): string {
    if (provider === 'qbo') return grantedScopes ?? this.defaultScopes(provider);
    const granted = new Set((grantedScopes ?? '').split(/\s+/).filter(Boolean));
    const scopes = XERO_SCOPES.filter((scope) => granted.size === 0 || granted.has(scope));
    return scopes.length > 0 ? scopes.join(' ') : this.defaultScopes(provider);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
