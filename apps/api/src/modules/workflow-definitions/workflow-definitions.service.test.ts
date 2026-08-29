import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Db } from '@betterspend/db';
import {
  approvalActions,
  approvalRequests,
  workflowDefinitions,
  workflowDefinitionVersions,
} from '@betterspend/db';
import { workflowDraftSchema } from '@betterspend/shared';
import type { AuditService } from '../audit/audit.service';
import type { EntitiesService } from '../entities/entities.service';
import type { WorkflowDraftLeaseService } from './workflow-draft-lease.service';
import { WorkflowDefinitionsService } from './workflow-definitions.service';

function validDraft() {
  return workflowDraftSchema.parse({
    graph: {
      schemaVersion: 1,
      domain: 'invoice',
      entryNodeId: 'trigger',
      nodes: [
        {
          id: 'trigger',
          name: 'Invoice submitted',
          type: 'trigger',
          config: { event: 'invoice_submitted' },
        },
        { id: 'approved', name: 'Approved', type: 'approved', config: {} },
      ],
      edges: [
        {
          id: 'to-approved',
          sourceNodeId: 'trigger',
          sourceHandle: 'out',
          targetNodeId: 'approved',
          targetHandle: 'in',
        },
      ],
    },
    positions: { trigger: { x: 0, y: 0 }, approved: { x: 200, y: 0 } },
    notes: [{ id: 'review-note', text: 'Confirm finance routing', position: { x: 80, y: 220 } }],
  });
}

function dependencies() {
  const lease = {
    definitionId: '00000000-0000-4000-8000-000000000001',
    holderUserId: '00000000-0000-4000-8000-000000000002',
    holderName: 'Finance editor',
    fence: 1,
    acquiredAt: '2026-08-29T12:00:00.000Z',
    expiresAt: '2099-08-29T12:01:00.000Z',
  };
  return {
    audit: { log: async () => ({}) } as unknown as AuditService,
    entities: { assertBelongsToOrg: async () => {} } as unknown as EntitiesService,
    leases: { assertOwned: async () => lease } as unknown as WorkflowDraftLeaseService,
  };
}

describe('WorkflowDefinitionsService', () => {
  it('publishes the next immutable version with a compiled artifact', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const auditExecutors: unknown[] = [];
    const definition = {
      id: 'definition-1',
      organizationId: 'organization-1',
      draftFence: 1,
      currentDraft: validDraft(),
    };
    const tx = {
      select() {
        return {
          from(table: unknown) {
            if (table === workflowDefinitions) {
              return { where: () => ({ for: async () => [definition] }) };
            }
            return {
              where: () => ({
                orderBy: () => ({ limit: async () => [{ version: 1 }] }),
              }),
            };
          },
        };
      },
      insert(table: unknown) {
        return {
          values(values: Record<string, unknown>) {
            inserted.push(values);
            assert.equal(table, workflowDefinitionVersions);
            return { returning: async () => [{ id: 'version-2', ...values }] };
          },
        };
      },
      update(table: unknown) {
        assert.equal(table, workflowDefinitions);
        return {
          set(values: Record<string, unknown>) {
            updates.push(values);
            return { where: () => ({ returning: async () => [{ id: 'definition-1' }] }) };
          },
        };
      },
    };
    const db = {
      transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as Db;
    const { entities, leases } = dependencies();
    const audit = {
      log: async (...args: unknown[]) => {
        auditExecutors.push(args[7]);
        return {};
      },
    } as unknown as AuditService;
    const service = new WorkflowDefinitionsService(db, entities, audit, leases);

    const result = await service.publish(
      'definition-1',
      'organization-1',
      'publisher-1',
      'publisher-lease-token',
    );

    assert.equal(result.version, 2);
    assert.equal(inserted[0]?.definitionId, 'definition-1');
    assert.deepEqual(inserted[0]?.positionsJson, definition.currentDraft.positions);
    assert.deepEqual(inserted[0]?.notesJson, definition.currentDraft.notes);
    assert.deepEqual(
      (inserted[0]?.executableJson as { steps: Array<{ node: { id: string } }> }).steps.map(
        (step) => step.node.id,
      ),
      ['trigger', 'approved'],
    );
    assert.equal(updates[0]?.publishedVersionId, 'version-2');
    assert.equal(auditExecutors[0], tx);
  });

  it('blocks publication when the mutable draft is invalid', async () => {
    const draft = validDraft();
    draft.graph.edges = [];
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: async () => [
              {
                id: 'definition-1',
                organizationId: 'organization-1',
                draftFence: 1,
                currentDraft: draft,
              },
            ],
          }),
        }),
      }),
    };
    const db = {
      transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as Db;
    const { audit, entities, leases } = dependencies();
    const service = new WorkflowDefinitionsService(db, entities, audit, leases);

    await assert.rejects(
      service.publish('definition-1', 'organization-1', 'publisher-1', 'publisher-lease-token'),
      /not publishable/,
    );
  });

  it('restores a version as draft without changing the published pointer', async () => {
    const updateValues: Array<Record<string, unknown>> = [];
    const draft = validDraft();
    const definition = { id: 'definition-1', organizationId: 'organization-1', draftFence: 1 };
    const tx = {
      select: () => ({
        from: () => ({ where: () => ({ for: async () => [definition] }) }),
      }),
      query: {
        workflowDefinitionVersions: {
          findFirst: async () => ({
            id: 'version-1',
            version: 1,
            graphJson: draft.graph,
            positionsJson: draft.positions,
            notesJson: draft.notes,
          }),
        },
      },
      update: () => ({
        set(values: Record<string, unknown>) {
          updateValues.push(values);
          return { where: () => ({ returning: async () => [{ id: 'definition-1' }] }) };
        },
      }),
    };
    const db = {
      transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as Db;
    const { audit, entities, leases } = dependencies();
    const service = new WorkflowDefinitionsService(db, entities, audit, leases);

    const result = await service.restoreVersion(
      'definition-1',
      'version-1',
      'organization-1',
      'editor-1',
      'editor-lease-token',
    );

    assert.equal(result.restoredFromVersion, 1);
    assert.deepEqual(updateValues[0]?.currentDraft, draft);
    assert.ok(!('publishedVersionId' in updateValues[0]!));
  });

  it('rejects a stale owner before the draft update can run', async () => {
    let updateCalled = false;
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: async () => [
              {
                id: 'definition-1',
                organizationId: 'organization-1',
                domain: 'invoice',
                draftFence: 2,
                currentDraft: validDraft(),
              },
            ],
          }),
        }),
      }),
      update: () => {
        updateCalled = true;
        return {
          set: () => ({
            where: () => ({ returning: async () => [{ id: 'definition-1' }] }),
          }),
        };
      },
    };
    const db = {
      transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as Db;
    const { audit, entities, leases } = dependencies();
    const service = new WorkflowDefinitionsService(db, entities, audit, leases);

    await assert.rejects(
      service.saveDraft('definition-1', 'organization-1', 'editor-1', validDraft(), 'old-token'),
      /fence is stale/,
    );
    assert.equal(updateCalled, false);
  });

  it('restores Redis ownership when takeover audit fails', async () => {
    let persistedFence = 4;
    let restoreCalls = 0;
    const definition = {
      id: 'definition-1',
      organizationId: 'organization-1',
      draftFence: 4,
    };
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({ for: async () => [definition] }),
        }),
      }),
      update: () => ({
        set: (values: { draftFence: number }) => {
          persistedFence = values.draftFence;
          return {
            where: () => ({ returning: async () => [{ id: 'definition-1' }] }),
          };
        },
      }),
    };
    const db = {
      transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => {
        try {
          return await run(tx);
        } catch (error) {
          persistedFence = definition.draftFence;
          throw error;
        }
      },
    } as unknown as Db;
    const takeoverLease = {
      status: {
        state: 'owned' as const,
        lease: {
          definitionId: '00000000-0000-4000-8000-000000000001',
          holderUserId: '00000000-0000-4000-8000-000000000003',
          holderName: 'New editor',
          fence: 5,
          acquiredAt: '2026-08-29T12:00:00.000Z',
          expiresAt: '2099-08-29T12:01:00.000Z',
        },
        leaseToken: 'new-owner-token-123456',
      },
      previous: {
        definitionId: '00000000-0000-4000-8000-000000000001',
        holderUserId: '00000000-0000-4000-8000-000000000002',
        holderName: 'Old editor',
        fence: 4,
        acquiredAt: '2026-08-29T11:00:00.000Z',
        expiresAt: '2099-08-29T11:01:00.000Z',
      },
      restore: async () => {
        restoreCalls += 1;
        return true;
      },
    };
    const leases = {
      takeoverWithResult: async () => takeoverLease,
    } as unknown as WorkflowDraftLeaseService;
    const audit = {
      log: async () => {
        throw new Error('audit failed');
      },
    } as unknown as AuditService;
    const { entities } = dependencies();
    const service = new WorkflowDefinitionsService(db, entities, audit, leases);

    await assert.rejects(
      service.takeoverDraftLease('definition-1', 'organization-1', 'editor-2', 'New editor'),
      /audit failed/,
    );
    assert.equal(restoreCalls, 1);
    assert.equal(persistedFence, 4);
  });
});
