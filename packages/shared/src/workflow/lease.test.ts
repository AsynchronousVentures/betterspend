import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { leasedWorkflowDraftUpdateSchema, workflowDraftLeaseStatusSchema } from './index';

const lease = {
  definitionId: '00000000-0000-4000-8000-000000000001',
  holderUserId: '00000000-0000-4000-8000-000000000002',
  editorInstanceId: '00000000-0000-4000-8000-000000000003',
  holderName: 'Finance editor',
  fence: 1,
  acquiredAt: '2026-08-29T12:00:00.000Z',
  expiresAt: '2026-08-29T12:01:00.000Z',
};

describe('workflow draft lease contract', () => {
  it('distinguishes available, held, and owned editor states', () => {
    assert.equal(workflowDraftLeaseStatusSchema.parse({ state: 'available' }).state, 'available');
    const { editorInstanceId: _privateEditorInstanceId, ...heldLease } = lease;
    assert.equal(_privateEditorInstanceId, lease.editorInstanceId);
    const held = workflowDraftLeaseStatusSchema.parse({ state: 'held', lease: heldLease });
    assert.equal(held.state, 'held');
    if (held.state === 'held') assert.equal('editorInstanceId' in held.lease, false);
    assert.equal(
      workflowDraftLeaseStatusSchema.parse({
        state: 'owned',
        lease,
        leaseToken: 'opaque-editor-token',
      }).state,
      'owned',
    );
  });

  it('requires an editor instance and lease token at the autosave boundary', () => {
    const result = leasedWorkflowDraftUpdateSchema.safeParse({
      draft: {
        graph: {
          schemaVersion: 1,
          domain: 'requisition',
          entryNodeId: 'trigger',
          nodes: [
            {
              id: 'trigger',
              name: 'Submitted',
              type: 'trigger',
              config: { event: 'requisition_submitted' },
            },
          ],
          edges: [],
        },
        positions: {},
      },
    });
    assert.equal(result.success, false);
  });
});
