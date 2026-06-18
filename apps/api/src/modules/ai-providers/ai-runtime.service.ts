import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import { Inject } from '@nestjs/common';
import type { Db } from '@betterspend/db';
import { aiProviderConnections } from '@betterspend/db';
import { CredentialCryptoService } from './credential-crypto.service';
import type { AiProviderConnection, AiProviderMetadata } from './ai-provider.types';

type ChatMessage = {
  role: 'user';
  content: string;
};

type VisionMessage = {
  role: 'user';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
};

@Injectable()
export class AiRuntimeService {
  private readonly logger = new Logger(AiRuntimeService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly credentialCrypto: CredentialCryptoService,
  ) {}

  async getDefaultConnection(organizationId: string): Promise<AiProviderConnection | null> {
    const rows = await this.db.query.aiProviderConnections.findMany({
      where: (record, { and, eq }) =>
        and(eq(record.organizationId, organizationId), eq(record.enabled, true)),
      orderBy: (record, { desc }) => [desc(record.isDefault), desc(record.updatedAt)],
      limit: 1,
    });
    const row = rows[0];
    if (!row || !this.isSupportedProvider(row.provider)) return null;

    return {
      provider: row.provider,
      credential: this.credentialCrypto.decrypt(row.encryptedCredential),
      authMethod: row.authMethod === 'oauth' ? 'oauth' : 'api_key',
      defaultModel: row.defaultModel,
      metadata: (row.metadata ?? {}) as AiProviderMetadata,
    };
  }

  async generateText(organizationId: string, prompt: string, maxTokens: number): Promise<string | null> {
    const connection = await this.getDefaultConnection(organizationId);
    if (!connection) return null;

    try {
      if (connection.provider === 'anthropic') {
        return this.callAnthropicText(connection, prompt, maxTokens);
      }
      if (connection.provider === 'openai') {
        return this.callOpenAiText(connection, prompt, maxTokens);
      }
      return this.callOpenRouterText(connection, prompt, maxTokens);
    } catch (error) {
      this.logger.warn(`AI text generation failed for ${connection.provider}: ${this.formatError(error)}`);
      return null;
    }
  }

  async generateVision(
    organizationId: string,
    prompt: string,
    base64Data: string,
    contentType: string,
    maxTokens: number,
  ): Promise<string | null> {
    const connection = await this.getDefaultConnection(organizationId);
    if (!connection) return null;

    try {
      if (connection.provider === 'anthropic') {
        return this.callAnthropicVision(connection, prompt, base64Data, contentType, maxTokens);
      }
      if (connection.provider === 'openai') {
        return this.callOpenAiVision(connection, prompt, base64Data, contentType, maxTokens);
      }
      return this.callOpenRouterVision(connection, prompt, base64Data, contentType, maxTokens);
    } catch (error) {
      this.logger.warn(`AI vision generation failed for ${connection.provider}: ${this.formatError(error)}`);
      return null;
    }
  }

  private async callAnthropicText(
    connection: AiProviderConnection,
    prompt: string,
    maxTokens: number,
  ): Promise<string | null> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': connection.credential,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: connection.defaultModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(await this.providerError(response));
    const data = await response.json() as { content?: Array<{ type?: string; text?: string }> };
    return data.content?.find((item) => item.type === 'text')?.text ?? data.content?.[0]?.text ?? null;
  }

  private async callAnthropicVision(
    connection: AiProviderConnection,
    prompt: string,
    base64Data: string,
    contentType: string,
    maxTokens: number,
  ): Promise<string | null> {
    const mediaType = this.toAnthropicMediaType(contentType);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': connection.credential,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: connection.defaultModel,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(await this.providerError(response));
    const data = await response.json() as { content?: Array<{ type?: string; text?: string }> };
    return data.content?.find((item) => item.type === 'text')?.text ?? data.content?.[0]?.text ?? null;
  }

  private async callOpenAiText(
    connection: AiProviderConnection,
    prompt: string,
    maxTokens: number,
  ): Promise<string | null> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: this.openAiHeaders(connection),
      body: JSON.stringify({
        model: connection.defaultModel,
        input: prompt,
        max_output_tokens: maxTokens,
      }),
    });
    if (!response.ok) throw new Error(await this.providerError(response));
    return this.extractOpenAiResponsesText(await response.json());
  }

  private async callOpenAiVision(
    connection: AiProviderConnection,
    prompt: string,
    base64Data: string,
    contentType: string,
    maxTokens: number,
  ): Promise<string | null> {
    return this.callOpenAiCompatibleChat(
      'https://api.openai.com/v1/chat/completions',
      this.openAiHeaders(connection),
      connection.defaultModel,
      [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${this.safeImageContentType(contentType)};base64,${base64Data}` } },
        ],
      }],
      maxTokens,
    );
  }

  private async callOpenRouterText(
    connection: AiProviderConnection,
    prompt: string,
    maxTokens: number,
  ): Promise<string | null> {
    return this.callOpenAiCompatibleChat(
      'https://openrouter.ai/api/v1/chat/completions',
      this.openRouterHeaders(connection),
      connection.defaultModel,
      [{ role: 'user', content: prompt }],
      maxTokens,
    );
  }

  private async callOpenRouterVision(
    connection: AiProviderConnection,
    prompt: string,
    base64Data: string,
    contentType: string,
    maxTokens: number,
  ): Promise<string | null> {
    return this.callOpenAiCompatibleChat(
      'https://openrouter.ai/api/v1/chat/completions',
      this.openRouterHeaders(connection),
      connection.defaultModel,
      [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${this.safeImageContentType(contentType)};base64,${base64Data}` } },
        ],
      }],
      maxTokens,
    );
  }

  private async callOpenAiCompatibleChat(
    url: string,
    headers: Record<string, string>,
    model: string,
    messages: Array<ChatMessage | VisionMessage>,
    maxTokens: number,
  ): Promise<string | null> {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
    });
    if (!response.ok) throw new Error(await this.providerError(response));
    const data = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    return content?.map((part) => part.text ?? '').join('').trim() || null;
  }

  private openAiHeaders(connection: AiProviderConnection): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${connection.credential}`,
    };
    if (connection.metadata.providerOrganizationId) {
      headers['OpenAI-Organization'] = String(connection.metadata.providerOrganizationId);
    }
    if (connection.metadata.projectId) {
      headers['OpenAI-Project'] = String(connection.metadata.projectId);
    }
    return headers;
  }

  private openRouterHeaders(connection: AiProviderConnection): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${connection.credential}`,
      'HTTP-Referer': process.env.WEB_URL || 'http://localhost:3100',
      'X-Title': 'BetterSpend',
    };
  }

  private extractOpenAiResponsesText(data: unknown): string | null {
    if (data && typeof data === 'object' && 'output_text' in data && typeof data.output_text === 'string') {
      return data.output_text;
    }
    const output = data && typeof data === 'object' && 'output' in data ? data.output : undefined;
    if (!Array.isArray(output)) return null;

    return output
      .flatMap((item) => (item && typeof item === 'object' && 'content' in item && Array.isArray(item.content)) ? item.content : [])
      .map((part) => (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') ? part.text : '')
      .join('')
      .trim() || null;
  }

  private async providerError(response: Response): Promise<string> {
    const body = await response.text().catch(() => '');
    return `${response.status} ${response.statusText}${body ? `: ${body.slice(0, 500)}` : ''}`;
  }

  private toAnthropicMediaType(contentType: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    return (
      ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(contentType)
        ? contentType
        : 'image/jpeg'
    ) as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  }

  private safeImageContentType(contentType: string): string {
    return /^image\/(jpeg|png|gif|webp)$/i.test(contentType) ? contentType : 'image/jpeg';
  }

  private isSupportedProvider(provider: string): provider is AiProviderConnection['provider'] {
    return provider === 'anthropic' || provider === 'openai' || provider === 'openrouter';
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
