/* Kanji Dōjō : mode hors ligne. À déposer à côté de index.html. */
var CACHE = 'kanji-dojo-v1';
self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(['./', 'index.html']); }).catch(function () {}));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET') return;
  var u = new URL(r.url);
  if (/supabase\.(co|in)$/.test(u.hostname) || u.pathname.indexOf('/realtime') >= 0) return;   // données du jeu : jamais en cache
  e.respondWith(fetch(r).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) { var cp = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, cp); }); }
    return res;
  }).catch(function () {
    return caches.match(r).then(function (m) { return m || (r.mode === 'navigate' ? caches.match('index.html') : undefined); });
  }));
});
