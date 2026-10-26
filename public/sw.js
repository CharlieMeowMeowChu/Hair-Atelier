const CACHE = 'hair-atelier-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => {
    const network = fetch(event.request).then((response) => {
      if (response.ok && new URL(event.request.url).origin === location.origin) {
        caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      }
      return response;
    });
    return cached || network;
  }));
});
