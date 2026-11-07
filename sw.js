/* Kanji Dōjō : mode hors ligne + mises à jour automatiques.
   Principe : on va TOUJOURS chercher la version la plus récente sur le réseau (en vérifiant auprès du serveur
   qu'elle n'a pas changé) ; le cache ne sert qu'en secours quand il n'y a pas de connexion. */
var CACHE = 'kanji-dojo-v5';
self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'data/lz_jm.gz', 'data/lz_tx.gz', 'data/lz_st.gz', 'data/lz_sk.gz', 'data/lz_x.gz']); }).catch(function () {}));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET') return;
  var u = new URL(r.url);
  if (/supabase\.(co|in)$/.test(u.hostname) || u.pathname.indexOf('/realtime') >= 0) return;   // données du jeu : jamais en cache
  var same = u.origin === self.location.origin;
  // Pages et fichiers du site : on redemande au serveur s'il y a du nouveau (pas de copie « fraîche » périmée du navigateur)
  var req = same ? new Request(r, { cache: 'no-cache' }) : r;
  e.respondWith(fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) { var cp = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, cp); }); }
    return res;
  }).catch(function () {
    return caches.match(r).then(function (m) { return m || (r.mode === 'navigate' ? caches.match('index.html') : undefined); });
  }));
});
