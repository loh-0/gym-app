// Caches only this app's own shell files (for fast repeat loads + basic
// offline launch). Supabase API calls and CDN scripts are deliberately left
// untouched so data is always fetched live and writes are never intercepted.
const CACHE_NAME = 'gym-log-v1';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isAppShellFile = APP_SHELL.some((path) => url.pathname.endsWith(path.replace('./', '')) || path === './' && url.pathname === '/');

  if (event.request.method !== 'GET' || !isSameOrigin || !isAppShellFile) {
    return; // let the browser handle everything else normally (Supabase API, CDN libs)
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
