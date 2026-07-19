// Service worker — installable PWA + offline fallback.
//
// v1 served EVERYTHING cache-first, including the app shell ('/'): after each
// deploy, installed users kept getting the old HTML (pointing at dead hashed
// asset URLs) until they manually cleared site data. v2 is network-first for
// navigations and only cache-first for immutable/static files, with old-cache
// cleanup + immediate takeover on update.
// v3 bumps the cache name so returning visitors — whose v2 cache still holds
// the pre-rebrand icons — get evicted and re-fetch the current Pluriel assets
// instead of being stuck with stale icons forever (cache-first never expires).
// v4: cache-name bump to force-evict every installed client's stale cache
// while debugging the iOS keyboard-viewport fixes — guarantees phones that
// keep reporting the old behavior aren't simply running an old bundle.
const CACHE_NAME = 'lio23-v4';
const STATIC_ASSETS = [
  '/manifest.json',
  '/logo.png',
  '/logo-192.png',
  '/logo-maskable-512.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App shell / page navigations: network-first so deploys reach users
  // immediately; the cached copy is only an offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Hashed build assets are immutable — cache-first, populate on first fetch.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        });
      })
    );
    return;
  }

  // Pre-cached statics (icons, manifest): cache-first.
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
    return;
  }

  // Everything else (API, live data): straight to network — never cached.
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Pluriel';
  const options = {
    body: data.body || 'Nouveaux signaux disponibles.',
    icon: '/logo-192.png',
    badge: '/logo-192.png',
    data: data.url || '/',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data));
});
