import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function worker(storageFailure?: 'open' | 'put') {
  const entries = new Map<string, Response>();
  const deleted: string[] = [];
  const listeners: Record<string, (event: unknown) => void> = {};
  let version = '0.2.3';
  let calls = 0;
  const cache = {
    match: async (request: Request) => entries.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => {
      if (storageFailure === 'put') throw new Error('quota exceeded');
      entries.set(request.url, response);
    },
    addAll: async () => {},
  };
  const network = async (request: Request) => {
    calls++;
    return new Response(version, {
      headers: {
        'Cache-Control': request.url.includes('private') ? 'private, no-store' : 'public',
      },
    });
  };
  vm.runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), {
    URL,
    Response,
    fetch: network,
    self: {
      location: { origin: 'https://example.test' },
      addEventListener: (name: string, listener: (event: unknown) => void) => {
        listeners[name] = listener;
      },
      skipWaiting() {},
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => {
        if (storageFailure === 'open') throw new Error('storage unavailable');
        return cache;
      },
      keys: async () => ['betterspend-v2', 'betterspend-v3', 'unrelated'],
      delete: async (key: string) => {
        deleted.push(key);
        return true;
      },
    },
  });
  return {
    entries,
    deleted,
    calls: () => calls,
    setVersion: (value: string) => {
      version = value;
    },
    activate: async () => {
      let pending: Promise<unknown> | undefined;
      listeners.activate({
        waitUntil: (promise: Promise<unknown>) => {
          pending = promise;
        },
      });
      await pending;
    },
    request: async (path: string, init?: RequestInit) => {
      const request = new Request(new URL(path, 'https://example.test'), init);
      let response: Promise<Response> | undefined;
      listeners.fetch({
        request,
        respondWith: (value: Promise<Response>) => {
          response = value;
        },
      });
      return (await (response ?? network(request))).text();
    },
  };
}

test('release upgrades and rollbacks, route and RSC requests always reach the network', async () => {
  const sw = worker();
  for (const version of ['0.2.3', '0.2.4', '0.2.3']) {
    sw.setVersion(version);
    assert.equal(await sw.request('/runtime-version', { cache: 'no-store' }), version);
    assert.equal(await sw.request('/invoices?_rsc=test', { headers: { RSC: '1' } }), version);
    assert.equal(await sw.request('/api/v1/invoices'), version);
  }
  assert.equal(sw.entries.size, 0);
  assert.equal(sw.calls(), 9);
});

test('only static assets cache, and request and response cache restrictions are honored', async () => {
  const sw = worker();
  await sw.request('/_next/static/chunk.js');
  await sw.request('/_next/static/chunk.js');
  assert.equal(sw.calls(), 1);
  await sw.request('/_next/static/chunk.js', { cache: 'no-store' });
  assert.equal(sw.calls(), 2);
  await sw.request('/_next/static/private.js');
  await sw.request('/_next/static/private.js');
  await sw.request('/icon-192.png', { headers: { 'Cache-Control': 'no-store' } });
  await sw.request('https://elsewhere.test/_next/static/chunk.js');
  assert.equal(sw.entries.size, 1);
});

test('activation evicts legacy dynamic caches without deleting unrelated caches', async () => {
  const sw = worker();
  await sw.activate();
  assert.deepEqual(sw.deleted, ['betterspend-v2']);
});

test('storage failures do not discard successful network responses', async () => {
  for (const failure of ['open', 'put'] as const) {
    const sw = worker(failure);
    assert.equal(await sw.request('/_next/static/chunk.js'), '0.2.3');
    assert.equal(sw.calls(), 1);
  }
});
