const CACHE_NAME = 'betterspend-v3';
const STATIC_ASSETS = ['/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // The old cache included runtime and authenticated route responses.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('betterspend-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const staticAsset =
    url.pathname.startsWith('/_next/static/') || STATIC_ASSETS.includes(url.pathname);
  // All API, runtime, document, RSC, and other dynamic requests use the network.
  if (
    url.origin !== self.location.origin ||
    request.method !== 'GET' ||
    !staticAsset ||
    request.mode === 'navigate' ||
    request.cache === 'no-store' ||
    request.cache === 'reload' ||
    request.cache === 'no-cache' ||
    request.headers.has('RSC') ||
    /no-store|no-cache/i.test(request.headers.get('Cache-Control') || '')
  )
    return;

  event.respondWith(
    caches
      .open(CACHE_NAME)
      .catch(() => null)
      .then(async (cache) => {
        const cached = await cache?.match(request).catch(() => undefined);
        if (cached) return cached;
        const response = await fetch(request);
        if (
          cache &&
          response.ok &&
          !response.redirected &&
          !/no-store|private|no-cache/i.test(response.headers.get('Cache-Control') || '')
        ) {
          // Storage quotas must not turn a successful asset fetch into a network error.
          await cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      }),
  );
});
