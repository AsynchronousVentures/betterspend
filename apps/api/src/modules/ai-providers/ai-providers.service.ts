import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { aiProviderConnections, aiProviderOauthStates } from '@betterspend/db';
import { AuditService } from '../audit/audit.service';
import { CredentialCryptoService } from './credential-crypto.service';
import {
  PROVIDER_DEFINITIONS,
  type AiAuthMethod,
  type AiProvider,
  type AiProviderMetadata,
  type AiProviderStatus,
  isAiProvider,
} from './ai-provider.types';

interface SaveApiKeyInput {
  apiKey?: string;
  defaultModel?: string;
  organizationId?: string;
  projectId?: string;
}

interface UpdateProviderInput {
  defaultModel?: string;
  enabled?: boolean;
  isDefault?: boolean;
}

interface ValidationResult {
  metadata: AiProviderMetadata;
}

@Injectable()
export class AiProvidersService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly credentialCrypto: CredentialCryptoService,
    private readonly auditService: AuditService,
  ) {}

  async getStatus(organizationId: string): Promise<{ defaultProvider: AiProvider | null; providers: AiProviderStatus[] }> {
    const rows = await this.db.query.aiProviderConnections.findMany({
      where: (record, { eq }) => eq(record.organizationId, organizationId),
    });
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    const providers = Object.values(PROVIDER_DEFINITIONS).map((definition) => {
      const row = byProvider.get(definition.provider);
      const metadata = (row?.metadata ?? {}) as AiProviderMetadata;
      return {
        provider: definition.provider,
        label: definition.label,
        connected: Boolean(row),
        enabled: row?.enabled ?? false,
        isDefault: row?.isDefault ?? false,
        supportsOAuth: definition.supportsOAuth,
        authMethod: row ? (row.authMethod === 'oauth' ? 'oauth' : 'api_key') : null,
        defaultModel: row?.defaultModel ?? definition.defaultModel,
        maskedCredential: row?.credentialHint ?? undefined,
        status: row?.status ?? 'not_connected',
        lastValidatedAt: row?.lastValidatedAt?.toISOString(),
        lastError: row?.lastError ?? undefined,
        metadata,
        dashboardUrl: definition.dashboardUrl,
        modelPlaceholder: definition.modelPlaceholder,
        connectedAt: row?.createdAt?.toISOString(),
        updatedAt: row?.updatedAt?.toISOString(),
      } satisfies AiProviderStatus;
    });

    return {
      defaultProvider: providers.find((provider) => provider.connected && provider.enabled && provider.isDefault)?.provider ?? null,
      providers,
    };
  }

  async saveApiKey(
    organizationId: string,
    userId: string,
    providerParam: string,
    input: SaveApiKeyInput,
    authMethod: AiAuthMethod = 'api_key',
  ) {
    const provider = this.parseProvider(providerParam);
    const apiKey = input.apiKey?.trim();
    if (!apiKey) throw new BadRequestException('API key is required');

    const definition = PROVIDER_DEFINITIONS[provider];
    const defaultModel = input.defaultModel?.trim() || definition.defaultModel;
    const providerMetadata: AiProviderMetadata = {};
    if (provider === 'openai') {
      if (input.organizationId?.trim()) providerMetadata.providerOrganizationId = input.organizationId.trim();
      if (input.projectId?.trim()) providerMetadata.projectId = input.projectId.trim();
    }

    const validation = await this.validateCredential(provider, apiKey, providerMetadata);
    const now = new Date();
    const existing = await this.findConnection(organizationId, provider);
    const shouldBeDefault = !existing && !(await this.hasDefaultConnection(organizationId));

    if (shouldBeDefault) await this.clearDefault(organizationId);

    const [connection] = await this.db
      .insert(aiProviderConnections)
      .values({
        organizationId,
        provider,
        authMethod,
        encryptedCredential: this.credentialCrypto.encrypt(apiKey),
        credentialHint: this.maskCredential(apiKey),
        defaultModel,
        enabled: true,
        isDefault: existing?.isDefault ?? shouldBeDefault,
        status: 'connected',
        lastValidatedAt: now,
        lastError: null,
        metadata: { ...providerMetadata, ...validation.metadata },
        createdBy: existing?.createdBy ?? userId,
        updatedBy: userId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [aiProviderConnections.organizationId, aiProviderConnections.provider],
        set: {
          authMethod,
          encryptedCredential: this.credentialCrypto.encrypt(apiKey),
          credentialHint: this.maskCredential(apiKey),
          defaultModel,
          enabled: true,
          status: 'connected',
          lastValidatedAt: now,
          lastError: null,
          metadata: { ...providerMetadata, ...validation.metadata },
          updatedBy: userId,
          updatedAt: now,
        },
      })
      .returning();

    await this.auditConnection(organizationId, userId, connection.id, 'ai_provider_connected', {
      provider,
      authMethod,
      defaultModel,
    });

    return this.getStatus(organizationId);
  }

  async updateProvider(organizationId: string, userId: string, providerParam: string, input: UpdateProviderInput) {
    const provider = this.parseProvider(providerParam);
    const existing = await this.findConnectionOrThrow(organizationId, provider);
    const update: Partial<typeof aiProviderConnections.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: userId,
    };

    if (typeof input.enabled === 'boolean') update.enabled = input.enabled;
    if (input.defaultModel?.trim()) update.defaultModel = input.defaultModel.trim();
    if (input.isDefault === true) {
      await this.clearDefault(organizationId);
      update.isDefault = true;
      update.enabled = true;
    } else if (input.isDefault === false) {
      update.isDefault = false;
    }

    await this.db
      .update(aiProviderConnections)
      .set(update)
      .where(and(eq(aiProviderConnections.id, existing.id), eq(aiProviderConnections.organizationId, organizationId)));

    await this.auditConnection(organizationId, userId, existing.id, 'ai_provider_updated', {
      provider,
      defaultModel: update.defaultModel,
      enabled: update.enabled,
      isDefault: update.isDefault,
    });

    return this.getStatus(organizationId);
  }

  async testProvider(organizationId: string, userId: string, providerParam: string) {
    const provider = this.parseProvider(providerParam);
    const existing = await this.findConnectionOrThrow(organizationId, provider);
    const credential = this.credentialCrypto.decrypt(existing.encryptedCredential);
    const metadata = (existing.metadata ?? {}) as AiProviderMetadata;
    const now = new Date();

    try {
      const validation = await this.validateCredential(provider, credential, metadata);
      await this.db
        .update(aiProviderConnections)
        .set({
          status: 'connected',
          lastValidatedAt: now,
          lastError: null,
          metadata: { ...metadata, ...validation.metadata },
          updatedAt: now,
          updatedBy: userId,
        })
        .where(eq(aiProviderConnections.id, existing.id));
      return { ok: true, provider, checkedAt: now.toISOString() };
    } catch (error) {
      const message = this.formatError(error);
      await this.db
        .update(aiProviderConnections)
        .set({
          status: 'error',
          lastValidatedAt: now,
          lastError: message,
          updatedAt: now,
          updatedBy: userId,
        })
        .where(eq(aiProviderConnections.id, existing.id));
      throw new BadRequestException(message);
    }
  }

  async disconnectProvider(organizationId: string, userId: string, providerParam: string) {
    const provider = this.parseProvider(providerParam);
    const existing = await this.findConnectionOrThrow(organizationId, provider);
    await this.db
      .delete(aiProviderConnections)
      .where(and(eq(aiProviderConnections.id, existing.id), eq(aiProviderConnections.organizationId, organizationId)));

    await this.auditConnection(organizationId, userId, existing.id, 'ai_provider_disconnected', { provider });

    const nextDefault = await this.db.query.aiProviderConnections.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.organizationId, organizationId), eq(record.enabled, true)),
      orderBy: (record, { desc }) => desc(record.updatedAt),
    });
    if (existing.isDefault && nextDefault) {
      await this.clearDefault(organizationId);
      await this.db
        .update(aiProviderConnections)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(aiProviderConnections.id, nextDefault.id));
    }

    return this.getStatus(organizationId);
  }

  async createOpenRouterConnectUrl(organizationId: string, userId: string) {
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(48).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const callbackUrl = `${this.apiUrl}/api/v1/ai-providers/openrouter/oauth/callback?state=${encodeURIComponent(state)}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.db.insert(aiProviderOauthStates).values({
      organizationId,
      provider: 'openrouter',
      state,
      codeVerifier,
      callbackUrl,
      expiresAt,
      createdBy: userId,
    });

    const params = new URLSearchParams({
      callback_url: callbackUrl,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return { url: `https://openrouter.ai/auth?${params.toString()}` };
  }

  async completeOpenRouterOAuth(state: string, code: string) {
    if (!state || !code) throw new BadRequestException('Missing OpenRouter OAuth callback parameters');

    const oauthState = await this.db.query.aiProviderOauthStates.findFirst({
      where: (record, { eq }) => eq(record.state, state),
    });
    if (!oauthState || oauthState.provider !== 'openrouter') {
      throw new BadRequestException('Invalid OpenRouter OAuth state');
    }
    if (oauthState.consumedAt) throw new BadRequestException('OpenRouter OAuth state has already been used');
    if (oauthState.expiresAt.getTime() < Date.now()) throw new BadRequestException('OpenRouter OAuth state expired');

    const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: oauthState.codeVerifier,
        code_challenge_method: 'S256',
      }),
    });
    if (!response.ok) {
      throw new BadRequestException(await this.providerError(response));
    }

    const data = await response.json() as { key?: string };
    if (!data.key) throw new BadRequestException('OpenRouter did not return an API key');

    await this.db
      .update(aiProviderOauthStates)
      .set({ consumedAt: new Date() })
      .where(eq(aiProviderOauthStates.id, oauthState.id));

    await this.saveApiKey(
      oauthState.organizationId,
      oauthState.createdBy ?? '00000000-0000-0000-0000-000000000002',
      'openrouter',
      { apiKey: data.key },
      'oauth',
    );
  }

  private async validateCredential(
    provider: AiProvider,
    credential: string,
    metadata: AiProviderMetadata,
  ): Promise<ValidationResult> {
    if (provider === 'anthropic') return this.validateAnthropic(credential);
    if (provider === 'openai') return this.validateOpenAi(credential, metadata);
    return this.validateOpenRouter(credential);
  }

  private async validateAnthropic(credential: string): Promise<ValidationResult> {
    const response = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: {
        'x-api-key': credential,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!response.ok) throw new BadRequestException(await this.providerError(response));
    return { metadata: {} };
  }

  private async validateOpenAi(credential: string, metadata: AiProviderMetadata): Promise<ValidationResult> {
    const headers: Record<string, string> = { Authorization: `Bearer ${credential}` };
    if (metadata.providerOrganizationId) headers['OpenAI-Organization'] = String(metadata.providerOrganizationId);
    if (metadata.projectId) headers['OpenAI-Project'] = String(metadata.projectId);

    const response = await fetch('https://api.openai.com/v1/models', { headers });
    if (!response.ok) throw new BadRequestException(await this.providerError(response));
    return { metadata };
  }

  private async validateOpenRouter(credential: string): Promise<ValidationResult> {
    const response = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${credential}` },
    });
    if (!response.ok) throw new BadRequestException(await this.providerError(response));
    const data = await response.json() as {
      data?: {
        label?: string;
        limit?: number | null;
        limit_remaining?: number | null;
        usage?: number | null;
      };
    };
    return {
      metadata: {
        keyLabel: data.data?.label,
        keyLimit: data.data?.limit,
        limitRemaining: data.data?.limit_remaining,
        usage: data.data?.usage,
      },
    };
  }

  private async clearDefault(organizationId: string) {
    await this.db
      .update(aiProviderConnections)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(aiProviderConnections.organizationId, organizationId));
  }

  private async hasDefaultConnection(organizationId: string): Promise<boolean> {
    const existing = await this.db.query.aiProviderConnections.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.organizationId, organizationId), eq(record.isDefault, true), eq(record.enabled, true)),
    });
    return Boolean(existing);
  }

  private async findConnection(organizationId: string, provider: AiProvider) {
    return this.db.query.aiProviderConnections.findFirst({
      where: (record, { and, eq }) =>
        and(eq(record.organizationId, organizationId), eq(record.provider, provider)),
    });
  }

  private async findConnectionOrThrow(organizationId: string, provider: AiProvider) {
    const existing = await this.findConnection(organizationId, provider);
    if (!existing) throw new NotFoundException(`${PROVIDER_DEFINITIONS[provider].label} is not connected`);
    return existing;
  }

  private parseProvider(provider: string): AiProvider {
    if (!isAiProvider(provider)) throw new BadRequestException(`Unsupported AI provider: ${provider}`);
    return provider;
  }

  private maskCredential(value: string): string {
    const normalized = value.trim();
    if (normalized.length <= 8) return '****';
    const prefixLength = Math.min(10, Math.max(4, normalized.length - 8));
    return `${normalized.slice(0, prefixLength)}...${normalized.slice(-4)}`;
  }

  private async providerError(response: Response): Promise<string> {
    const body = await response.text().catch(() => '');
    const parsedMessage = this.extractProviderMessage(body);
    return parsedMessage || `${response.status} ${response.statusText}`;
  }

  private extractProviderMessage(body: string): string | null {
    if (!body) return null;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
      if (typeof parsed.error === 'string') return parsed.error;
      if (parsed.error?.message) return parsed.error.message;
      if (parsed.message) return parsed.message;
    } catch {
      // Fall through to raw text.
    }
    return body.slice(0, 240);
  }

  private formatError(error: unknown): string {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object' && 'message' in response) {
        const message = response.message;
        return Array.isArray(message) ? message.join(', ') : String(message);
      }
    }
    return error instanceof Error ? error.message : String(error);
  }

  private async auditConnection(
    organizationId: string,
    userId: string,
    connectionId: string,
    action: string,
    changes?: Record<string, unknown>,
  ) {
    await this.auditService
      .log(organizationId, userId, 'ai_provider_connection', connectionId, action, changes)
      .catch(() => {});
  }

  private get apiUrl(): string {
    return process.env.API_URL || 'http://localhost:4001';
  }
}
