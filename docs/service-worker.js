// Network-first for this app's own files, so a new deploy shows up on the next
// open instead of the one after; the cache is only an offline fallback.
// Supabase API calls and CDN scripts are deliberately left untouched so data is
// always fetched live and writes are never intercepted.
const CACHE_NAME = 'gym-log-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './css/app.css',
  './js/main.js',
  './js/config.js',
  './js/data.js',
  './js/fx.js',
  './js/nav.js',
  './js/program.js',
  './js/state.js',
  './js/stats.js',
  './js/timer.js',
  './js/utils.js',
  './js/views/history.js',
  './js/views/profile.js',
  './js/views/progress.js',
  './js/views/summary.js',
  './js/views/today.js',
];

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
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return; // let the browser handle everything else normally (Supabase API, CDN libs)
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
