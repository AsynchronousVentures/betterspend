import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { workflowAssistantProposalRequestSchema } from '@betterspend/shared';
import {
  WORKFLOW_ASSISTANT_MAX_OUTPUT_CHARS,
  WorkflowAssistantService,
} from './workflow-assistant.service';

const request = workflowAssistantProposalRequestSchema.parse({
  prompt: 'Rename the approved step.',
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
      { id: 'approved', name: 'Approved', type: 'approved', config: {} },
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
  },
  positions: { trigger: { x: 0, y: 0 }, approved: { x: 300, y: 0 } },
});

function serviceWith(output: string | null) {
  const prompts: string[] = [];
  const runtime = {
    generateText: async (_organizationId: string, prompt: string) => {
      prompts.push(prompt);
      return output;
    },
  };
  return { service: new WorkflowAssistantService(runtime as never), prompts };
}

describe('WorkflowAssistantService', () => {
  it('parses a typed provider proposal, applies it, and returns shared validation', async () => {
    const { service, prompts } = serviceWith(
      JSON.stringify({
        summary: 'Rename the terminal step.',
        operations: [
          {
            type: 'update_node',
            nodeId: 'approved',
            node: { id: 'approved', name: 'Ready', type: 'approved', config: {} },
          },
        ],
      }),
    );

    const response = await service.propose('organization-1', request);

    assert.equal(response.summary, 'Rename the terminal step.');
    assert.equal(response.operations[0]?.type, 'update_node');
    assert.equal(response.validation.valid, true);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /Rename the approved step/);
  });

  it('returns a clear service-unavailable error when no provider can generate text', async () => {
    const { service } = serviceWith(null);

    await assert.rejects(service.propose('organization-1', request), (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException);
      assert.match(error.message, /enabled default AI provider/);
      return true;
    });
  });

  it('rejects malformed or oversized provider output', async () => {
    const malformed = serviceWith('not json').service;
    await assert.rejects(
      malformed.propose('organization-1', request),
      (error: unknown) => error instanceof BadRequestException,
    );

    const oversized = serviceWith('x'.repeat(WORKFLOW_ASSISTANT_MAX_OUTPUT_CHARS + 1)).service;
    await assert.rejects(
      oversized.propose('organization-1', request),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('rejects operations that reference unknown nodes or edges before mutation', async () => {
    const { service } = serviceWith(
      JSON.stringify({
        summary: 'Remove an edge.',
        operations: [{ type: 'remove_edge', edgeId: 'missing-edge' }],
      }),
    );

    await assert.rejects(service.propose('organization-1', request), (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.match(error.message, /missing edge/);
      return true;
    });
  });

  it('accepts a fenced JSON object but rejects extra model fields', async () => {
    const fenced = serviceWith(
      '```json\n' +
        JSON.stringify({
          summary: 'Rename the terminal step.',
          operations: [
            {
              type: 'update_node',
              nodeId: 'approved',
              node: { id: 'approved', name: 'Ready', type: 'approved', config: {} },
            },
          ],
        }) +
        '\n```',
    ).service;
    await assert.doesNotReject(fenced.propose('organization-1', request));

    const extraField = serviceWith(
      JSON.stringify({
        summary: 'Rename the terminal step.',
        operations: [
          {
            type: 'update_node',
            nodeId: 'approved',
            node: { id: 'approved', name: 'Ready', type: 'approved', config: {} },
          },
        ],
        publish: true,
      }),
    ).service;
    await assert.rejects(
      extraField.propose('organization-1', request),
      (error: unknown) => error instanceof BadRequestException,
    );
  });
});
