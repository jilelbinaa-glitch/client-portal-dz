const CACHE = 'jil-bina-v1';
const ASSETS = ['app.html','bridge.js','logo.png','logo-180.png','logo-512.png','manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.url.includes('firebase') || e.request.url.includes('googleapis') || e.request.url.includes('gstatic')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('app.html'))));
});
