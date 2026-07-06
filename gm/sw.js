const CACHE = 'gm-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'pick.mjs', 'config.js',
               'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// network-first so deploys apply on next open; cache is only the offline fallback
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : { title: 'GMlékek', body: 'Nézd meg hogy mit dobott mára' };
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: 'icon-192.png' }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' })
    .then(ws => ws[0] ? ws[0].focus() : clients.openWindow('./')));
});
