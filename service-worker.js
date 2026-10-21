const CACHE = "PhotoOps-preview-6ba9513-v1";
const FILES = ["./", "./index.html", "./styles.css", "./app.js", "./schedule.js", "./manifest.json"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener("fetch", event => {
  if (!event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request)).then(found => found || fetch(event.request)));
});
