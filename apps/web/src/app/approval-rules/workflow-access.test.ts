import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AiProvidersStatusResponse } from '../../lib/api';
import { hasUsableWorkflowAssistant, ownsWorkflowDraftLease } from './workflow-access';

function provider(overrides: Partial<AiProvidersStatusResponse['providers'][number]> = {}) {
  return {
    provider: 'openai' as const,
    label: 'OpenAI',
    connected: true,
    enabled: true,
    isDefault: false,
    supportsOAuth: false,
    authMethod: 'api_key' as const,
    defaultModel: 'gpt-5',
    status: 'connected',
    metadata: {},
    dashboardUrl: 'https://example.com',
    modelPlaceholder: 'gpt-5',
    ...overrides,
  };
}

describe('workflow editor access', () => {
  it('enables the assistant for any connected and enabled provider', () => {
    assert.equal(
      hasUsableWorkflowAssistant({ defaultProvider: null, providers: [provider()] }),
      true,
    );
    assert.equal(
      hasUsableWorkflowAssistant({
        defaultProvider: null,
        providers: [provider({ enabled: false }), provider({ connected: false })],
      }),
      false,
    );
  });

  it('treats only an owned lease as mutable access', () => {
    assert.equal(ownsWorkflowDraftLease(null), false);
    assert.equal(ownsWorkflowDraftLease({ state: 'available' }), false);
    assert.equal(
      ownsWorkflowDraftLease({
        state: 'owned',
        leaseToken: 'opaque-editor-token',
        lease: {
          definitionId: '00000000-0000-4000-8000-000000000001',
          holderUserId: '00000000-0000-4000-8000-000000000002',
          holderName: 'Editor',
          acquiredAt: '2026-08-29T12:00:00.000Z',
          expiresAt: '2026-08-29T12:01:00.000Z',
        },
      }),
      true,
    );
  });
});
