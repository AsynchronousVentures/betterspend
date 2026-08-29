import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { workflowDefinitionRecordSchema, workflowDefinitionVersionRecordSchema } from './api';

const graph = {
  schemaVersion: 1 as const,
  domain: 'requisition' as const,
  entryNodeId: 'trigger',
  nodes: [
    {
      id: 'trigger',
      name: 'Submitted',
      type: 'trigger' as const,
      config: { event: 'requisition_submitted' as const },
    },
    { id: 'approved', name: 'Approved', type: 'approved' as const, config: {} },
  ],
  edges: [
    {
      id: 'trigger-to-approved',
      sourceNodeId: 'trigger',
      sourceHandle: 'out',
      targetNodeId: 'approved',
      targetHandle: 'in',
    },
  ],
};

const version = {
  id: '00000000-0000-4000-8000-000000000001',
  definitionId: '00000000-0000-4000-8000-000000000002',
  organizationId: '00000000-0000-4000-8000-000000000003',
  version: 1,
  graphJson: graph,
  positionsJson: {},
  notesJson: [],
  executableJson: {
    schemaVersion: 1 as const,
    domain: 'requisition' as const,
    entryStepId: 'trigger',
    steps: [
      { node: graph.nodes[0], transitions: [] },
      { node: graph.nodes[1], transitions: [] },
    ],
  },
  publishedBy: '00000000-0000-4000-8000-000000000004',
  publishedAt: '2026-08-29T12:00:00.000Z',
};

describe('workflow API response contracts', () => {
  it('parses definition and immutable version records', () => {
    assert.equal(workflowDefinitionVersionRecordSchema.parse(version).version, 1);
    const definition = workflowDefinitionRecordSchema.parse({
      id: version.definitionId,
      organizationId: version.organizationId,
      entityId: null,
      domain: 'requisition',
      name: 'Requisition approvals',
      currentDraft: { graph, positions: {}, notes: [] },
      draftFence: 2,
      publishedVersionId: version.id,
      publishedVersion: version,
      createdBy: version.publishedBy,
      updatedBy: version.publishedBy,
      createdAt: version.publishedAt,
      updatedAt: version.publishedAt,
    });
    assert.equal(definition.publishedVersion?.id, version.id);
  });

  it('rejects malformed identifiers and nested drafts', () => {
    assert.equal(
      workflowDefinitionVersionRecordSchema.safeParse({ ...version, id: 'bad' }).success,
      false,
    );
    assert.equal(
      workflowDefinitionRecordSchema.safeParse({
        id: version.definitionId,
        organizationId: version.organizationId,
        entityId: null,
        domain: 'requisition',
        name: 'Broken',
        currentDraft: { graph: { ...graph, nodes: [] }, positions: {}, notes: [] },
        draftFence: 0,
        publishedVersionId: null,
        publishedVersion: null,
        createdBy: version.publishedBy,
        updatedBy: version.publishedBy,
        createdAt: version.publishedAt,
        updatedAt: version.publishedAt,
      }).success,
      false,
    );
  });
});
