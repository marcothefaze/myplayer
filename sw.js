/* Service worker: aggiornamento automatico.
   I VIDEO non vengono intercettati: lo streaming a range requests del
   telefono non si deve rompere (e niente cache dei file grandi).
   GLI AUDIO: online rete diretta in no-store (niente accumulo nella
   cache HTTP nascosta del browser), offline escono dalla cache se sono
   stati scaricati col tasto "Scarica" (ascolto offline).
   Asset VERSIONATI (?v=): immutabili per costruzione (stesso URL = stessi
   byte per sempre) -> cache-first: istantanei, sicuri, zero riscaricamenti.
   SHELL e resto (index.html, navigazioni): network-first con fallback in
   cache -> la pagina punta SEMPRE ai ?v giusti, gli aggiornamenti si vedono
   alla prima apertura. Copertine: stale-while-revalidate. */

const CACHE = "ssg-cache-v55";
/* Cache degli audio SCARICATI per l'ascolto offline (tasto "Scarica"
   sull'album): online va sempre in rete (streaming nativo intatto),
   offline i brani scaricati escono dalla cache locale. */
const AUDIO_CACHE = "ssg-audio-v1";

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
      /* Gli audio scaricati per l'offline NON si toccano mai */
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== AUDIO_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/assets/video/")) return;   // streaming video: range requests diretti

  /* AUDIO: ONLINE rete diretta in no-store (lo streaming resta nativo MA
     il browser non lo salva più nella sua cache HTTP nascosta, che nessuna
     pagina può svuotare e che cresceva a ogni ascolto; il Range per la
     barra di avanzamento viene inoltrato); OFFLINE i brani scaricati per
     l'ascolto offline escono dalla cache locale */
  if (url.pathname.includes("/assets/audio/")) {
    e.respondWith((async () => {
      const cache = await caches.open(AUDIO_CACHE);
      try {
        const hdrs = {};
        try {
          const rg = e.request.headers.get("range");
          if (rg) hdrs.Range = rg;
        } catch (err) {}
        return await fetch(e.request.url, { cache: "no-store", headers: hdrs });
      } catch (err) {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  /* Asset VERSIONATI (?v=): immutabili per costruzione, quindi
     cache-first senza rischi: se l'URL è lo stesso, i byte sono gli stessi.
     Vale per style.css, player.js, playlist.json e tutto ciò che ha ?v=. */
  if (url.searchParams.has("v")) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(e.request);
      if (cached) return cached;
      const net = await fetch(e.request);
      if (net && net.ok) cache.put(e.request, net.clone());
      return net;
    })());
    return;
  }

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

  /* SHELL e navigazioni (index.html incluso): NETWORK-FIRST con fallback
     in cache. La shell punta sempre ai ?v giusti, quindi ogni apertura
     mostra l'ultima versione; offline si ripiega sulla copia in cache. */
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const net = await fetch(e.request);
        if (net && net.ok) cache.put(e.request, net.clone());
        return net;
      } catch (err) {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        throw err;
      }
    })()
  );
});
