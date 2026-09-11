/* sw.js — Service worker GFileManager.
   - Precache app shell -> offline shell
   - Stale-while-revalidate utk aset same-origin
   - API /api/gas: network-first, fallback cache (GET list saja)
   - Navigasi: fallback ke index.html saat offline */
const CACHE = 'gfm-v4';
const SHELL = [
  './', './index.html', './css/app.css',
  './js/core.js', './js/sync.js', './js/offline.js', './js/conflict.js', './js/features.js', './js/auth.js', './js/theme.js',
  './js/app-main.js', './js/app-actions.js', './js/app-ctx.js', './js/app-sync.js',
  './manifest.json',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png', './assets/icons/icon-maskable-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return; // POST API: biarkan (online), error ditangani UI
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Navigasi halaman: network dulu, fallback cache/index.html (offline shell)
  if (req.mode === 'navigate') {
    ev.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        const c = await caches.open(CACHE);
        return (await c.match('./index.html')) || (await c.match('./')) ||
          new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // Aset: stale-while-revalidate
  ev.respondWith((async () => {
    const c = await caches.open(CACHE);
    const cached = await c.match(req);
    const fetchFresh = fetch(req).then((res) => {
      if (res && res.ok) c.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fetchFresh;
  })());
});
