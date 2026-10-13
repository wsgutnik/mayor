/* Mayor service worker: app shell precache + runtime cache, so the game runs offline.
   Bump VERSION on every release so old caches are dropped. */
const VERSION = "mayor-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/favicon.png", "/mayor-logo.jpg",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-180.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Navigations: network first so a new release shows up, cache when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("/index.html", copy)); return res; })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }
  // Hashed build assets and icons never change for a given URL: cache first.
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
