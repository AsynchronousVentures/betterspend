export const AI_PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];
export type AiAuthMethod = 'api_key' | 'oauth';

export interface ProviderDefinition {
  provider: AiProvider;
  label: string;
  defaultModel: string;
  supportsOAuth: boolean;
  dashboardUrl: string;
  modelPlaceholder: string;
}

export interface AiProviderMetadata {
  providerOrganizationId?: string;
  projectId?: string;
  keyLabel?: string;
  keyLimit?: number | null;
  limitRemaining?: number | null;
  usage?: number | null;
  [key: string]: unknown;
}

export interface AiProviderStatus {
  provider: AiProvider;
  label: string;
  connected: boolean;
  enabled: boolean;
  isDefault: boolean;
  supportsOAuth: boolean;
  authMethod: AiAuthMethod | null;
  defaultModel: string;
  maskedCredential?: string;
  status: string;
  lastValidatedAt?: string;
  lastError?: string;
  metadata: AiProviderMetadata;
  dashboardUrl: string;
  modelPlaceholder: string;
  connectedAt?: string;
  updatedAt?: string;
}

export interface AiProviderConnection {
  provider: AiProvider;
  credential: string;
  authMethod: AiAuthMethod;
  defaultModel: string;
  metadata: AiProviderMetadata;
}

export const PROVIDER_DEFINITIONS: Record<AiProvider, ProviderDefinition> = {
  anthropic: {
    provider: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-haiku-4-5-20251001',
    supportsOAuth: false,
    dashboardUrl: 'https://console.anthropic.com/settings/keys',
    modelPlaceholder: 'claude-haiku-4-5-20251001',
  },
  openai: {
    provider: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-5.2',
    supportsOAuth: false,
    dashboardUrl: 'https://platform.openai.com/api-keys',
    modelPlaceholder: 'gpt-5.2',
  },
  openrouter: {
    provider: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'openai/gpt-5.2',
    supportsOAuth: true,
    dashboardUrl: 'https://openrouter.ai/keys',
    modelPlaceholder: 'openai/gpt-5.2',
  },
};

export function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}
