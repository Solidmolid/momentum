/* Momentum – Service Worker (Offline-Fähigkeit) */
const CACHE_PREFIX = "momentum-";
const CACHE = "momentum-v29";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=28",
  "./vendor/supabase-2.110.3.js",
  "./cloud.js?v=5",
  "./pomodoro.js?v=2",
  "./sketch.js?v=2",
  "./app.js?v=29",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
const STATIC_URLS = new Set(ASSETS.map((asset) => new URL(asset, self.location).href));

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // Netzwerk zuerst für HTML (frische Version), sonst Cache-first
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
    return;
  }

  // Sicherheitsgrenze: Nur bekannte, gleich-originige App-Dateien cachen.
  // Authentifizierte Supabase-Antworten und andere Cross-Origin-Daten dürfen
  // niemals im persistenten PWA-Cache landen.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !STATIC_URLS.has(url.href)) return;

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => hit))
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      const open = windowClients.find((client) => typeof client.focus === "function");
      if (open) return open.focus();
      return self.clients.openWindow("./");
    })
  );
});
