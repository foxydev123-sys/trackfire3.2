/* Kurdish Tank service worker.
   - Game files: network first (so every update on the server reaches players
     at once), with a saved copy used when there is no internet.
   - The 3D engine from the CDN: saved once, then used from the cache.
   - Nothing online (API, WebSockets) is ever cached.
   With no internet the app still opens, and Practice mode works offline. */
const CACHE = 'kt-v16';
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.module.js';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    let files = ['./', 'index.html', 'manifest.webmanifest'];
    try { const r = await fetch('sw-files.json', { cache: 'no-store' }); if (r.ok) files = files.concat(await r.json()); } catch (err) {}
    await Promise.allSettled(files.map(f => c.add(new Request(f, { cache: 'reload' }))));
    try { await c.add(new Request(CDN, { mode: 'cors' })); } catch (err) {}
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/hub') || url.pathname.startsWith('/.well-known') || url.pathname === '/stats' || url.pathname === '/health') return;
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
        return res;
      } catch (err) {
        const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
        return hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
      }
    })());
    return;
  }
  if (url.href === CDN || url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') {
    e.respondWith((async () => {
      const hit = await caches.match(req); if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') { const c = await caches.open(CACHE); c.put(req, res.clone()); } return res; }
      catch (err) { return Response.error(); }
    })());
  }
});
