// Reader service worker.
//
// Gives the PWA instant repeat loads and offline support, and replaces the
// brittle per-file import-path rewriting the deploy workflow used to do for
// cache-busting (see docs/PERFORMANCE.md).
//
// IMPORTANT: GitHub Pages serves this repo without a build step, so the
// __COMMIT_HASH__ placeholder below is NEVER substituted — the cache name
// cannot rotate per deploy. The original cache-first-forever strategy
// therefore served stale modules indefinitely, and any deploy that moved or
// removed a module left returning visitors with a MIX of old and new code
// whose imports 404 — every button in the affected mode goes dead. Two
// defences below:
//   1. Same-origin assets are served stale-while-revalidate: the cached copy
//      answers instantly, but every use refreshes it in the background, so
//      the app converges one visit after a deploy instead of never.
//   2. The cache-name prefix is bumped (v2) so this deploy flushes the
//      already-poisoned caches in the field once, on activate.

const VERSION = '__COMMIT_HASH__';
const CACHE = 'reader-v2-' + VERSION;

// EPUB parsing libraries are vendored (vendor/ — see reader.html), so they are
// same-origin app assets and precache like everything else. Only the
// lazy-loaded per-format libraries below still come from a CDN.

// Per-format parsing libraries that are lazy-loaded only when that format is
// opened (see js/formats/<fmt>/<fmt>-adapter.js loadLibs). NOT precached — a
// reader who only opens EPUBs never downloads them — but cache-first once
// fetched, so a book stays readable offline after its first open. Keep the
// version in sync with the adapter's *_URL constants.
const CDN_FORMAT_LIBS = [
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs',
  'https://cdn.jsdelivr.net/npm/libarchive.js@2.0.2/dist/libarchive.js',
  'https://cdn.jsdelivr.net/npm/libarchive.js@2.0.2/dist/worker-bundle.js',
];

// The app shell: enough to boot offline. The long tail of ES modules, component
// CSS and fonts is cached at runtime on first visit (cache-first below).
const PRECACHE = [
  './',
  'index.html',
  'reader.html',
  'library.html',
  'manifest.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'css/reader.css',
  'css/rsvp.css',
  'css/tts.css',
  'js/mode-switcher.js',
  'vendor/jszip-3.10.1.min.js',
  'vendor/epub-0.3.93.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Bypass the HTTP cache for the shell so a new deploy always lands fresh.
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
      } catch (e) { /* best-effort precache; runtime caching backfills */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Let the page trigger an immediate takeover after an update toast.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

const isCdnLib = (url) => CDN_FORMAT_LIBS.includes(url);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Navigations: serve the cached HTML shell (ignoring ?src/?mode/?id query) so
  // the app opens offline; revalidate from network in the background.
  if (req.mode === 'navigate' && sameOrigin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req.url, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || cache.match('reader.html', { ignoreSearch: true });
    })());
    return;
  }

  // Same-origin app assets: stale-while-revalidate (see header comment). The
  // cached copy answers instantly; a background fetch with cache:'reload'
  // refreshes it for the next load. Offline, the cached copy still serves.
  // The version-pinned CDN format libs are immutable by URL and stay
  // cache-first with no revalidation.
  if (sameOrigin || isCdnLib(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit && isCdnLib(req.url)) return hit;
      const refresh = fetch(req, { cache: 'reload' }).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (hit) {
        event.waitUntil(refresh);
        return hit;
      }
      return (await refresh) || Response.error();
    })());
    return;
  }

  // Everything else (e.g. a cross-origin ?src book): network, fall back to cache.
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
