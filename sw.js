const CACHE = 'jil-bina-v4';
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

  // كل الملفات (HTML وJS): الشبكة أولاً دائماً — تظهر أي تحديثات فوراً.
  // المخزون المؤقت يُستخدم فقط كاحتياط عند انقطاع الاتصال بالكامل.
  e.respondWith(
    fetch(e.request).then(r => {
      caches.open(CACHE).then(c => c.put(e.request, r.clone()));
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('client_portal.html')))
  );
});

