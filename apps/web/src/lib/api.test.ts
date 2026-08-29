import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, api, loadFailureState } from './api';
import { apiUrl } from './api-url';

type CapturedRequest = {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
};

async function runWithMockedRequest<T>(
  response: Response,
  request: () => Promise<T>,
  cookie = 'bs_token=test-token',
): Promise<{ result: T; request: CapturedRequest }> {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  let capturedRequest: CapturedRequest | undefined;

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie },
  });
  globalThis.fetch = async (input, init) => {
    capturedRequest = { input, init };
    return response;
  };

  try {
    const result = await request();
    assert.ok(capturedRequest);
    return { result, request: capturedRequest };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
    }
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('authenticated requisition and supplier diversity methods use the shared request boundary', async () => {
  const cases = [
    {
      name: 'AI requisition parsing',
      path: '/api/v1/requisitions/ai-parse',
      call: () => api.requisitions.aiParse('buy 2 monitors'),
      method: 'POST',
      body: { text: 'buy 2 monitors' },
      response: { title: 'Monitors', lines: [] },
    },
    {
      name: 'supplier diversity summary',
      path: '/api/v1/vendors/diversity/summary',
      call: () => api.vendors.getDiversitySummary(),
      method: 'GET',
      body: undefined,
      response: {
        totalVendors: 1,
        diverseVendors: 1,
        diversityRate: 100,
        esgRatedVendors: 1,
        diversityBreakdown: { small_business: 1 },
        esgRatingBreakdown: { A: 1 },
        topDiverseVendors: [],
      },
    },
    {
      name: 'supplier ESG update',
      path: '/api/v1/vendors/vendor-1/esg',
      call: () =>
        api.vendors.updateEsg('vendor-1', {
          diversityCategories: ['small_business'],
          esgRating: 'A',
        }),
      method: 'PATCH',
      body: { diversityCategories: ['small_business'], esgRating: 'A' },
      response: {
        id: 'vendor-1',
        diversityCategories: ['small_business'],
        esgRating: 'A',
        carbonFootprintTons: null,
        sustainabilityCertifications: [],
        esgNotes: null,
        diversityVerifiedAt: null,
      },
    },
  ] as const;

  for (const testCase of cases) {
    const { result, request } = await runWithMockedRequest<unknown>(
      jsonResponse(testCase.response),
      testCase.call,
    );
    assert.deepEqual(result, testCase.response);
    assert.equal(request.input, apiUrl(testCase.path));
    assert.equal(request.init?.method ?? 'GET', testCase.method, testCase.name);
    assert.deepEqual(
      request.init?.body === undefined ? undefined : JSON.parse(String(request.init.body)),
      testCase.body,
    );

    const headers = new Headers(request.init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-token');
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.has('x-org-id'), false);
  }
});

test('Xero tenant selection uses the pending grant endpoints', async () => {
  const tenants = [
    { tenantId: 'tenant-1', tenantName: 'Northwind' },
    { tenantId: 'tenant-2', tenantName: null },
  ];
  const listRequest = await runWithMockedRequest(jsonResponse(tenants), () =>
    api.gl.xeroConnections('grant / 1'),
  );

  assert.deepEqual(listRequest.result, tenants);
  assert.equal(
    listRequest.request.input,
    apiUrl('/api/v1/gl/oauth/xero/connections?grantId=grant%20%2F%201'),
  );
  assert.equal(listRequest.request.init?.method ?? 'GET', 'GET');

  const selectRequest = await runWithMockedRequest(new Response(null, { status: 204 }), () =>
    api.gl.selectXeroConnection({ grantId: 'grant-1', tenantId: 'tenant-2' }),
  );

  assert.equal(selectRequest.result, undefined);
  assert.equal(selectRequest.request.input, apiUrl('/api/v1/gl/oauth/xero/connections'));
  assert.equal(selectRequest.request.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(selectRequest.request.init?.body)), {
    grantId: 'grant-1',
    tenantId: 'tenant-2',
  });
});

test('shared API errors are propagated for each organization-scoped method', async () => {
  const calls = [
    () => api.requisitions.aiParse('buy monitors'),
    () => api.vendors.getDiversitySummary(),
    () => api.vendors.updateEsg('vendor-1', { esgRating: 'A' }),
  ];

  for (const call of calls) {
    await assert.rejects(
      runWithMockedRequest<unknown>(jsonResponse({ message: 'Request rejected' }, 422), call),
      { message: 'Request rejected' },
    );
  }
});

test('shared API errors retain the failure kind needed by data-state UI', async () => {
  await assert.rejects(
    runWithMockedRequest(jsonResponse({ message: 'Not permitted' }, 403), () =>
      api.invoices.list(),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.kind, 'forbidden');
      assert.equal(error.status, 403);
      assert.equal(loadFailureState(error), 'denied');
      return true;
    },
  );

  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const reports: unknown[][] = [];
  try {
    console.error = (...args: unknown[]) => {
      reports.push(args);
    };

    await assert.rejects(
      runWithMockedRequest(jsonResponse({ message: 'internal stack detail' }, 503), () =>
        api.invoices.list(),
      ),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.kind, 'server');
        assert.equal(error.message, 'Something went wrong. Try again.');
        assert.equal(loadFailureState(error), 'failed');
        return true;
      },
    );

    globalThis.fetch = async () => {
      throw new TypeError('Network unavailable');
    };
    await assert.rejects(api.invoices.list(), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.kind, 'network');
      assert.equal(loadFailureState(error), 'failed');
      return true;
    });
    assert.equal(reports.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('shared API methods omit authorization when no token cookie exists', async () => {
  const { request } = await runWithMockedRequest(
    jsonResponse({
      totalVendors: 0,
      diverseVendors: 0,
      diversityRate: 0,
      esgRatedVendors: 0,
      diversityBreakdown: {},
      esgRatingBreakdown: {},
      topDiverseVendors: [],
    }),
    () => api.vendors.getDiversitySummary(),
    '',
  );

  const headers = new Headers(request.init?.headers);
  assert.equal(headers.has('authorization'), false);
  assert.equal(headers.has('x-org-id'), false);
});

test('workflow definition responses are parsed at the API boundary', async () => {
  const graph = {
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
  };
  const response = {
    id: '00000000-0000-4000-8000-000000000001',
    organizationId: '00000000-0000-4000-8000-000000000002',
    entityId: null,
    domain: 'requisition',
    name: 'Requisition approvals',
    currentDraft: { graph, positions: {}, notes: [] },
    draftFence: 1,
    publishedVersionId: null,
    publishedVersion: null,
    createdBy: '00000000-0000-4000-8000-000000000003',
    updatedBy: '00000000-0000-4000-8000-000000000003',
    createdAt: '2026-08-29T12:00:00.000Z',
    updatedAt: '2026-08-29T12:00:00.000Z',
  };

  const { result } = await runWithMockedRequest(jsonResponse(response), () =>
    api.workflowDefinitions.get(response.id),
  );
  assert.equal(result.id, response.id);

  await assert.rejects(
    runWithMockedRequest(jsonResponse({ ...response, currentDraft: null }), () =>
      api.workflowDefinitions.get(response.id),
    ),
  );
});

test('workflow lease and assistant responses are parsed at the API boundary', async () => {
  const definitionId = '00000000-0000-4000-8000-000000000001';
  const editorInstanceId = '00000000-0000-4000-8000-000000000002';
  const credentials = { editorInstanceId, leaseToken: 'valid-lease-token' };
  const invalidLeaseResponse = jsonResponse({ state: 'owned' });
  const leaseCalls = [
    () => api.workflowDefinitions.lease.status(definitionId, editorInstanceId),
    () => api.workflowDefinitions.lease.acquire(definitionId, editorInstanceId),
    () => api.workflowDefinitions.lease.renew(definitionId, credentials),
    () => api.workflowDefinitions.lease.release(definitionId, credentials),
    () => api.workflowDefinitions.lease.takeover(definitionId, editorInstanceId),
  ];

  for (const call of leaseCalls) {
    await assert.rejects(runWithMockedRequest(invalidLeaseResponse.clone(), call));
  }

  await assert.rejects(
    runWithMockedRequest(
      jsonResponse({ summary: '', operations: [], validation: { valid: true, issues: [] } }),
      () =>
        api.workflowDefinitions.propose(definitionId, {
          prompt: 'Add an approval',
          graph: {
            schemaVersion: 1,
            domain: 'requisition',
            entryNodeId: 'trigger',
            nodes: [
              {
                id: 'trigger',
                name: 'Submitted',
                type: 'trigger',
                disabled: false,
                config: { event: 'requisition_submitted' },
              },
            ],
            edges: [],
          },
          positions: {},
        }),
    ),
  );
});

test('message lists accept RFC-compatible database UUIDs', async () => {
  const messages = [
    {
      id: 'a115230f-ec95-4544-b83a-76fe1e9c9202',
      organizationId: '5d3c6e3a-0f46-49f3-9d3f-f70f73f2c1a1',
      threadType: 'po',
      threadId: '40290e17-8d21-47ba-bef4-5b1f14ea5552',
      senderType: 'user',
      senderId: '7c827b75-5df5-468b-bb11-1a03dd7f65d8',
      vendorId: null,
      recipientVendorId: null,
      authorName: 'Jane Requester',
      body: 'Please confirm the synthetic delivery window.',
      attachments: [],
      createdAt: '2026-08-27T12:00:00.000Z',
    },
    {
      id: 'b8a8cc55-3a50-4aa4-a531-b6e3ac7d8157',
      organizationId: '5d3c6e3a-0f46-49f3-9d3f-f70f73f2c1a1',
      threadType: 'po',
      threadId: '40290e17-8d21-47ba-bef4-5b1f14ea5552',
      senderType: 'vendor',
      senderId: null,
      vendorId: '56737f63-ed92-43ec-91e2-245bc36f1182',
      recipientVendorId: null,
      authorName: 'Demo supplier contact',
      body: 'Synthetic supplier reply. No email was sent.',
      attachments: [],
      createdAt: '2026-08-29T12:00:00.000Z',
    },
  ];

  const { result } = await runWithMockedRequest(jsonResponse(messages), () =>
    api.messages.list('po', '40290e17-8d21-47ba-bef4-5b1f14ea5552'),
  );

  assert.deepEqual(result, messages);
});

test('risk screening lists accept migrated demo vendor UUIDs', async () => {
  const vendors = [
    {
      id: '38f59a8c-ef89-42d0-9a41-19e3b4af1a23',
      name: 'Acme Supplies Inc.',
      status: 'active',
      onboardingStatus: 'not_started',
      sanctionsStatus: 'untested',
      sanctionsCheckedAt: null,
      sanctionsNote: null,
      contactInfo: {},
    },
    {
      id: '9d07a2e6-7b5c-4f31-b8c9-6e204a5fd712',
      name: 'TechParts Global',
      status: 'active',
      onboardingStatus: 'not_started',
      sanctionsStatus: 'untested',
      sanctionsCheckedAt: null,
      sanctionsNote: null,
      contactInfo: {},
    },
  ];

  const { result } = await runWithMockedRequest(jsonResponse(vendors), () =>
    api.riskScreening.list(),
  );

  assert.deepEqual(result, vendors);
});
