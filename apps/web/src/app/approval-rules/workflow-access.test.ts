import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkflowDraftLeaseStatus } from '@betterspend/shared';
import type { AiProvidersStatusResponse } from '../../lib/api';
import {
  canRestoreWorkflowDraft,
  hasUsableWorkflowAssistant,
  openWorkflowDraftAccess,
  ownsWorkflowDraftLease,
} from './workflow-access';

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

const ownedLease: Extract<WorkflowDraftLeaseStatus, { state: 'owned' }> = {
  state: 'owned',
  leaseToken: 'opaque-editor-token',
  lease: {
    definitionId: '00000000-0000-4000-8000-000000000001',
    holderUserId: '00000000-0000-4000-8000-000000000002',
    holderName: 'Editor',
    fence: 1,
    acquiredAt: '2026-08-29T12:00:00.000Z',
    expiresAt: '2026-08-29T12:01:00.000Z',
  },
};

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
    assert.equal(ownsWorkflowDraftLease(ownedLease), true);
  });

  it('releases a lease that resolves after the editor closes', async () => {
    let active = true;
    let resolveAcquire: ((status: WorkflowDraftLeaseStatus) => void) | undefined;
    const released: string[] = [];
    let loadCalls = 0;
    const opening = openWorkflowDraftAccess('definition-1', {
      status: async () => ({ state: 'available' }),
      acquire: () =>
        new Promise((resolve) => {
          resolveAcquire = resolve;
        }),
      release: async (_definitionId, leaseToken) => {
        released.push(leaseToken);
        return { state: 'available' };
      },
      getDefinition: async () => {
        loadCalls += 1;
        return { id: 'definition-1' };
      },
      isActive: () => active,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    active = false;
    assert.ok(resolveAcquire);
    resolveAcquire(ownedLease);
    const result = await opening;

    assert.deepEqual(released, [ownedLease.leaseToken]);
    assert.equal(loadCalls, 0);
    assert.equal(result.status.state, 'available');
  });

  it('reloads the authoritative definition after acquiring ownership', async () => {
    const calls: string[] = [];
    const result = await openWorkflowDraftAccess('definition-1', {
      status: async () => {
        calls.push('status');
        return { state: 'available' };
      },
      acquire: async () => {
        calls.push('acquire');
        return ownedLease;
      },
      release: async () => ({ state: 'available' }),
      getDefinition: async () => {
        calls.push('get');
        return { id: 'definition-1', revision: 2 };
      },
    });

    assert.deepEqual(calls, ['status', 'acquire', 'get']);
    assert.equal(result.status.state, 'owned');
    assert.deepEqual(result.definition, { id: 'definition-1', revision: 2 });
  });

  it('requires a clean idle editor before restore starts', () => {
    assert.equal(
      canRestoreWorkflowDraft({
        ownsLease: true,
        dirty: false,
        saving: false,
        publishing: false,
        restoring: false,
      }),
      true,
    );
    for (const blocked of ['dirty', 'saving', 'publishing', 'restoring'] as const) {
      assert.equal(
        canRestoreWorkflowDraft({
          ownsLease: true,
          dirty: blocked === 'dirty',
          saving: blocked === 'saving',
          publishing: blocked === 'publishing',
          restoring: blocked === 'restoring',
        }),
        false,
      );
    }
  });
});
