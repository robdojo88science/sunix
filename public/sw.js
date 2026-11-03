/* The app shell stays local. Large models and user audio are never cached here. */
const CACHE = 'sunix-shell-v1';
const BASE = new URL(self.registration.scope);
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/sunix.svg'].map(path => new URL(path, BASE).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // The first visit is not yet controlled by this worker. Discover the built
    // entry assets here so that the next launch can work without a connection.
    const entry = await cache.match(BASE.href);
    if (entry) {
      const html = await entry.text();
      const assets = [...html.matchAll(/(?:src|href)=["']([^"']*\/assets\/[^"']+)["']/g)]
        .map(match => new URL(match[1], BASE))
        .filter(url => url.origin === BASE.origin && url.pathname.startsWith(BASE.pathname))
        .map(url => url.href);
      await cache.addAll([...new Set(assets)]);
    }
  })());
  // Let existing tabs finish with their current version.
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('sunix-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  // Hashed Vite assets, including lazy WASM, are immutable. Cache the runtime
  // only after the first separation requests it; never prefetch it with Home.
  // The separation worker manages its verified model in a separate cache.
  if (/\.(?:onnx|ort|mp3|wav|m4a|aac|ogg|flac)$/i.test(url.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(BASE.href, copy)));
      }
      return response;
    }).catch(async () => (await caches.match(BASE.href)) || Response.error()));
    return;
  }
  if (url.pathname.includes('/assets/') || SHELL.includes(url.href)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
      }
      return response;
    })));
  }
});
