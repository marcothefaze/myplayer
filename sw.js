/* Service worker: aggiornamento automatico (network-first).
   A ogni apertura dell'app prova a prendere la versione più recente
   dal server; solo se offline ripiega sulla cache locale.
   L'audio (mp3) non viene intercettato per non disturbare lo streaming.
   Le COPERTINE invece sono file statici: cache-first con aggiornamento in
   background, così si vedono all'istante a ogni cambio brano (e offline). */

const CACHE = "ssg-cache-v3";

/* Copertine degli album: pre-caricate all'installazione (~3MB una volta sola).
   Dopo la prima apertura dell'app le copertine non scaricano più nulla. */
const COVERS = [
  "src/assets/covers/COCONUT_ICE_CREAM_-_SSG.jpeg",
  "src/assets/covers/D.A.M.S._-_SSG.jpeg",
  "src/assets/covers/Giorni_Migliori_-_SSG.png",
  "src/assets/covers/Giorni_Migliori_-_SSG.webp",
  "src/assets/covers/LUCCIOLE_-_SSG.jpg",
  "src/assets/covers/NUOVI_PEZZI_MASTER_E_MIX.jpeg",
  "src/assets/covers/NUOVI_PEZZI_MASTER_E_MIX.webp",
  "src/assets/covers/SINGOLI___EXTRA_-_SSG.png",
  "src/assets/covers/SINGOLI___EXTRA_-_SSG.webp",
  "src/assets/covers/SOLO_AVANZI_-_SSG.jpeg",
  "src/assets/covers/Testamento_-_ssg.jpeg",
  "src/assets/covers/Testamento_-_ssg.webp"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(COVERS)).catch(() => {})
  );
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

  /* Copertine e immagini: CACHE-FIRST (stale-while-revalidate).
     La copia in cache risponde ALL'ISTANTE (niente più secondini a ogni
     cambio brano) e in background si aggiorna dal server, così resta
     fresca se un giorno cambi una copertina. Funziona anche offline. */
  if (/\.(png|jpe?g|webp)$/i.test(url.pathname)) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(e.request);
        const netFetch = fetch(e.request).then((net) => {
          if (net && net.ok) cache.put(e.request, net.clone());
          return net;
        }).catch(() => {});
        return cached || netFetch;
      })()
    );
    return;
  }

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
