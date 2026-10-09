// Template: the Vite config fills in the cache version and file list at build time and
// emits this as sw.js next to index.html.
const CACHE = 'discobot-__VERSION__';
const FILES = __FILES__;
const SHELL = new URL('./', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('discobot-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function fromCache(request) {
  const cache = await caches.open(CACHE);
  // Hosts add Vary headers (Origin, Accept-Encoding) that would make a module request miss
  // the copy stored at install time.
  return cache.match(request, { ignoreSearch: true, ignoreVary: true });
}

async function fromNetwork(request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Files under assets/ carry a content hash in their name, so a cached copy is never stale.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(fromCache(request).then((hit) => hit || fromNetwork(request)));
    return;
  }
  // Everything else (the page, the audio worklet, the manifest) keeps its name between
  // releases: prefer the network so an update shows up at once, and fall back to the cache offline.
  event.respondWith(
    fromNetwork(request).catch(async () => {
      const hit = await fromCache(request.mode === 'navigate' ? SHELL : request);
      return hit || Response.error();
    }),
  );
});
