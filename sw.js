/* Service worker: aggiornamento automatico (network-first).
   A ogni apertura dell'app prova a prendere la versione più recente
   dal server; solo se offline ripiega sulla cache locale.
   L'audio (mp3) non viene intercettato per non disturbare lo streaming. */

const CACHE = "ssg-cache-v2";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/assets/audio/")) return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        /* "cache: reload" aggira la cache HTTP del browser: si chiede
           sempre al server la versione più recente. Svuotare la cache
           dal pulsante refresh garantisce così di ottenere la nuova. */
        const net = await fetch(e.request, { cache: "reload" });
        if (net && net.ok && !url.pathname.endsWith(".html"))
          cache.put(e.request, net.clone());
        return net;
      } catch (err) {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        throw err;
      }
    })()
  );
});