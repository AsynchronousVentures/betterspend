const CACHE_NAME = 'betterspend-v2';
const STATIC_ASSETS = ['/login', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isHttp = url.protocol === 'http:' || url.protocol === 'https:';

  if (!isHttp || event.request.method !== 'GET') {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    // Network-first for API calls
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request).then(
          (r) => r ?? new Response('{"error":"offline"}', {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      )
    );
  } else if (event.request.mode === 'navigate') {
    // Navigations should go to the network first so auth redirects work normally.
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/login').then((r) => r ?? new Response('Offline')))
    );
  } else {
    // Cache-first for same-origin static assets only.
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok && !response.redirected && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => caches.match('/login').then((r) => r ?? new Response('Offline')));
      })
    );
  }
});
