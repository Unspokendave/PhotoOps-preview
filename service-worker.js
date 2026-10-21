const CACHE = "PhotoOps-preview-v21-5528a66-1";
const FILES = ["./", "./index.html", "./styles.css", "./app.js", "./sync.js", "./planner.js", "./storage.js", "./manifest.json", "./preview.json"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request)).then(found => found || fetch(event.request)));
});
