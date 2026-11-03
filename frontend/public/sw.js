// CardStakk service worker: only here so phones offer "Install app" / "Add to Home screen".
// It caches nothing: every request goes to the network as usual, so listings are always current.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request));
});
