/* Elettromeccanica Maranzan - PWA Service Worker */
const CACHE_NAME = 'em-maranzan-v1';
const PRECACHE_URLS = [
  '/private.html',
  '/css/private.css',
  '/magazzino.html',
  '/css/magazzino.css',
  '/js/magazzino.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html'
];

// install: precache degli asset locali
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// activate: pulizia cache vecchie
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : undefined)))
    )
  );
  self.clients.claim();
});

// optional: allow page to trigger immediate activation
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// fetch: strategie diverse per CSV vs resto
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Handle navigations: try network first, then cached shell, then offline page
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  const url = new URL(request.url);

  // Solo stesso dominio per il cache-first di base
  const isSameOrigin = url.origin === self.location.origin;

  // Network-first per il CSV (così prendi gli aggiornamenti), fallback cache (ignoreSearch) se offline
  if (isSameOrigin && url.pathname.endsWith('/magazzino.csv')) {
    event.respondWith(networkFirstCSV(request));
    return;
  }

  // Network-first per gli asset principali dell'app (HTML/CSS/JS) così vedi subito gli aggiornamenti
  if (
    isSameOrigin &&
    (
      url.pathname === '/private.html'      ||
      url.pathname === '/css/private.css'   ||
      url.pathname === '/magazzino.html'    ||
      url.pathname === '/css/magazzino.css' ||
      url.pathname === '/js/magazzino.js'
    )
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cache-first per gli altri file locali dell’app
  if (isSameOrigin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Per librerie esterne (es. OpenCV) -> prova rete e metti in cache best-effort
  if (!isSameOrigin) {
    event.respondWith(networkThenCache(request));
    return;
  }
});

// strategie
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // ultima spiaggia: una Response 503 “human readable”
    return new Response('Offline e nessuna copia cache disponibile.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function networkThenCache(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    // Potrebbe essere “opaque” (CORS), ma possiamo comunque metterla in cache
    cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('Rete non disponibile e nessuna cache per: ' + request.url);
  }
}

async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    // Try an exact match first
    const cached = await cache.match(request);
    if (cached) return cached;
    // Fallback to app shells
    const shell1 = await cache.match('/private.html');
    if (shell1) return shell1;
    const shell2 = await cache.match('/magazzino.html');
    if (shell2) return shell2;
    // Last resort: offline page
    return (await cache.match('/offline.html')) || new Response('Offline', { status: 503 });
  }
}

async function networkFirstCSV(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    // Because the app appends ?t=timestamp, ignore the search to find a cached CSV
    const cached = await cache.match('/magazzino.csv', { ignoreSearch: true });
    if (cached) return cached;
    return new Response('Offline e nessuna copia cache disponibile (CSV).', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}