// Service Worker — armazena apenas o casco do aplicativo (HTML, CSS, JS, ícone)
// com estratégia stale-while-revalidate. NUNCA armazena /api/* (R28).
const CACHE_NAME = 'apuracao-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/uf-paths.js',
  '/manifest.webmanifest',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Regra inegociável (R28): nunca interceptar nem guardar em cache /api/* ou origens externas do TSE
  if (url.pathname.startsWith('/api/') || url.hostname.includes('tse.jus.br')) {
    return;
  }

  // Apenas arquivos estáticos da mesma origem usam stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })
    );
  }
});
