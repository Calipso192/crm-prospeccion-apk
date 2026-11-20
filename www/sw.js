const CACHE_NAME = 'crm-prospeccion-v9';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './styles/variables.css',
  './styles/main.css',
  './styles/features.css',
  './styles/dashboard.css',
  './styles/multichannel.css',
  './scripts/app.js',
  './scripts/services/lead-schema.js',
  './scripts/services/db-storage.js',
  './scripts/services/db-service.js',
  './scripts/services/phase-engine.js',
  './scripts/services/whatsapp-service.js',
  './scripts/services/channel-service.js',
  './scripts/services/template-service.js',
  './scripts/services/reminder-service.js',
  './scripts/services/backup-service.js',
  './scripts/modules/dashboard-view.js',
  './scripts/modules/lead-card.js',
  './scripts/modules/interest-manager-ui.js',
  './scripts/modules/template-modal-ui.js',
  './scripts/modules/modal-tools.js',
  './scripts/modules/calendar-scheduler.js',
  './scripts/modules/campaign-controller.js',
  './scripts/modules/selection-controller.js',
  './scripts/modules/list-renderer.js',
  './scripts/modules/form-modals-controller.js',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
          return Promise.resolve();
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        const networkFetch = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          if (event.request.mode === 'navigate') {
            return cache.match('./index.html');
          }
          if (cachedResponse) {
            return cachedResponse;
          }
          return new Response('', { status: 503, statusText: 'Offline' });
        });

        if (cachedResponse) {
          event.waitUntil(networkFetch);
          return cachedResponse;
        }
        return networkFetch;
      });
    })
  );
});
