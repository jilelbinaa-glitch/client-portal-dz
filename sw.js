const CACHE = 'jil-bina-v3';
const ASSETS = ['client_portal.html','logo.png','manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))
  ));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.url.includes('firebase')||e.request.url.includes('gstatic')||e.request.url.includes('googleapis')) return;

  // bridge.js وأي ملف .js: دائماً من الشبكة أولاً (يتحدّث فوراً)، ويُستخدم المخزون المؤقت فقط عند انقطاع الاتصال
  if (e.request.url.endsWith('.js')) {
    e.respondWith(
      fetch(e.request).then(r => {
        caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // بقية الملفات: من المخزون المؤقت أولاً (أسرع)، مع رجوع للشبكة إن لم توجد
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).catch(()=>caches.match('client_portal.html'))));
});
