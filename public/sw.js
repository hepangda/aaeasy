// Minimal AAEasy service worker — vanilla, no build step.
//
// Strategy:
//   - Static assets (/_next/static/, /icon-*.png, manifest, sw.js itself):
//     stale-while-revalidate from cache.
//   - Navigations (HTML): network-first with offline fallback to a cached
//     copy of `/` (so the app shell renders even when offline).
//   - API requests + the SSE stream: passthrough — never cache.
//
// We deliberately avoid caching authenticated route HTML: we'd risk leaking
// one user's group page to another after sign-out. Network-first ensures the
// server always re-checks auth; offline simply shows the cached shell which
// then re-routes to /login when network returns.

const STATIC_CACHE = 'aaeasy-static-v1';
const SHELL_CACHE = 'aaeasy-shell-v1';
const SHELL_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.add(new Request(SHELL_URL, { credentials: 'same-origin' }));
      } catch {
        // best-effort
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== SHELL_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStatic(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon-') ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/favicon-32x32.png' ||
    url.pathname === '/apple-icon.png' ||
    url.pathname === '/manifest.webmanifest'
  );
}

function isApi(url) {
  return url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return; // never intercept API or SSE

  if (isStatic(url)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstWithShell(req));
  }
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || refresh || fetch(req);
}

async function networkFirstWithShell(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(SHELL_CACHE);
      // Only cache the shell URL itself, not arbitrary pages, to avoid
      // showing one user's data to another.
      const url = new URL(req.url);
      if (url.pathname === SHELL_URL) cache.put(SHELL_URL, res.clone());
    }
    return res;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(SHELL_URL);
    if (cached) return cached;
    return new Response('<h1>Offline</h1>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}
