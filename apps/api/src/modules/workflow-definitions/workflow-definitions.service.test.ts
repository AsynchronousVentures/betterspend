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
  });
}

function dependencies() {
  return {
    audit: { log: async () => ({}) } as unknown as AuditService,
    entities: { assertBelongsToOrg: async () => {} } as unknown as EntitiesService,
  };
}

describe('WorkflowDefinitionsService', () => {
  it('publishes the next immutable version with a compiled artifact', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const definition = {
      id: 'definition-1',
      organizationId: 'organization-1',
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
            return { where: async () => [] };
          },
        };
      },
    };
    const db = {
      transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as Db;
    const { audit, entities } = dependencies();
    const service = new WorkflowDefinitionsService(db, entities, audit);

    const result = await service.publish('definition-1', 'organization-1', 'publisher-1');

    assert.equal(result.version, 2);
    assert.equal(inserted[0]?.definitionId, 'definition-1');
    assert.deepEqual(inserted[0]?.positionsJson, definition.currentDraft.positions);
    assert.deepEqual(
      (inserted[0]?.executableJson as { steps: Array<{ node: { id: string } }> }).steps.map(
        (step) => step.node.id,
      ),
      ['trigger', 'approved'],
    );
    assert.equal(updates[0]?.publishedVersionId, 'version-2');
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
    const { audit, entities } = dependencies();
    const service = new WorkflowDefinitionsService(db, entities, audit);

    await assert.rejects(
      service.publish('definition-1', 'organization-1', 'publisher-1'),
      /not publishable/,
    );
  });

  it('restores a version as draft without changing the published pointer', async () => {
    const updateValues: Array<Record<string, unknown>> = [];
    const draft = validDraft();
    const definition = { id: 'definition-1', organizationId: 'organization-1' };
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
          }),
        },
      },
      update: () => ({
        set(values: Record<string, unknown>) {
          updateValues.push(values);
          return { where: async () => [] };
        },
      }),
    };
    const db = {
      transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as Db;
    const { audit, entities } = dependencies();
    const service = new WorkflowDefinitionsService(db, entities, audit);

    const result = await service.restoreVersion(
      'definition-1',
      'version-1',
      'organization-1',
      'editor-1',
    );

    assert.equal(result.restoredFromVersion, 1);
    assert.deepEqual(updateValues[0]?.currentDraft, draft);
    assert.ok(!('publishedVersionId' in updateValues[0]!));
  });

  it('cancels and recreates an instance pinned to the latest version', async () => {
    const requestInserts: Array<Record<string, unknown>> = [];
    const actionInserts: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const executable = {
      schemaVersion: 1 as const,
      domain: 'invoice' as const,
      entryStepId: 'trigger',
      steps: [
        {
          node: {
            id: 'trigger',
            name: 'Invoice submitted',
            type: 'trigger' as const,
            disabled: false,
            config: { event: 'invoice_submitted' as const },
          },
          transitions: [],
        },
      ],
    };
    const request = {
      id: 'request-1',
      approvableType: 'invoice',
      approvableId: 'invoice-1',
      definitionVersionId: 'version-1',
      status: 'pending',
      attempt: 1,
      currentStep: 3,
    };
    let definitionSelects = 0;
    const tx = {
      select() {
        return {
          from(table: unknown) {
            if (table === approvalRequests) {
              return { where: () => ({ for: async () => [request] }) };
            }
            if (table === workflowDefinitions) {
              definitionSelects += 1;
              return {
                where: () => ({ for: async () => [{ publishedVersionId: 'version-2' }] }),
              };
            }
            return {
              innerJoin: () => ({
                where: async () => [{ definitionId: 'definition-1' }],
              }),
            };
          },
        };
      },
      query: {
        workflowDefinitionVersions: {
          findFirst: async () => ({
            id: 'version-2',
            definitionId: 'definition-1',
            version: 2,
            executableJson: executable,
          }),
        },
      },
      update: () => ({
        set(values: Record<string, unknown>) {
          updates.push(values);
          return { where: async () => [] };
        },
      }),
      insert(table: unknown) {
        return {
          values(values: Record<string, unknown>) {
            if (table === approvalRequests) {
              requestInserts.push(values);
              return { returning: async () => [{ id: 'request-2', ...values }] };
            }
            assert.equal(table, approvalActions);
            actionInserts.push(values);
            return Promise.resolve();
          },
        };
      },
    };
    const db = {
      transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as Db;
    const { audit, entities } = dependencies();
    const service = new WorkflowDefinitionsService(db, entities, audit);

    const result = await service.restartInstanceOnLatest('request-1', 'organization-1', 'admin-1');

    assert.equal(updates[0]?.status, 'cancelled');
    assert.equal(requestInserts[0]?.definitionVersionId, 'version-2');
    assert.equal(requestInserts[0]?.currentNodeId, 'trigger');
    assert.equal(requestInserts[0]?.attempt, 2);
    assert.equal(definitionSelects, 1);
    assert.equal(actionInserts[0]?.action, 'cancelled');
    assert.equal(actionInserts[1]?.action, 'restarted');
    assert.equal(actionInserts[1]?.approvalRequestId, 'request-2');
    assert.deepEqual(result, {
      cancelledRequestId: 'request-1',
      replacementRequestId: 'request-2',
      definitionVersionId: 'version-2',
      version: 2,
      attempt: 2,
    });
  });
});
