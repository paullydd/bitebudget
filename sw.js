const CACHE_NAME = "bitebudget-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/foods.js",
  "./js/meals.js",
  "./js/planner.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: always serve the latest deployed files when online (this
// app updates often), falling back to the cached copy only when the
// network request fails — that's what actually provides offline support.
// A pure cache-first strategy here would serve whatever was cached on a
// visitor's first visit forever, since nothing would ever re-fetch it.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
