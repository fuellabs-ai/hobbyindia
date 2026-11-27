// Local mode: registered automatically once the Mini is ready. Lets the page reload with no
// internet. Same-origin: network first with a short deadline, cached copy when offline or when
// the server errors. Cross-origin (Hugging Face model files): cached copy first, they are
// immutable per version. Never touches /api/.
// The cache is versioned by the model hash from /mini-model/index.json (same formula as
// src/miniSearch.js), so model + tokenizer + wasm + vectors update together.
let CACHE = null;
const CACHE_PREFIX = 'hobbylm-mini-';
self.addEventListener('install', e => e.waitUntil((async () => {
  try {
    const meta = await fetch('/mini-model/index.json').then(r => r.json());
    CACHE = `${CACHE_PREFIX}${meta.onnx_sha256.slice(0, 16)}`;
  } catch {
    CACHE = `${CACHE_PREFIX}unknown`; // still works; the next page load retires it
  }
  self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await caches.delete(name); // old model versions
  }
  await self.clients.claim();
})()));

const withDeadline = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), ms);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

// The worker can be stopped and restarted at any time, losing CACHE: find it again from the cache list.
async function currentCache() {
  if (CACHE) return CACHE;
  const names = (await caches.keys()).filter(n => n.startsWith(CACHE_PREFIX));
  if (names.length) return (CACHE = names[names.length - 1]);
  try { const meta = await fetch('/mini-model/index.json').then(r => r.json()); return (CACHE = `${CACHE_PREFIX}${meta.onnx_sha256.slice(0, 16)}`); } catch { return null; }
}
// Large, versioned files: cache first, then let the download finish however long it takes.
const STATIC = /^\/(assets|ort|mini-model|fonts|images|logos)\//;

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    const name = await currentCache();
    if (!name) return fetch(e.request);
    const cache = await caches.open(name);
    if (url.origin !== location.origin) {
      // Immutable big files (model, tokenizer) from the model host: cache first.
      const hit = await cache.match(url.href) ?? await caches.match(url.href);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(url.href, res.clone()).catch(() => {});
      return res;
    }
    const navigate = e.request.mode === 'navigate';
    const key = navigate ? '/' : url.pathname;
    if (!navigate && STATIC.test(url.pathname)) {
      const hit = await cache.match(key) ?? await caches.match(key);
      if (hit) return hit;
      // No deadline (big files must finish) and no caching here: the page saves these files itself,
      // and two saves of the same large response at once fail with a network error.
      return fetch(e.request);
    }
    try {
      // Only the page itself gets a deadline, so a stalled connection falls back to the saved page.
      const res = navigate ? await withDeadline(fetch(e.request), 3000) : await fetch(e.request);
      if (res.status >= 500) throw new Error(`server error ${res.status}`);
      if (res.ok && !url.pathname.startsWith('/models/')) e.waitUntil(cache.put(key, res.clone()).catch(() => {}));
      return res;
    } catch {
      const hit = await cache.match(key) ?? await caches.match(key);
      return hit || new Response('Offline and not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
