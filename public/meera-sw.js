/* Only public, immutable assets are cached. Chat, auth, API and HTML remain network-only. */
// Bump this version when changing the offline document.
const ASSETS = 'meera-public-assets-v3';
const OFFLINE = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(ASSETS).then(cache => cache.add(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('meera-public-assets-') && key !== ASSETS).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE)) || Response.error()));
    return;
  }
  // Next.js hashes its static asset URLs. Private uploads and API responses are excluded.
  if (!url.pathname.startsWith('/_next/static/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(ASSETS).catch(() => null);
    const cached = cache ? await cache.match(request).catch(() => null) : null;
    if (cached) return cached;
    const response = await fetch(request);
    if (cache && response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil((async () => {
        await cache.put(request, copy);
        const keys = await cache.keys();
        const assets = keys.filter(key => new URL(key.url).pathname !== OFFLINE);
        if (assets.length > 160) await Promise.all(assets.slice(0, assets.length - 160).map(key => cache.delete(key)));
      })().catch(() => {}));
    }
    return response;
  })());
});
