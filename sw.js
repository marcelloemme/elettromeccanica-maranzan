/* Elettromeccanica Maranzan - PWA Service Worker */
const CACHE_NAME = 'em-maranzan-v99';
const PRECACHE_URLS = [
  '/private.html',
  '/html/magazzino.html',
  '/html/magazzino-nuovo.html',
  '/html/magazzino-dettaglio.html',
  '/html/riparazioni-archivio.html',
  '/html/riparazioni-dettaglio.html',
  '/html/riparazioni-nuovo.html',
  '/html/statistiche.html',
  '/css/app.css?v=68',
  '/js/magazzino.js?v=24',
  '/js/magazzino-nuovo.js?v=29',
  '/js/magazzino-dettaglio.js?v=28',
  '/js/riparazioni-archivio.js?v=10',
  '/js/riparazioni-dettaglio.js?v=7',
  '/js/riparazioni-nuovo.js?v=3',
  '/js/statistiche.js?v=1',
  '/js/cache-manager.js?v=24',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
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

  // Network-first per il CSV (aggiornamenti freschi, fallback cache se offline)
  if (isSameOrigin && url.pathname.endsWith('/magazzino.csv')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Network-first per gli asset principali dell'app (HTML/CSS/JS) così vedi subito gli aggiornamenti
  if (
    isSameOrigin &&
    (
      url.pathname === '/private.html'        ||
      url.pathname.startsWith('/html/')       ||
      url.pathname === '/css/app.css'         ||
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

  // Per librerie esterne -> prova rete e metti in cache best-effort
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
    const shell2 = await cache.match('/html/magazzino.html');
    if (shell2) return shell2;
    // Last resort: basic offline message
    return new Response('Offline', { status: 503 });
  }
}