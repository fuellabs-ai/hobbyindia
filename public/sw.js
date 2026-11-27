// Registered only when private mode is turned on. Lets the page reload with no internet.
// Network first (so updates arrive), cached copy when offline. Never touches /api/.
const CACHE = 'hobbylm-private-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const key = e.request.mode === 'navigate' ? '/' : url.pathname;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (url.pathname.startsWith('/models/') || url.pathname.startsWith('/ort/') || url.pathname.startsWith('/private-model/')) {
      const hit = await cache.match(key);
      if (hit) return hit;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok && !url.pathname.startsWith('/models/')) cache.put(key, res.clone()).catch(() => {});
      return res;
    } catch {
      return (await cache.match(key)) || new Response('Offline and not cached yet.', { status: 503 });
    }
  })());
});
