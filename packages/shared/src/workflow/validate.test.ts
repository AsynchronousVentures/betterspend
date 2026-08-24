import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { workflowGraphSchema } from './graph';
import { validateWorkflowGraph } from './validate';

const PRIMARY_APPROVER_ID = '00000000-0000-4000-8000-000000000001';
const FALLBACK_APPROVER_ID = '00000000-0000-4000-8000-000000000002';

function validGraph() {
  return workflowGraphSchema.parse({
    schemaVersion: 1,
    domain: 'invoice',
    entryNodeId: 'start',
    nodes: [
      {
        id: 'start',
        name: 'Invoice submitted',
        type: 'trigger',
        config: { event: 'invoice_submitted' },
      },
      {
        id: 'amount-check',
        name: 'Amount check',
        type: 'condition',
        config: { mode: 'first_true' },
      },
      {
        id: 'finance',
        name: 'Finance approval',
        type: 'approver_group',
        config: {
          execution: 'parallel',
          resolvers: [
            {
              type: 'user',
              userId: PRIMARY_APPROVER_ID,
              spendLimitBaseAmount: '1000.000',
            },
          ],
          quorum: { type: 'all' },
          separationOfDuties: {
            enabled: true,
            exclude: ['invoice_creator'],
            fallbackResolvers: [{ type: 'user', userId: FALLBACK_APPROVER_ID }],
          },
        },
      },
      { id: 'approved', name: 'Approved', type: 'approved', config: {} },
      {
        id: 'rejected',
        name: 'Rejected',
        type: 'reject',
        config: { reasonRequired: true },
      },
    ],
    edges: [
      {
        id: 'start-to-check',
        sourceNodeId: 'start',
        sourceHandle: 'out',
        targetNodeId: 'amount-check',
        targetHandle: 'in',
      },
      {
        id: 'high-value',
        sourceNodeId: 'amount-check',
        sourceHandle: 'branch',
        targetNodeId: 'finance',
        targetHandle: 'in',
        condition: { field: 'totalAmount', operator: '>=', value: 1_000 },
        priority: 0,
      },
      {
        id: 'default-reject',
        sourceNodeId: 'amount-check',
        sourceHandle: 'default',
        targetNodeId: 'rejected',
        targetHandle: 'in',
        isDefault: true,
      },
      {
        id: 'finance-to-approved',
        sourceNodeId: 'finance',
        sourceHandle: 'out',
        targetNodeId: 'approved',
        targetHandle: 'in',
      },
    ],
  });
}

function issueCodes(input: unknown) {
  return validateWorkflowGraph(input).issues.map((issue) => issue.code);
}

describe('validateWorkflowGraph', () => {
  it('parses a valid graph and returns a deterministic topological order', () => {
    const result = validateWorkflowGraph(validGraph());

    assert.equal(result.valid, true);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.topologicalOrder, [
      'start',
      'amount-check',
      'finance',
      'approved',
      'rejected',
    ]);
  });

  it('reports invalid node config paths from the shared Zod schema', () => {
    const graph = validGraph();
    const invalidGraph = {
      ...graph,
      nodes: graph.nodes.map((node, index) => (index === 0 ? { ...node, type: 'unknown' } : node)),
    };

    const result = validateWorkflowGraph(invalidGraph);

    assert.equal(result.valid, false);
    assert.equal(result.graph, null);
    assert.equal(result.issues[0]?.code, 'invalid_graph');
    assert.deepEqual(result.issues[0]?.path, ['nodes', 0, 'type']);
  });

  it('requires spend limits to be precise base-currency decimal strings', () => {
    const graph = validGraph();
    const input = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === 'finance' && node.type === 'approver_group'
          ? {
              ...node,
              config: {
                ...node.config,
                resolvers: [
                  {
                    type: 'user',
                    userId: PRIMARY_APPROVER_ID,
                    spendLimitBaseAmount: 1000.001,
                  },
                ],
              },
            }
          : node,
      ),
    };

    const result = validateWorkflowGraph(input);

    assert.equal(result.valid, false);
    assert.equal(result.graph, null);
    assert.ok(result.issues.some((issue) => issue.code === 'invalid_graph'));
  });

  it('rejects multiple entry nodes and unreachable nodes', () => {
    const graph = validGraph();
    graph.nodes.push({
      id: 'second-start',
      name: 'Second trigger',
      type: 'trigger',
      disabled: false,
      config: { event: 'invoice_submitted' },
    });

    const codes = issueCodes(graph);

    assert.ok(codes.includes('multiple_entries'));
    assert.ok(codes.includes('unreachable_node'));
  });

  it('requires exactly one default edge and conditions on other split branches', () => {
    const graph = validGraph();
    graph.edges[1] = { ...graph.edges[1], condition: undefined };
    graph.edges[2] = {
      ...graph.edges[2],
      sourceHandle: 'branch',
      isDefault: false,
      condition: { field: 'totalAmount', operator: '<', value: 1_000 },
    };

    const codes = issueCodes(graph);

    assert.ok(codes.includes('missing_default_edge'));
    assert.ok(codes.includes('missing_branch_condition'));
  });

  it('rejects approval nodes without resolvers or a safe SoD fallback', () => {
    const graph = validGraph();
    const finance = graph.nodes.find((node) => node.id === 'finance');
    if (finance?.type !== 'approver_group') throw new Error('Expected approver group fixture');
    finance.config.resolvers = [];
    finance.config.quorum = { type: 'count', count: 2 };
    finance.config.separationOfDuties = {
      enabled: true,
      exclude: [],
      fallbackResolvers: [],
    };

    const codes = issueCodes(graph);

    assert.ok(codes.includes('zero_resolvers'));
    assert.ok(codes.includes('invalid_quorum'));
    assert.equal(codes.filter((code) => code === 'invalid_separation_of_duties').length, 2);
  });

  it('rejects a fallback that repeats a primary resolver', () => {
    const graph = validGraph();
    const finance = graph.nodes[2];
    if (finance.type !== 'approver_group') throw new Error('Expected approver group fixture');
    finance.config.separationOfDuties.fallbackResolvers = [
      { type: 'user', userId: PRIMARY_APPROVER_ID },
    ];

    assert.ok(issueCodes(graph).includes('invalid_separation_of_duties'));
  });

  it('rejects repeated primary and manager-chain fallback resolvers', () => {
    const graph = validGraph();
    const finance = graph.nodes[2];
    if (finance.type !== 'approver_group') throw new Error('Expected approver group fixture');
    finance.config.resolvers = [
      { type: 'manager_chain', maxLevels: 3 },
      { type: 'manager_chain', maxLevels: 3 },
    ];
    finance.config.separationOfDuties.fallbackResolvers = [{ type: 'manager_chain', maxLevels: 3 }];

    const codes = issueCodes(graph);

    assert.ok(codes.includes('duplicate_resolver'));
    assert.ok(codes.includes('invalid_separation_of_duties'));
  });

  it('defers count quorum bounds when a resolver expands dynamically', () => {
    const graph = validGraph();
    const finance = graph.nodes[2];
    if (finance.type !== 'approver_group') throw new Error('Expected approver group fixture');
    finance.config.resolvers = [{ type: 'manager_chain', maxLevels: 3 }];
    finance.config.quorum = { type: 'count', count: 2 };
    finance.config.separationOfDuties.fallbackResolvers = [{ type: 'role', role: 'finance' }];

    const result = validateWorkflowGraph(graph);

    assert.equal(result.valid, true);
  });

  it('requires the workflow domain to match its entry trigger event', () => {
    const graph = validGraph();
    const entry = graph.nodes[0];
    if (entry.type !== 'trigger') throw new Error('Expected trigger fixture');
    entry.config.event = 'requisition_submitted';

    assert.ok(issueCodes(graph).includes('domain_trigger_mismatch'));
  });

  it('rejects duplicate collect-form field keys', () => {
    const graph = validGraph();
    const input = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === 'finance'
          ? {
              id: 'finance',
              name: 'Collect details',
              type: 'collect_form',
              config: {
                fields: [
                  { key: 'cost_center', label: 'Cost center', type: 'text' },
                  { key: 'cost_center', label: 'Cost center again', type: 'text' },
                ],
              },
            }
          : node,
      ),
    };

    const result = validateWorkflowGraph(input);

    assert.equal(result.valid, false);
    assert.equal(result.graph, null);
    assert.ok(result.issues.some((issue) => issue.message === 'Field keys must be unique'));
  });

  it('detects invalid handles and edges that reference missing nodes', () => {
    const graph = validGraph();
    graph.edges[0] = { ...graph.edges[0], sourceHandle: 'missing' };
    graph.edges.push({
      id: 'missing-node',
      sourceNodeId: 'does-not-exist',
      sourceHandle: 'out',
      targetNodeId: 'approved',
      targetHandle: 'in',
      isDefault: false,
    });

    const codes = issueCodes(graph);

    assert.ok(codes.includes('missing_handle'));
    assert.ok(codes.includes('missing_node_reference'));
  });

  it('detects enabled paths that terminate in disabled nodes', () => {
    const graph = {
      schemaVersion: 1,
      domain: 'requisition',
      entryNodeId: 'start',
      nodes: [
        {
          id: 'start',
          name: 'Start',
          type: 'trigger',
          config: { event: 'requisition_submitted' },
        },
        {
          id: 'disabled-notice',
          name: 'Disabled notice',
          type: 'notify',
          disabled: true,
          config: {
            channels: ['email'],
            recipients: [{ type: 'role', role: 'admin' }],
            message: 'Review required',
          },
        },
      ],
      edges: [
        {
          id: 'to-disabled',
          sourceNodeId: 'start',
          sourceHandle: 'out',
          targetNodeId: 'disabled-notice',
          targetHandle: 'in',
        },
      ],
    };

    const result = validateWorkflowGraph(graph);

    assert.ok(result.issues.some((issue) => issue.code === 'dead_end'));
  });

  it('returns the exact path for a cycle found by Kahn-based sorting', () => {
    const graph = validGraph();
    graph.edges.push({
      id: 'cycle-back',
      sourceNodeId: 'approved',
      sourceHandle: 'out',
      targetNodeId: 'finance',
      targetHandle: 'in',
      isDefault: false,
    });

    const result = validateWorkflowGraph(graph);
    const cycle = result.issues.find((issue) => issue.code === 'cycle');

    assert.equal(result.topologicalOrder, null);
    assert.deepEqual(cycle?.path, ['approved', 'finance', 'approved']);
  });
});
