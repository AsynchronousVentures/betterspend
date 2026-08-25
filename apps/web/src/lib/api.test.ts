import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from './api';
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
