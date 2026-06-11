// Reader service worker.
//
// Gives the PWA instant repeat loads and offline support, and replaces the
// brittle per-file import-path rewriting the deploy workflow used to do for
// cache-busting (see docs/PERFORMANCE.md). The cache name is versioned by the
// deploy commit hash: a new deploy = a new cache, and on activate we delete the
// old ones, so every asset is refetched fresh exactly once per deploy.

const VERSION = '__COMMIT_HASH__';
const CACHE = 'reader-' + VERSION;

// CDN libraries the app needs to parse EPUBs. Precached so they work offline and
// never block first paint (the HTML loads them deferred). Kept in sync with the
// <script> tags in reader.html / library.html.
const CDN_LIBS = [
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js',
];

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
  ...CDN_LIBS,
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

const isCdnLib = (url) => CDN_LIBS.includes(url) || CDN_FORMAT_LIBS.includes(url);

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

  // App assets (same-origin) and the CDN libs: cache-first. On a miss we fetch
  // with cache:'reload' so a fresh deploy's assets bypass any stale HTTP cache.
  if (sameOrigin || isCdnLib(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req, { cache: 'reload' });
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return cache.match(req) || Response.error();
      }
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
