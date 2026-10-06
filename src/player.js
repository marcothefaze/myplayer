"use strict";

/* =========================================================
   SSG Universe - logica del player
     1) CARICAMENTO: fetch di playlist.json
     2) HOME:        griglia album (copertine + titolo)
     3) ALBUM:       schermata con i brani dell'album scelto
     4) PLAYER:      play/pausa, precedente/successiva,
                     SHUFFLE (casuale) e RIPETI (off/all/one)
     5) PERSISTENZA: volume, shuffle e repeat salvati localmente
   ========================================================= */

/* ---------- 1. CONFIGURAZIONE ---------- */

const APP_VERSION = "23";   // cambia l'URL di playlist.json: niente cache stantia
const APP_BUILD = "v105";   // versione in console (brand-sub nascosto): bumpare a ogni release
console.log("SSG Universe " + APP_BUILD);
const PLAYLIST_URL = "playlist.json?v=" + APP_VERSION;
const BASE_PATH = "../";          // index.html sta in /src, i file in /
const $ = (id) => document.getElementById(id);

/* localStorage "difeso": in Safari privato o su certi telefoni non è
   accessibile; qui non deve MAI far crashare l'app */
const storage = {
  get(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } },
  set(key, value) { try { window.localStorage.setItem(key, String(value)); } catch (e) {} }
};

/* Su telefono: blocca lo zoom con due dita e il doppio tap (iOS/Android).
   Il pinch-zoom è già bloccato nativamente via CSS (touch-action sul body),
   così nessun listener JS rallenta lo scroll: il touchmove qui NON serve. */
if ("gesturestart" in window) {
  document.addEventListener("gesturestart", (e) => e.preventDefault());
}

/* ---------- 2. ELEMENTI DEL DOM ---------- */

const audio = $("audio");

const els = {
  home: $("view-home"),
  albumView: $("view-album"),
  albumGrid: $("album-grid"),
  search: $("search"),
  searchClear: $("search-clear"),
  searchResults: $("search-results"),
  searchView: $("search-view"),
  searchViewClose: $("search-view-close"),
  btnSearch: $("btn-search"),
  btnSettings: $("btn-settings"),
  settingsView: $("settings-view"),
  settingsViewClose: $("settings-view-close"),
  setStats: $("set-stats"),
  setEq: $("set-eq"),
  setDlInfo: $("set-dl-info"),
  setDlList: $("set-dl-list"),
  installBanner: $("install-banner"),
  installGo: $("install-go"),
  installHide: $("install-hide"),
  installText: $("install-text"),
  albumEyebrow: $("album-eyebrow"),
  heroHearts: $("hero-hearts"),
  trackList: $("track-list"),
  albumHero: $("album-hero"),
  heroBg: $("hero-bg"),
  albumCoverWrap: $("album-cover-wrap"),
  albumTitle: $("album-title"),
  albumMeta: $("album-meta"),
  btnBack: $("btn-back"),
  btnRefresh: $("btn-refresh"),
  brandCount: $("brand-count"),
  cover: $("cover"),
  songTitle: $("song-title"),
  songArtist: $("song-artist"),
  timeCurrent: $("time-current"),
  timeDuration: $("time-duration"),
  seek: $("seek"),
  seekFill: $("seek-fill"),
  volume: $("volume"),
  volumeIcon: $("volume-icon"),
  btnPlay: $("btn-play"),
  btnPrev: $("btn-prev"),
  btnNext: $("btn-next"),
  btnShuffle: $("btn-shuffle"),
  btnRepeat: $("btn-repeat"),
  iconPlay: $("icon-play"),
  iconPause: $("icon-pause"),
  repBadge: $("rep-badge"),
  trackInfo: $("track-info"),
  coverView: $("cover-view"),
  coverViewClose: $("cover-view-close"),
  coverViewImg: $("cover-view-img"),
  fp: $("full-player"),
  fpBg: $("fp-bg"),
  fpCover: $("fp-cover"),
  fpTitle: $("fp-title"),
  fpAlbum: $("fp-album"),
  fpTimeCurrent: $("fp-time-current"),
  fpTimeDuration: $("fp-time-duration"),
  fpSeek: $("fp-seek"),
  fpSeekFill: $("fp-seek-fill"),
  fpCollapse: $("fp-collapse"),
  fpHandle: $("fp-handle"),
  fpPlay: $("fp-play"),
  fpPrev: $("fp-prev"),
  fpNext: $("fp-next"),
  fpShuffle: $("fp-shuffle"),
  fpRepeat: $("fp-repeat"),
  fpIconPlay: $("fp-icon-play"),
  fpIconPause: $("fp-icon-pause"),
  fpRepBadge: $("fp-rep-badge"),
  fpShare: $("fp-share"),
  fpFav: $("fp-fav"),
  fpShareMenu: $("fp-share-menu"),
  fpShareLink: $("fp-share-link"),
  fpShareCover: $("fp-share-cover"),
  fpVideoToggle: $("fp-video-toggle"),
  fpVideoFs: $("fp-video-fs"),
  main: $("main")
};

/* ---------- 3. STATO ---------- */

const state = {
  songs: [],        // brani letti da playlist.json (già ordinati per album/titolo)
  albums: [],       // [{ title, artist, cover, totalSec, songs:[indici] }]
  queue: [],        // ordine di riproduzione corrente (indici in songs[])
  queuePos: -1,     // posizione corrente dentro queue
  /* All'apertura dell'app TUTTI i bottoni sono inattivi (richiesta di
     Marco): niente riproduzione casuale/ripeti ripristinate dall'ultima
     sessione. Si clicchi e diventano verdi e funzionano subito. */
  shuffle: false,
  repeat: "off"     // off | all | one
};

/* ---------- 4. FUNZIONI DI SUPPORTO ---------- */

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return min + ":" + String(sec).padStart(2, "0");
}

function formatMinutes(seconds) {
  return Math.max(1, Math.round(seconds / 60)) + " min";
}

function resolvePath(file) {
  if (!file) return "";
  if (file.startsWith("http") || file.startsWith("/") || file.startsWith("data:")) return file;
  return BASE_PATH + file;
}

function fileTitle(file) {
  const parts = String(file).split("/");
  const name = parts[parts.length - 1] || file;
  return name.replace(/\.[^.]+$/, "");
}

function isRealArtist(name) {
  return name && name !== "Artista sconosciuto" && name.trim() !== "";
}

/* Iniziali per copertine segnaposto (es. "Testamento" -> "T") */
function initials(name) {
  const words = String(name).split(/[\s\-]+/).filter(Boolean);
  return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
}

/* Riempie un contenitore con la copertina o un segnaposto con le iniziali */
function buildCover(container, src, name) {
  container.innerHTML = "";
  container.classList.remove("ph");
  container.innerHTML = "";
  container.classList.remove("ph");
  if (container === els.fpCover) container.style.setProperty("--fp-ar", "1");   // reset: riquadro quadrato
  if (src) {
    const img = document.createElement("img");
    img.src = resolvePath(src);
    img.alt = "";
    img.loading = "lazy";        // fuori schermo? non si scarica adesso: il telefono parte subito
    img.decoding = "async";      // l'immagine si scompatta un secondo piano, niente blocco del paint
    /* Il riquadro del full player resta SEMPRE quadrato come le altre
       copertine (richiesta di Marco): le copertine orizzontali (LUCCIOLE
       770x470) riempiono il quadrato con "cover", senza buchi né vuoti.
       Solo il videoclip passa al formato largo (classe playing-video). */
    img.onerror = () => { container.classList.add("ph"); img.remove(); makePh(container, name); };
    container.appendChild(img);
  } else {
    container.classList.add("ph");
    makePh(container, name);
  }
}

function makePh(container, name) {
  const span = document.createElement("span");
  span.className = "ph-title";
  span.textContent = name ? initials(name) : "?";
  container.appendChild(span);
}

/* ---------- FEEDBACK APTICI (vibrazione) ---------- */

// Vibra leggermente al tocco. Funziona su Android (navigator.vibrate);
// su iPhone Safari Apple non lo espone, quindi lì si limita al feedback visivo.
function haptic(pulse) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try { navigator.vibrate(pulse || 10); } catch (e) {}
  }
}

/* Al tocco di un tasto/canza/copertina: micro-vibrazione (più decisa sul
   play) + RIPPLE, il cerchio che si espande dal punto toccato: feedback
   rapido e d'impatto, animato in transform (GPU), zero lag. */
document.addEventListener("touchstart", function () {}, { passive: true });   // iOS: abilita :active
document.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const t = e.target.closest("button, .track-row, .album-card");
  if (!t) return;
  if (e.pointerType === "touch") {
    if (t.classList.contains("btn-play") || t.classList.contains("fp-play")) {
      haptic(18);
    } else if (t.classList.contains("track-row") || t.classList.contains("album-card")) {
      haptic(14);
    } else {
      haptic(8);
    }
  }
  /* Niente ripple sui tasti play/pausa: su un cerchio bianco l'alone crea
     solo rumore e copre l'icona (segnalato da Marco). Lì la pressione è
     la scala + l'icona nera fissa, come su Spotify. Il ripple resta su
     tutti gli altri bottoni/canzoni/copertine. */
  if (t.classList.contains("btn-play") || t.classList.contains("fp-play")) return;
  // Ripple: sulle copertine della home va nel figlio (ha già overflow
  // hidden e i bordi arrotondati, così il cerchio non esce dal riquadro)
  const host = t.classList.contains("album-card") && t.firstElementChild
    ? t.firstElementChild
    : t;
  const rect = host.getBoundingClientRect();
  if (!rect.width && !rect.height) return;
  const size = Math.max(rect.width, rect.height) * 2.2;
  const rip = document.createElement("span");
  rip.className = "ripple";
  rip.style.width = rip.style.height = size + "px";
  rip.style.left = (e.clientX - rect.left - size / 2) + "px";
  rip.style.top = (e.clientY - rect.top - size / 2) + "px";
  host.appendChild(rip);
  rip.addEventListener("animationend", () => rip.remove());
  setTimeout(() => rip.remove(), 700);   // rete di sicurezza
});

/* ---------- 5. CARICAMENTO ---------- */

async function loadPlaylist() {
  try {
    /* TIMEOUT di sicurezza: se la richiesta resta appesa (service worker
       vecchio/impallato sul telefono, rete che muore) dopo 8 secondi si
       esce con errore: niente piu' "Caricamento..." infinito */
    const response = await Promise.race([
      fetch(PLAYLIST_URL),
      new Promise(function (_, rej) {
        setTimeout(function () { rej(new Error("richiesta appesa (timeout)")); }, 8000);
      })
    ]);
    if (!response.ok) throw new Error("HTTP " + response.status);
    state.songs = await response.json();
    buildAlbums();
    state.queue = state.flat.slice();        // ordine normale all'avvio
    applySavedState();
    renderHome();
    updateBrandCount();
    handleDeepLink();
  } catch (err) {
    els.albumGrid.innerHTML =
      '<div class="error">Impossibile caricare la playlist.<br>' +
      "Controlla la connessione e premi il tasto refresh in alto a destra,<br>" +
      "oppure riprova qui sotto." +
      '<br><button id="retry-load" class="retry-btn" style="margin:14px auto 0;display:flex">Riprova</button>';
    console.error("Errore nel caricamento della playlist:", err);
    const retry = document.getElementById("retry-load");
    if (retry) retry.addEventListener("click", function () {
      renderSkeletons();
      loadPlaylist();
    });
  }
}

/* Deep link da link condiviso: ?track=<percorso file> -> avvia quel brano */
function handleDeepLink() {
  const track = new URLSearchParams(location.search).get("track");
  if (!track) return;
  /* Il confronto ignora la querystring (?v=...) che può essere nel campo
     file per il cache-bust: i vecchi link condivisi continuano a funzionare */
  const clean = (f) => String(f || "").split("?")[0];
  const i = state.songs.findIndex((s) => clean(s.file) === clean(track));
  if (i >= 0) playSong(i, true);
}

/* ---------- CONDIVISIONE BRANO ---------- */

/* Link "carino" per il brano: una mini-pagina generata in /og/<slug>/
   che mostra all'anteprima (WhatsApp/Telegram/Instagram) la copertina
   giusta dell'album e poi reindirizza all'app con il brano avviato. */
function ogUrl(file) {
  const slug = trackSlug(file);
  return new URL("../og/" + slug + "/", location.href).href;
}

function trackSlug(file) {
  /* Il ?v=... del cache-bust non deve finire nello slug dei link condivisi */
  const base = String(file || "").split("/").pop().split("?")[0].replace(/\.[^.]+$/, "");
  return base
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "brano";
}

/* Apre/chiude il menu Condividi */
function toggleShareMenu() {
  const menu = els.fpShareMenu;
  if (!menu) return;
  const open = menu.classList.toggle("hidden");
  if (els.fpShare) els.fpShare.setAttribute("aria-expanded", String(!open));
}
document.addEventListener("click", (e) => {
  if (!els.fpShareMenu || els.fpShareMenu.classList.contains("hidden")) return;
  if (!e.target.closest(".fp-share-wrap")) toggleShareMenu();
});

/* Condivide il link del brano */
function shareLink() {
  const i = currentIndex();
  if (i < 0) return;
  const song = state.songs[i];
  const url = ogUrl(song.file);
  const name = song.titolo || fileTitle(song.file);
  if (navigator.share) {
    navigator.share({ title: name, text: name + " - SSG Universe", url }).catch(() => {});
  } else {
    const done = () => toast("Link copiato negli appunti");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => toast(url));
    } else {
      toast(url);
    }
  }
}

/* Immagine della copertina (+ titolo) da pubblicare nelle storie.
   Condivisa come file immagine: dall'anti-share del telefono si può
   scegliere Instagram -> Storie. */
function shareCover() {
  const i = currentIndex();
  if (i < 0) return;
  const song = state.songs[i];
  const name = song.titolo || fileTitle(song.file);
  const coverSrc = resolvePath(song.copertina || "");
  const cover = new Image();
  if (coverSrc) cover.crossOrigin = "anonymous";
  cover.onload = () => {
    canvasShare(cover, name);
  };
  cover.onerror = () => {
    if (navigator.share && navigator.canShare) {
      navigator.share({ title: name, text: name + " - SSG Universe",
        url: ogUrl(song.file) }).catch(() => {});
    } else {
      toast("Copertina non disponibile");
    }
  };
  if (coverSrc) {
    cover.src = coverSrc;
  } else {
    cover.onerror();
  }
}

function canvasShare(cover, name) {
  const size = 1080;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const imgW = cover && cover.src ? cover.width : size;
  const imgH = cover && cover.src ? cover.height : size;
  ctx.fillStyle = "#0a0a10";
  ctx.fillRect(0, 0, size, size);
  if (cover && cover.src) {
    const s = Math.max(size / imgW, size / imgH);
    const w = imgW * s, h = imgH * s;
    ctx.drawImage(cover, (size - w) / 2, (size - h) / 2, w, h);
  }
  const grad = ctx.createLinearGradient(0, size * .55, 0, size);
  grad.addColorStop(0, "rgba(10,10,16,0)");
  grad.addColorStop(1, "rgba(10,10,16,.95)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, size * .5, size, size * .5);
  ctx.fillStyle = "#fff";
  ctx.font = "800 46px -apple-system, 'Segoe UI', sans-serif";
  ctx.textBaseline = "bottom";
  wrapCtxText(ctx, name, 70, size - 170, size - 140, 46);
  ctx.fillStyle = "rgba(255,255,255,.75)";
  ctx.font = "700 34px -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText("SSG Universe", 70, size - 84);
  c.toBlob(async (blob) => {
    if (!blob) return toast("Impossibile creare l'immagine");
    const file = new File([blob], "cover.png", { type: "image/png" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name, text: name + " - SSG Universe" });
      } catch (e) {}
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cover-ssg.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("Immagine salvata: la trovi nel download");
    }
  }, "image/png");
}

function wrapCtxText(ctx, text, x, maxW, y, lineH) {
  const words = String(text).split(/\s+/);
  let line = "";
  let lines = [];
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  lines = lines.slice(0, 3);
  y -= (lines.length - 1) * lineH;
  lines.forEach((l) => { ctx.fillText(l, x, y); y += lineH; });
}

/* Piccolo messaggio a comparsa in basso (usato per i link copiati) */
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ---------- COLORE PER ALBUM ----------
   L'alone della copertina, i titoli, gli accenti e le tinte dello sfondo
   del full player si adattano ai colori della copertina dell'album
   (richiesta di Marco). I colori sono triplette "r, g, b" usate con
   rgb()/rgba() nelle variabili CSS --album-c1 / --album-c2. */
const ALBUM_COLORS = {
  "Non è SSG":               { c1: "245, 205, 60",  c2: "255, 170, 60" },
  "Preferiti":               { c1: "255, 107, 157", c2: "247, 168, 196" },
  "Testamento":        { c1: "90, 145, 220",  c2: "230, 190, 90" },
  "Giorni Migliori":   { c1: "175, 195, 220", c2: "222, 228, 238" },
  "Lucciole":          { c1: "85, 200, 175",  c2: "235, 200, 110" },
  "Coconut Ice Cream": { c1: "70, 205, 230",  c2: "240, 90, 170" },
  "Singoli & Extra":   { c1: "140, 85, 225",  c2: "245, 80, 65" },
  "Solo Avanzi":       { c1: "235, 75, 85",   c2: "185, 230, 75" },
  "D.A.M.S.":          { c1: "235, 45, 45",   c2: "255, 120, 60" }
};

function applyAlbumColors(albumTitle) {
  const c = ALBUM_COLORS[albumTitle] || { c1: "124, 108, 255", c2: "79, 157, 255" };
  document.documentElement.style.setProperty("--album-c1", c.c1);
  document.documentElement.style.setProperty("--album-c2", c.c2);
}

/* ---------- RICERCA (brani e album, mentre scrivi) ---------- */

function normText(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function runSearch(q) {
  const query = normText(q).trim();
  const grid = els.albumGrid;
  const box = els.searchResults;
  if (!grid || !box) return;
  if (els.searchClear) els.searchClear.classList.toggle("hidden", !query);

  if (!query) {                     // ricerca vuota: torna la griglia
    grid.classList.remove("hidden");
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  grid.classList.add("hidden");
  box.classList.remove("hidden");
  box.innerHTML = "";

  const albums = state.albums.filter((a) => normText(a.title).includes(query));
  const songs = [];
  state.songs.forEach((s, i) => {
    if (normText(s.titolo).includes(query) || normText(s.album).includes(query)) {
      songs.push(i);
    }
  });

  if (!albums.length && !songs.length) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "Nessun risultato";
    box.appendChild(empty);
    return;
  }

  if (albums.length) {
    const head = document.createElement("div");
    head.className = "sr-head";
    head.textContent = "Album";
    box.appendChild(head);
    albums.forEach((a, n) => {
      const row = document.createElement("button");
      row.className = "sr-row";
      row.style.setProperty("--i", Math.min(n, 12));
      const cover = document.createElement("div");
      cover.className = "sr-cover";
      buildCover(cover, a.cover, a.title);
      const meta = document.createElement("div");
      meta.className = "sr-meta";
      const t = document.createElement("div");
      t.className = "sr-title";
      t.textContent = a.title;
      const sub = document.createElement("div");
      sub.className = "sr-sub";
      sub.textContent = a.songs.length + " brani";
      meta.appendChild(t);
      meta.appendChild(sub);
      row.appendChild(cover);
      row.appendChild(meta);
      row.addEventListener("click", () => { closeSearchView(); openAlbum(a); });
      box.appendChild(row);
    });
  }

  if (songs.length) {
    const head = document.createElement("div");
    head.className = "sr-head";
    head.textContent = "Brani";
    box.appendChild(head);
    songs.forEach((idx, n) => {
      const song = state.songs[idx];
      const row = document.createElement("button");
      row.className = "sr-row";
      row.style.setProperty("--i", Math.min(n, 12));
      const cover = document.createElement("div");
      cover.className = "sr-cover";
      buildCover(cover, song.copertina, song.album);
      const meta = document.createElement("div");
      meta.className = "sr-meta";
      const t = document.createElement("div");
      t.className = "sr-title";
      t.textContent = song.titolo || fileTitle(song.file);
      const sub = document.createElement("div");
      sub.className = "sr-sub";
      sub.textContent = song.album || "";
      meta.appendChild(t);
      meta.appendChild(sub);
      const dur = document.createElement("span");
      dur.className = "sr-dur";
      dur.textContent = formatTime(song.durata);
      row.appendChild(cover);
      row.appendChild(meta);
      row.appendChild(dur);
      row.addEventListener("click", () => { closeSearchView(); playSong(idx, true); });
      box.appendChild(row);
    });
  }
}

function clearSearch() {
  if (els.search) els.search.value = "";
  runSearch("");
}

/* ---------- Pannello ricerca a schermo ---------- */
function openSearchView() {
  if (!els.searchView) return;
  els.searchView.classList.remove("hidden");
  els.searchView.setAttribute("aria-hidden", "false");
  runSearch(els.search ? els.search.value : "");
  // Focus SINCRONO nel gesto del tap: solo così iOS apre la tastiera
  // subito (un setTimeout spezzerebbe la catena del gesto e la tastiera
  // non si aprirebbe su iPhone/iPad)
  if (els.search) els.search.focus();
}

function closeSearchView() {
  if (!els.searchView) return;
  els.searchView.classList.add("hidden");
  els.searchView.setAttribute("aria-hidden", "true");
  clearSearch();
}

/* ---------- SKELETON mentre carica la playlist ---------- */
function renderSkeletons() {
  if (!els.albumGrid) return;
  els.albumGrid.innerHTML = "";
  for (let i = 0; i < 8; i++) {
    const card = document.createElement("div");
    card.className = "album-card";
    card.setAttribute("aria-hidden", "true");
    const cover = document.createElement("div");
    cover.className = "card-cover skel-cover";
    const l1 = document.createElement("div");
    l1.className = "skel-line";
    l1.style.width = "70%";
    const l2 = document.createElement("div");
    l2.className = "skel-line";
    l2.style.width = "45%";
    card.appendChild(cover);
    card.appendChild(l1);
    card.appendChild(l2);
    els.albumGrid.appendChild(card);
  }
}

/* ---------- TILT 3D copertine home (solo mouse, leggero) ---------- */
function setupTilt() {
  try {
    if (!window.matchMedia) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch (e) { return; }
  if (!els.albumGrid) return;
  let ticking = false;
  els.albumGrid.querySelectorAll(".album-card").forEach((card) => {
    const cover = card.querySelector(".card-cover");
    if (!cover) return;
    card.addEventListener("mousemove", (e) => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const r = cover.getBoundingClientRect();
        if (!r.width) return;
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        cover.classList.add("tilt");
        cover.style.transform =
          "perspective(700px) rotateX(" + (-py * 8).toFixed(2) + "deg)" +
          " rotateY(" + (px * 8).toFixed(2) + "deg)";
      });
    });
    card.addEventListener("mouseleave", () => {
      cover.classList.remove("tilt");
      cover.style.transform = "";
    });
  });
}

/* ---------- BANNER INSTALLA APP (solo web, mai se installata) ---------- */
let deferredPrompt = null;

function isStandalone() {
  try {
    if (window.navigator.standalone === true) return true;
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch (e) {}
  return false;
}

function maybeShowInstallBanner() {
  if (!els.installBanner) return;
  if (isStandalone()) return;                       // già installata: mai
  if (storage.get("ssg-install-hide") === "1") return;   // già scartato
  if (els.installGo && deferredPrompt) els.installGo.classList.remove("hidden");
  els.installBanner.classList.remove("hidden");
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  maybeShowInstallBanner();
});
window.addEventListener("appinstalled", () => {
  storage.set("ssg-install-hide", "1");
  if (els.installBanner) els.installBanner.classList.add("hidden");
});

/* ---------- STATISTICHE (contate in locale) ---------- */
function statsGet() {
  try {
    const s = JSON.parse(storage.get("ssg-stats") || "{}");
    return { plays: s.plays || {}, seconds: s.seconds || 0 };
  } catch (e) { return { plays: {}, seconds: 0 }; }
}

let statsCache = null;
let statsLastSave = 0;
let statsLastTick = 0;

function statsSave(force) {
  if (!statsCache) return;
  const now = Date.now();
  if (!force && now - statsLastSave < 10000) return;   // salva al massimo ogni 10s
  statsLastSave = now;
  storage.set("ssg-stats", JSON.stringify(statsCache));
}

function bumpPlayStat(songIdx) {
  if (songIdx < 0 || !state.songs[songIdx]) return;
  if (!statsCache) statsCache = statsGet();
  const key = state.songs[songIdx].file;
  statsCache.plays[key] = (statsCache.plays[key] || 0) + 1;
  statsSave(true);
}

function trackPlaySeconds() {
  if (!audio || audio.paused) { statsLastTick = 0; return; }
  const now = Date.now();
  if (statsLastTick) {
    if (!statsCache) statsCache = statsGet();
    statsCache.seconds += Math.min(2, (now - statsLastTick) / 1000);
    statsSave(false);
  }
  statsLastTick = now;
}

/* ---------- EQUALIZZATORE (Web Audio, preset) ---------- */
let eqCtx = null, eqFilters = null, eqReady = false;
const EQ_FREQS = [60, 250, 1000, 4000, 12000];
const EQ_PRESETS = {
  piatto:    { label: "Piatto",    gains: [0, 0, 0, 0, 0] },
  bassi:     { label: "Bassi",     gains: [6, 3, 0, 0, -1] },
  voci:      { label: "Voci",      gains: [-2, 1, 4, 3, 0] },
  brillante: { label: "Brillante", gains: [0, 0, 1, 4, 6] }
};

function ensureEQ() {
  if (eqReady) {
    if (eqCtx && eqCtx.state === "suspended") eqCtx.resume().catch(() => {});
    return true;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    eqCtx = new AC();
    const src = eqCtx.createMediaElementSource(audio);
    let node = src;
    eqFilters = EQ_FREQS.map((f, i) => {
      const flt = eqCtx.createBiquadFilter();
      flt.type = i === 0 ? "lowshelf" : (i === EQ_FREQS.length - 1 ? "highshelf" : "peaking");
      flt.frequency.value = f;
      flt.Q.value = 1;
      flt.gain.value = 0;
      node.connect(flt);
      node = flt;
      return flt;
    });
    node.connect(eqCtx.destination);
    eqReady = true;
    applyEQPreset(storage.get("ssg-eq") || "piatto", true);
    return true;
  } catch (e) { return false; }
}

function applyEQPreset(name, silent) {
  const p = EQ_PRESETS[name] || EQ_PRESETS.piatto;
  if (eqReady && eqFilters) {
    eqFilters.forEach((flt, i) => { flt.gain.value = p.gains[i] || 0; });
  }
  storage.set("ssg-eq", name in EQ_PRESETS ? name : "piatto");
  if (els.setEq) {
    els.setEq.querySelectorAll(".chip").forEach((c) => {
      c.classList.toggle("on", c.dataset.eq === (name in EQ_PRESETS ? name : "piatto"));
    });
  }
  if (!silent) toast("Equalizzatore: " + p.label);
}

/* ---------- PANNELLO IMPOSTAZIONI ---------- */
function openSettingsView() {
  if (!els.settingsView) return;
  renderSettings();
  els.settingsView.classList.remove("hidden");
  els.settingsView.setAttribute("aria-hidden", "false");
}

function closeSettingsView() {
  if (!els.settingsView) return;
  els.settingsView.classList.add("hidden");
  els.settingsView.setAttribute("aria-hidden", "true");
}

function fmtMin(sec) {
  const m = Math.floor(sec / 60);
  if (m < 60) return m + " min";
  return Math.floor(m / 60) + " h " + (m % 60) + " min";
}

function renderSettings() {
  // Statistiche
  if (els.setStats) {
    const st = statsGet();
    const entries = Object.keys(st.plays || {});
    const totalPlays = entries.reduce((t, k) => t + (st.plays[k] || 0), 0);
    const top = entries
      .map((k) => ({ k, n: st.plays[k] || 0 }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map((e) => {
        const s = state.songs.find((x) => x.file === e.k);
        return (s ? (s.titolo || fileTitle(s.file)) : "Brano") + " · " + e.n + "×";
      });
    const byAlbum = {};
    entries.forEach((k) => {
      const s = state.songs.find((x) => x.file === k);
      const a = s ? (s.album || "Senza album") : null;
      if (a) byAlbum[a] = (byAlbum[a] || 0) + (st.plays[k] || 0);
    });
    const topAlbum = Object.keys(byAlbum).sort((a, b) => byAlbum[b] - byAlbum[a])[0];
    els.setStats.innerHTML = "";
    const lines = [
      "Brani avviati: " + totalPlays,
      "Ascolto totale: " + fmtMin(st.seconds || 0)
    ];
    if (top.length) lines.push("Top brani: " + top.join(" — "));
    if (topAlbum) lines.push("Album preferito: " + topAlbum);
    if (!totalPlays) lines.push("Ascolta qualcosa e qui vedrai le tue statistiche.");
    lines.forEach((t) => {
      const d = document.createElement("div");
      d.textContent = t;
      els.setStats.appendChild(d);
    });
  }
  // Equalizzatore
  if (els.setEq) {
    els.setEq.innerHTML = "";
    const cur = storage.get("ssg-eq") || "piatto";
    Object.keys(EQ_PRESETS).forEach((name) => {
      const b = document.createElement("button");
      b.className = "chip" + (cur === name ? " on" : "");
      b.dataset.eq = name;
      b.textContent = EQ_PRESETS[name].label;
      b.addEventListener("click", () => {
        if (!ensureEQ()) { toast("Equalizzatore non supportato qui"); return; }
        applyEQPreset(name);
        haptic(10);
      });
      els.setEq.appendChild(b);
    });
  }
  // Brani offline
  renderDlList();
  updateDlInfo();
}

async function updateDlInfo() {
  if (!els.setDlInfo) return;
  let txt = "Nessun album scaricato.";
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const mb = ((est.usage || 0) / 1048576).toFixed(0);
      txt = "Spazio usato dall'app: circa " + mb + " MB.";
    }
  } catch (e) {}
  els.setDlInfo.textContent = txt;
}

function renderDlList() {
  if (!els.setDlList) return;
  els.setDlList.innerHTML = "";
  const done = state.albums.filter(isAlbumDownloaded);
  if (!done.length) {
    const d = document.createElement("div");
    d.className = "set-sub";
    d.textContent = "Scarica un album dal tasto freccia nella sua pagina.";
    els.setDlList.appendChild(d);
    return;
  }
  done.forEach((album) => {
    const row = document.createElement("div");
    row.className = "dl-row";
    const name = document.createElement("span");
    name.textContent = album.title;
    const btn = document.createElement("button");
    btn.className = "dl-btn";
    btn.textContent = "Rimuovi";
    btn.addEventListener("click", async () => {
      await downloadAlbum(album, null);
      renderDlList();
      renderHome();
    });
    row.appendChild(name);
    row.appendChild(btn);
    els.setDlList.appendChild(row);
  });
}

/* ---------- PREFERITI (cuore sui brani + pseudo-album in home) ---------- */

function favSet() {
  try { return new Set(JSON.parse(storage.get("ssg-fav") || "[]")); }
  catch (e) { return new Set(); }
}

function saveFavs(set) {
  storage.set("ssg-fav", JSON.stringify([...set]));
}

function isFav(song) {
  return favSet().has(song.file);
}

function toggleFav(song) {
  const set = favSet();
  if (set.has(song.file)) set.delete(song.file); else set.add(song.file);
  saveFavs(set);
}

function updateFpFav() {
  if (!els.fpFav) return;
  const i = currentIndex();
  const on = i >= 0 && isFav(state.songs[i]);
  els.fpFav.classList.toggle("on", on);
  els.fpFav.classList.toggle("hidden", i < 0);
}

/* ---------- ASCOLTO OFFLINE (scarica album in cache) ---------- */

const AUDIO_CACHE = "ssg-audio-v1";

function isAlbumDownloaded(album) {
  return storage.get("ssg-dl-" + album.title) === "1";
}

async function downloadAlbum(album, btn) {
  if (!("caches" in window)) { toast("Ascolto offline non supportato qui"); return; }
  if (isAlbumDownloaded(album)) {
    // Rimuovi dalla cache offline
    try {
      const cache = await caches.open(AUDIO_CACHE);
      await Promise.all(album.songs.map((i) => {
        const url = new URL(resolvePath(state.songs[i].file), location.href).href;
        return cache.delete(url).catch(() => {});
      }));
    } catch (e) {}
    storage.set("ssg-dl-" + album.title, "0");
    if (btn) btn.classList.remove("done");
    toast("Album rimosso dall'ascolto offline");
    return;
  }
  if (btn) { btn.classList.add("busy"); btn.disabled = true; }
  toast("Scarico l'album per l'ascolto offline\u2026");
  let ok = 0;
  try {
    const cache = await caches.open(AUDIO_CACHE);
    for (const i of album.songs) {
      try {
        const url = new URL(resolvePath(state.songs[i].file), location.href).href;
        const res = await fetch(url);
        if (res && res.ok) { await cache.put(url, res); ok++; }
      } catch (e) {}
    }
  } catch (e) {}
  if (btn) { btn.classList.remove("busy"); btn.disabled = false; }
  if (ok === album.songs.length) {
    storage.set("ssg-dl-" + album.title, "1");
    if (btn) btn.classList.add("done");
    toast("Album scaricato: suona anche offline");
  } else if (ok > 0) {
    toast("Scaricati " + ok + " brani su " + album.songs.length);
  } else {
    toast("Download non riuscito, riprova");
  }
}

/* ---------- ORDINE DI VISUALIZZAZIONE DEGLI ALBUM RICHIESTO ---------- */
const ALBUM_ORDER = [
  "Non è SSG",
  "Testamento",
  "Giorni Migliori",
  "Singoli & Extra",
  "Solo Avanzi",
  "Coconut Ice Cream",
  "Lucciole",
  "D.A.M.S."
];

function buildAlbums() {
  const map = new Map();
  state.songs.forEach((song, i) => {
    const key = song.album || "Senza album";
    if (!map.has(key)) {
      map.set(key, { title: key, artist: song.artista || "", cover: null, totalSec: 0, songs: [] });
    }
    const album = map.get(key);
    album.songs.push(i);
    album.totalSec += song.durata || 0;
    if (!album.cover && song.copertina) album.cover = song.copertina;
  });
  state.albums = [...map.values()];

  /* Applica l'ordine personalizzato; i non elencati restano in coda */
  state.albums.sort((a, b) => {
    const ia = ALBUM_ORDER.indexOf(a.title);
    const ib = ALBUM_ORDER.indexOf(b.title);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  state.flat = [];
  state.albums.forEach((album) => album.songs.forEach((i) => state.flat.push(i)));
}

/* Ripristina shuffle/repeat salvati e volume */
function applySavedState() {
  updateModeButtons();

  const savedVolume = storage.get("mp-volume");
  if (savedVolume !== null) {
    els.volume.value = savedVolume;
    audio.volume = Number(savedVolume);
  }
}

/* Sincronizza gli stati di shuffle e repeat su ENTRAMBE le barre (mini + full) */
function updateModeButtons() {
  els.btnShuffle.classList.toggle("on", state.shuffle);
  els.btnRepeat.classList.toggle("on", state.repeat !== "off");
  els.btnRepeat.classList.toggle("one", state.repeat === "one");
  els.repBadge.classList.toggle("hidden", state.repeat !== "one");

  if (!els.fp) return;
  els.fpShuffle.classList.toggle("on", state.shuffle);
  els.fpRepeat.classList.toggle("on", state.repeat !== "off");
  els.fpRepeat.classList.toggle("one", state.repeat === "one");
  els.fpRepBadge.classList.toggle("hidden", state.repeat !== "one");
}

/* Mostra/nasconde l'icona play/pausa su entrambe le barre */
function setPlayIcons(playing) {
  els.iconPlay.style.display = playing ? "none" : "block";
  els.iconPause.style.display = playing ? "block" : "none";
  if (els.fp) {
    els.fpIconPlay.style.display = playing ? "none" : "block";
    els.fpIconPause.style.display = playing ? "block" : "none";
  }
}

function updateBrandCount() {
  els.brandCount.textContent =
    state.songs.length + " brani · " + state.albums.length + " album · " + APP_BUILD;
}

/* ---------- 6. HOME: griglia album + card Preferiti ---------- */

function renderHome() {
  els.albumGrid.innerHTML = "";

  /* Card PREFERITI in cima: cuore su copertina scura, apre la lista
     dei brani con il cuore (anche vuota, come su Spotify) */
  const favs = [];
  state.songs.forEach((s, i) => { if (favSet().has(s.file)) favs.push(i); });
  const favAlbum = {
    title: "Preferiti",
    artist: "",
    cover: null,
    totalSec: favs.reduce((t, i) => t + (state.songs[i].durata || 0), 0),
    songs: favs,
    isFavs: true
  };

  const favCard = document.createElement("button");
  favCard.className = "album-card";

  const favCover = document.createElement("div");
  favCover.className = "card-cover fav-cover";
  favCover.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
  favCard.appendChild(favCover);

  const favCaption = document.createElement("div");
  favCaption.className = "card-caption";
  const favTitle = document.createElement("div");
  favTitle.className = "card-title";
  favTitle.textContent = "Preferiti";
  const favMeta = document.createElement("div");
  favMeta.className = "card-meta";
  favMeta.textContent = favs.length + " brani · " + formatMinutes(favAlbum.totalSec);
  favCaption.appendChild(favTitle);
  favCaption.appendChild(favMeta);
  favCard.appendChild(favCaption);
  favCard.addEventListener("click", () => openAlbum(favAlbum));
  els.albumGrid.appendChild(favCard);

  state.albums.forEach((album) => {
    const card = document.createElement("button");
    card.className = "album-card";

    const cover = document.createElement("div");
    cover.className = "card-cover";
    buildCover(cover, album.cover, album.title);

    const play = document.createElement("div");
    play.className = "card-play";
    play.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    cover.appendChild(play);

    const caption = document.createElement("div");
    caption.className = "card-caption";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = album.title;

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = album.songs.length + " brani · " + formatMinutes(album.totalSec);

    caption.appendChild(title);
    caption.appendChild(meta);
    card.appendChild(cover);
    card.appendChild(caption);
    card.addEventListener("click", () => openAlbum(album));

    els.albumGrid.appendChild(card);
  });
  fitHomeGrid();
  setupTilt();
}

/* Su PC (>=1200px): dimensiona le copertine della home in modo che le due
   righe di album con i loro titoli stiano sempre dentro lo schermo,
   senza bisogno di scrollare. Misura altezze reali e ricalcola al resize. */
function fitHomeGrid() {
  const grid = els.albumGrid;
  if (!grid || !grid.clientWidth) return;                  // vista nascosta
  if (!window.matchMedia("(min-width: 1200px)").matches) {
    grid.style.removeProperty("--cover-max");
    return;
  }

  /* Su PC la griglia è flex: prende l'altezza RESTANTE sotto intestazione
     e ricerca: da lì si dimensionano le copertine */
  const cs = getComputedStyle(grid);
  const avail = grid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const first = grid.firstElementChild;
  if (!first) return;

  const cap = first.querySelector(".card-caption");
  const captionH = cap ? cap.offsetHeight : 60;

  const cols = 4;
  const gap = 30;                                          // gap riga (verticale)
  const rows = Math.ceil(grid.children.length / cols);
  const coverMax = Math.max(80, Math.floor((avail - gap * (rows - 1) - captionH * rows) / rows) - 2);

  grid.style.setProperty("--cover-max", coverMax + "px");
}

function debouncedResizeFit() { clearTimeout(debouncedResizeFit._t); debouncedResizeFit._t = setTimeout(fitHomeGrid, 180); }
window.addEventListener("resize", debouncedResizeFit);

/* ---------- 7. SCHERMATA ALBUM ---------- */

let currentAlbum = null;   // album visibile sulla schermata album

/* Tasti flottanti sull'hero dell'album (listener freschi a ogni apertura,
  così il play/scarica usano SEMPRE l'album giusto) */
function buildHeroPlay(album) {
  const b = document.createElement("button");
  b.className = "hero-play";
  b.setAttribute("aria-label", "Riproduci l'album");
  b.title = "Riproduci l'album";
  b.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  b.addEventListener("click", () => {
    // Se un brano di QUESTO album è in riproduzione: pausa/riprendi;
    // altrimenti parte il primo brano dell'album
    const cur = currentIndex();
    if (cur >= 0 && album.songs.indexOf(cur) >= 0) togglePlay();
    else playSong(album.songs[0], true);
    haptic(16);
  });
  return b;
}

function buildHeroDl(album) {
  const b = document.createElement("button");
  b.className = "hero-dl" + (isAlbumDownloaded(album) ? " done" : "");
  b.setAttribute("aria-label", "Ascolto offline");
  b.title = isAlbumDownloaded(album)
    ? "Scaricato: tocca per rimuovere" : "Scarica per l'ascolto offline";
  b.innerHTML =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>';
  b.addEventListener("click", () => downloadAlbum(album, b));
  return b;
}

/* Apre la copertina a schermo intero */
function openCoverView() {
  if (!currentAlbum || !currentAlbum.cover) return;
  els.coverViewImg.src = resolvePath(currentAlbum.cover);
  els.coverView.classList.remove("hidden");
}

function closeCoverView() {
  els.coverView.classList.add("hidden");
  els.coverViewImg.src = "";
}

function openAlbum(album) {
  applyAlbumColors(album.title);   // alone/titoli/accenti del colore dell'album
  els.albumTitle.textContent = album.title;
  els.albumMeta.textContent =
    album.songs.length + " brani · " + formatMinutes(album.totalSec) +
    (isRealArtist(album.artist) ? " · " + album.artist : "");
  currentAlbum = album;

  if (album.isFavs) {
    // Preferiti: cuore rosa come nella home, niente "P" del segnaposto
    els.albumCoverWrap.classList.remove("ph");
    els.albumCoverWrap.classList.add("fav-cover");
    els.albumCoverWrap.innerHTML =
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
  } else {
    els.albumCoverWrap.classList.remove("fav-cover");
    buildCover(els.albumCoverWrap, album.cover, album.title);
  }

  // Sfondo sfocato dell'intestazione: usa la stessa copertina
  if (album.cover) {
    els.heroBg.style.backgroundImage = 'url("' + resolvePath(album.cover) + '")';
  } else {
    els.heroBg.style.backgroundImage = "";
  }
  // Preferiti: hero rosa sfumato al posto del cielo stellato
  if (els.albumHero) els.albumHero.classList.toggle("hero-favs", !!album.isFavs);

  // Preferiti: i cuoricini si piazzano dopo showView (vedi placeHearts).
  // Gli altri album svuotano il contenitore subito.
  if (els.heroHearts && !album.isFavs) {
    els.heroHearts.innerHTML = "";
  }

  const albumHead = document.querySelector(".album-head");
  if (albumHead) {
    // Tasti PLAY e SCARICA ai LATI del titolo. Il titolo h1 NON si tocca:
    // rimuovere la riga lo toglieva dal DOM e al secondo openAlbum
    // getElementById tornava null -> appendChild(null) = errore
    let titleRow = albumHead.querySelector(".title-row");
    const h1 = els.albumTitle;
    if (!titleRow) {
      titleRow = document.createElement("div");
      titleRow.className = "title-row";
      titleRow.appendChild(buildHeroPlay(album));
      titleRow.appendChild(h1);      // il titolo si sposta in mezzo ai tasti
      titleRow.appendChild(buildHeroDl(album));
      const eyebrowEl = els.albumEyebrow;
      if (eyebrowEl && eyebrowEl.parentElement === albumHead) eyebrowEl.after(titleRow);
      else albumHead.appendChild(titleRow);
    } else {
      // aperture successive: si sostituiscono SOLO i tasti (listener
      // freschi con l'album giusto), il titolo resta dov'è
      const oldPlay = titleRow.querySelector(".hero-play");
      const oldDl = titleRow.querySelector(".hero-dl");
      if (oldPlay) oldPlay.replaceWith(buildHeroPlay(album));
      if (oldDl) oldDl.replaceWith(buildHeroDl(album));
    }
  }

  // Lista brani dell'album
  els.trackList.innerHTML = "";
  if (els.albumEyebrow) {
    els.albumEyebrow.textContent = album.isFavs ? "Playlist" : "Album";
  }
  album.songs.forEach((songIdx, pos) => {
    const song = state.songs[songIdx];

    const row = document.createElement("button");
    row.className = "track-row";
    row.dataset.idx = songIdx;
    row.style.setProperty("--i", Math.min(pos, 12));   // ingresso scaglionato (max 12 passi)

    const num = document.createElement("span");
    num.className = "track-num";
    /* Il numero lascia il posto all'equalizzatore sulla riga attiva
       (solo quando il brano riproduce, come nel miniplayer) */
    num.innerHTML = '<span class="num-text">' + (pos + 1) + '</span>' +
      '<span class="row-eq" aria-hidden="true"><i></i><i></i><i></i></span>';

    const title = document.createElement("span");
    title.className = "track-title";
    title.textContent = song.titolo || fileTitle(song.file);

    const dur = document.createElement("span");
    dur.className = "track-dur";
    dur.textContent = formatTime(song.durata);

    /* Cuore preferiti (span, non button: la riga è già un button) */
    const heart = document.createElement("span");
    heart.className = "fav-btn" + (isFav(song) ? " on" : "");
    heart.setAttribute("role", "button");
    heart.setAttribute("aria-label", "Preferito");
    heart.innerHTML =
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
    heart.addEventListener("click", (e) => {
      e.stopPropagation();          // non avviare il brano
      toggleFav(song);
      const on = isFav(song);
      heart.classList.toggle("on", on);
      // Reazione: pop del cuore + onda luminosa (riparte anche a clic di fila)
      heart.classList.remove("pop");
      void heart.offsetWidth;
      if (on) heart.classList.add("pop");
      updateFpFav();
      renderHome();                 // la card Preferiti si aggiorna
      haptic(12);
    });

    row.appendChild(num);
    row.appendChild(title);
    row.appendChild(heart);      /* accanto al nome del pezzo (PC: proprio prima del minutaggio) */
    row.appendChild(dur);
    row.addEventListener("click", () => playSong(songIdx, true));

    els.trackList.appendChild(row);
  });

  els.btnBack.classList.remove("hidden");
  showView("album");
  placeHearts(album);   // dopo showView: i rettangoli sono misurabili
  highlightActive();
}

/* Cuoricini rosa nello sfondo dell'hero Preferiti, piazzati SOLO nelle
   zone libere: mai sopra/sotto la copertina né sopra/vicino ai testi.
   Si misura tutto a runtime così vale su telefono e PC. */
function placeHearts(album) {
  const box = els.heroHearts;
  if (!box) return;
  box.innerHTML = "";
  if (!album.isFavs || !els.albumHero) return;
  const heroR = els.albumHero.getBoundingClientRect();
  const coverR = els.albumCoverWrap.getBoundingClientRect();
  const headEl = document.querySelector(".album-head");
  const headR = headEl ? headEl.getBoundingClientRect() : null;
  if (heroR.width < 10 || heroR.height < 10) return;
  const M = 26;   // margine di sicurezza attorno a copertina e testi
  const rel = (r) => ({
    l: r.left - heroR.left - M, rgt: r.right - heroR.left + M,
    t: r.top - heroR.top - M, b: r.bottom - heroR.top + M
  });
  const c = rel(coverR);
  const h = headR ? rel(headR) : null;
  const pinks = ["#ff6b9d", "#ff8fb8", "#f7a8c4", "#e75480", "#ffc2d4"];
  let placed = 0, tries = 0;
  while (placed < 14 && tries < 140) {
    tries++;
    const size = 14 + Math.round(Math.random() * 22);
    const x = Math.random() * Math.max(1, heroR.width - size);
    const y = Math.random() * Math.max(1, heroR.height - size);
    const hitC = x < c.rgt && x + size > c.l && y < c.b && y + size > c.t;
    const hitH = h && x < h.rgt && x + size > h.l && y < h.b && y + size > h.t;
    if (hitC || hitH) continue;
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    s.style.width = size + "px";
    s.style.height = size + "px";
    s.style.left = (x / heroR.width * 100).toFixed(2) + "%";
    s.style.top = (y / heroR.height * 100).toFixed(2) + "%";
    s.style.setProperty("--hr", Math.round(Math.random() * 40 - 20) + "deg");
    s.style.animationDelay = (-Math.random() * 7).toFixed(2) + "s";
    s.style.animationDuration = (5 + Math.random() * 4).toFixed(2) + "s";
    s.style.color = pinks[placed % pinks.length];
    s.style.opacity = (0.25 + Math.random() * 0.35).toFixed(2);
    s.innerHTML = '<path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>';
    box.appendChild(s);
    placed++;
  }
}

/* ---------- 8. NAVIGAZIONE VISTE ---------- */

function showView(name) {
  els.home.classList.toggle("hidden", name !== "home");
  els.albumView.classList.toggle("hidden", name !== "album");
  document.body.classList.toggle("album-open", name === "album");
  els.main.scrollTop = 0;
}

/* ---------- 9. RIPRODUZIONE ---------- */

function currentIndex() {
  return state.queuePos >= 0 ? state.queue[state.queuePos] : -1;
}

/* Anti-corsa sugli skip rapidi: playToken identifica l'ultimo brano
   richiesto (solo il suo retry può partire), audioStarted dice se il brano
   corrente è mai partito DAVVERO (evento "playing"): una play rifiutata da
   iOS non lo tocca, una pausa dell'utente dopo il via lo lascia a true ->
   i retry non combattono mai con l'utente e non dipendono dall'ordine
   degli eventi (il vecchio flag su "pause" si rompeva perché il cambio src
   emette un "pause" fittizio che poteva arrivare DOPO l'azzeramento). */
let playToken = 0;
let audioStarted = false;
let audioErrorRetried = false;

/* Rete di sicurezza per il play: skip rapidissimi / rete lenta -> iOS può
   rifiutare il play mentre il cambio traccia è in corsa. Si riprova a
   250ms, 800ms e 1.8s finché il brano non parte DAVVERO: un solo
   click/skip basta sempre e il recupero è più rapido. */
function riprovaPlay(myToken) {
  setTimeout(() => {
    if (myToken !== playToken || !audio.paused || audioStarted) return;
    audio.play().catch(() => {});
  }, 250);
  setTimeout(() => {
    if (myToken !== playToken || !audio.paused || audioStarted) return;
    audio.play().catch(() => {});
  }, 800);
  setTimeout(() => {
    if (myToken !== playToken || !audio.paused || audioStarted) return;
    audio.play().catch(() => {});
  }, 1800);
}

async function playSong(songIdx, openFull) {
  if (songIdx < 0) return;
  const pos = state.queue.indexOf(songIdx);
  state.queuePos = pos >= 0 ? pos : 0;
  if (pos < 0) state.queue[0] = songIdx;

  const song = state.songs[songIdx];
  document.body.classList.add("has-track");   // fa comparire il miniplayer
  audio.src = resolvePath(song.file);
  bumpPlayStat(songIdx);                      // statistiche: un avvio in più
  ensureEQ();                                 // equalizzatore pronto al primo gesto utile
  /* NIENTE await: il vecchio codice aspettava che audio.play() si risolvesse
     (cioè finché il brano bufferizzava e partiva DAVVERO) prima di aggiornare
     titolo/copertina e aprire il full player: cliccando una canzone la UI
     restava congelata e sembrava lenta. Ora la UI si aggiorna all'istante
     mentre l'audio bufferizza in background. */
  const myToken = ++playToken;      // anti-corsa: solo l'ULTIMO skip comanda
  audioErrorRetried = false;        // nuovo brano: di nuovo un tentativo su errore
  audioStarted = false;             // nuovo brano: non è ancora partito
  audio.play().catch((err) => console.warn("Riproduzione bloccata dal browser:", err));
  /* Skip rapidissimi / rete lenta: iOS può rifiutare il play mentre il
     cambio traccia è ancora in corsa -> player congelato e servivano due
     click. La rete di sicurezza riprova a 400ms e 1s finché il brano non
     parte DAVVERO: un solo click/skip basta sempre. */
  riprovaPlay(myToken);
  updatePlayerInfo(song);
  highlightActive();
  if (openFull) openFullPlayer();   // selezione esplicita -> full player automatico
}

function updatePlayerInfo(song) {
  applyAlbumColors(song.album);   // il full player si veste del colore dell'album
  els.songTitle.textContent = song.titolo || fileTitle(song.file);
  els.songArtist.textContent = isRealArtist(song.artista)
    ? song.artista
    : (song.album || "Senza album");

  const coverSrc = song.copertina;
  const coverName = song.album || "Senza album";

  buildCover(els.cover, coverSrc, coverName);

  if (!els.fp) return;   // full player assente (pagina HTML vecchia): non ci blocchiamo

  buildCover(els.fpCover, coverSrc, coverName);

  updateFpVideo(song);

  // Sfondo sfocato del full player: la stessa copertina
  if (coverSrc) {
    els.fpBg.style.backgroundImage = 'url("' + resolvePath(coverSrc) + '")';
  } else {
    els.fpBg.style.backgroundImage = "";
  }

  els.fpTitle.textContent = song.titolo || fileTitle(song.file);
  els.fpAlbum.textContent = coverName;

  if (isFinite(song.durata)) {
    els.timeDuration.textContent = formatTime(song.durata);
    if (els.fp) els.fpTimeDuration.textContent = formatTime(song.durata);
  }
  updateFpFav();
  updateMediaSession(song);
}

function togglePlay() {
  if (currentIndex() < 0) {
    playSong(state.queue[0], true);
    return;
  }
  if (audio.paused) {
    /* Il click dell'utente comanda: invalida i retry vecchi e ne arma di
       nuovi, così UN SOLO click fa sempre partire il brano anche se il
       primo play viene rifiutato da iOS (corsa di caricamento) */
    const myToken = ++playToken;
    audio.play().catch(() => {});
    ensureEQ();                               // gesto utente: contesto audio ok
    riprovaPlay(myToken);
  } else {
    audio.pause();
  }
}

function skipNext() {
  const len = state.queue.length;
  if (len <= 1) return;
  if (state.queuePos + 1 < len) {
    state.queuePos++;
  } else if (state.repeat !== "off" || state.shuffle) {
    state.queuePos = 0;
  } else {
    return;                          // siamo in fondo e repeat è spento
  }
  playSong(state.queue[state.queuePos]);
}

function skipPrev() {
  const len = state.queue.length;
  if (audio.currentTime > 3) {       // brano appena iniziato -> torna all'inizio
    audio.currentTime = 0;
    return;
  }
  if (state.queuePos - 1 >= 0) {
    state.queuePos--;
  } else {
    state.queuePos = len - 1;        // dall'inizio si torna all'ultimo
  }
  playSong(state.queue[state.queuePos]);
}

/* Evidenzia il brano attivo nello schermo album corrente */
function highlightActive() {
  const active = currentIndex();
  document.querySelectorAll(".track-row").forEach((row) => {
    row.classList.toggle("active", Number(row.dataset.idx) === active);
  });
}

/* ---------- 10. SHUFFLE & RIPETI ---------- */

function shuffledRest(exclude) {
  const rest = [];
  for (let i = 0; i < state.songs.length; i++) {
    if (i !== exclude) rest.push(i);
  }
  for (let i = rest.length - 1; i > 0; i--) {   // Fisher-Yates
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return rest;
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  updateModeButtons();

  const cur = currentIndex();
  if (state.shuffle) {
    state.queue = cur >= 0 ? [cur, ...shuffledRest(cur)] : shuffledRest(-1);
    state.queuePos = 0;
  } else {
    state.queue = state.flat.slice();
    state.queuePos = cur >= 0 ? state.queue.indexOf(cur) : 0;
  }
}

function cycleRepeat() {
  const order = ["off", "all", "one"];
  state.repeat = order[(order.indexOf(state.repeat) + 1) % order.length];
  updateModeButtons();
}

/* ---------- 11. AVANZAMENTO, SEEK, VOLUME ---------- */

function updateProgress() {
  const duration = audio.duration || 0;
  const current = audio.currentTime || 0;
  const pct = duration ? (current / duration * 100) + "%" : "0%";
  els.seekFill.style.width = pct;
  const cur = formatTime(current);
  els.timeCurrent.textContent = cur;
  if (els.fpSeekFill) els.fpSeekFill.style.width = pct;
  if (els.fpTimeCurrent) els.fpTimeCurrent.textContent = cur;
  if (isFinite(duration)) {
    const dur = formatTime(duration);
    els.timeDuration.textContent = dur;
    if (els.fpTimeDuration) els.fpTimeDuration.textContent = dur;
  }
  updatePosition();
}

/* Clic o TRASCINAMENTO sulla barra = seek (scrub live). Funziona con
   mouse e con il dito: si preme e si trascina per spostarsi nel brano. */
function bindSeek(seekEl) {
  let dragging = false;

  const scrub = (e) => {
    if (!isFinite(audio.duration)) return;
    const rect = seekEl.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration;
    updateProgress();
  };

  seekEl.addEventListener("pointerdown", (e) => {
    if (!isFinite(audio.duration)) return;
    dragging = true;
    seekEl.classList.add("dragging");
    seekEl.setPointerCapture(e.pointerId);
    scrub(e);
  });

  seekEl.addEventListener("pointermove", (e) => { if (dragging) scrub(e); });

  const stop = () => {
    dragging = false;
    seekEl.classList.remove("dragging");
  };
  seekEl.addEventListener("pointerup", stop);
  seekEl.addEventListener("pointercancel", stop);
}

bindSeek(els.seek);
if (els.fpSeek) bindSeek(els.fpSeek);

let lastVolume = null;

function setVolume(value) {
  const v = Math.max(0, Math.min(1, Number(value)));
  audio.volume = v;
  els.volume.value = v;
  storage.set("mp-volume", v);
  if (v > 0) lastVolume = v;
}

els.volume.addEventListener("input", () => setVolume(els.volume.value));

// Click sull'icona del volume: silenzia / ripristina (su entrambe le barre)
function toggleMute() {
  if (audio.volume > 0) {
    lastVolume = audio.volume;
    setVolume(0);
  } else {
    setVolume(lastVolume !== null ? lastVolume : 0.8);
  }
}

els.volumeIcon.addEventListener("click", toggleMute);

/* ---------- 12. EVENTI <audio> ---------- */

audio.addEventListener("play", () => {
  setPlayIcons(true);
  document.body.classList.add("is-playing");
  syncPlaybackState();
});
audio.addEventListener("pause", () => {
  setPlayIcons(false);
  document.body.classList.remove("is-playing");
  syncPlaybackState();
});
/* Il brano è partito DAVVERO: i retry di sicurezza non devono più toccare
   nulla (nemmeno se l'utente mette in pausa subito dopo il via) */
audio.addEventListener("playing", () => { audioStarted = true; });

/* Errore di caricamento (capita su skip rapidissimi per una corsa di rete):
   un SOLO tentativo di ripresa dopo 500ms, poi se il file è davvero
   rotto ci si ferma senza loop né schermate di errore */
audio.addEventListener("error", () => {
  if (audioErrorRetried) return;
  audioErrorRetried = true;
  setTimeout(() => { if (audio.paused) audio.play().catch(() => {}); }, 500);
});

// A fine brano: ripeti singolo, altrimenti passa al successivo
audio.addEventListener("ended", () => {
  if (state.repeat === "one") {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  const len = state.queue.length;
  if (state.queuePos + 1 < len) {
    state.queuePos++;
    playSong(state.queue[state.queuePos]);
  } else if (state.repeat === "all" || state.shuffle) {
    state.queuePos = 0;
    playSong(state.queue[0]);
  }
  // altrimenti si ferma in fondo alla playlist
});

audio.addEventListener("timeupdate", updateProgress);
audio.addEventListener("timeupdate", trackPlaySeconds);
audio.addEventListener("loadedmetadata", updateProgress);

/* ---------- MEDIA SESSION (controlli nativi del telefono) ---------- */
/* Mostra copertina, titolo e controlli nel player di sistema (blocca
   schermo/notifica su Android, Control Center su iPhone). La "riproduzione
   casuale / ripeti" dell'app è già rispettata dai pulsanti avanti/indietro. */

const mediaSession = typeof navigator !== "undefined" && navigator.mediaSession
  ? navigator.mediaSession
  : null;

if (mediaSession) {
  /* SENZA catch: se iOS rifiuta il play (capita con skip rapidissimi, quando
     il cambio traccia è ancora in corsa) la rejection non gestita faceva
     comparire la schermata di errore dell'app. Con un retry corto. */
  mediaSession.setActionHandler("play", () => {
    audio.play().catch(() =>
      setTimeout(() => audio.play().catch(() => {}), 300));
  });
  mediaSession.setActionHandler("pause", () => audio.pause());
  mediaSession.setActionHandler("previoustrack", () => skipPrev());
  mediaSession.setActionHandler("nexttrack", () => skipNext());
  mediaSession.setActionHandler("seekto", (e) => {
    if (e.seekTime != null && isFinite(e.seekTime)) {
      audio.currentTime = e.seekTime;
      updateProgress();
    }
  });
  mediaSession.setActionHandler("seekforward", (e) => {
    audio.currentTime = Math.min(audio.duration || 0,
      audio.currentTime + (e.seekOffset || 10));
  });
  mediaSession.setActionHandler("seekbackward", (e) => {
    audio.currentTime = Math.max(0, audio.currentTime - (e.seekOffset || 10));
  });
}

function syncPlaybackState() {
  if (!mediaSession) return;
  try {
    mediaSession.playbackState = audio.paused ? "paused" : "playing";
  } catch (e) {}
}

/* Copertina e titolo nel player di sistema */
function updateMediaSession(song) {
  if (!mediaSession) return;

  const artwork = [];
  if (song.copertina) {
    artwork.push({ src: new URL(resolvePath(song.copertina), location.href).href, sizes: "512x512" });
  }
  artwork.push({ src: new URL("../assets/icons/icon-512.png", location.href).href, sizes: "512x512" });

  try {
    mediaSession.metadata = new MediaMetadata({
      title: song.titolo || fileTitle(song.file),
      artist: isRealArtist(song.artista) ? song.artista : (song.album || ""),
      album: song.album || "",
      artwork
    });
    lastPosState = null;   // forzo l'aggiornamento della posizione
  } catch (e) {}
}

let lastPosState = null;

/* Posizione/barrina nel player nativo: aggiorno solo quando cambia di ~1s */
function updatePosition() {
  if (!mediaSession || typeof mediaSession.setPositionState !== "function") return;
  const dur = audio.duration || 0;
  const pos = audio.currentTime || 0;
  if (!isFinite(dur) || dur <= 0 || !isFinite(pos)) return;

  const p = Math.floor(pos);
  const d = Math.floor(dur);
  if (lastPosState && lastPosState[0] === p && lastPosState[1] === d) return;
  lastPosState = [p, d];

  try {
    mediaSession.setPositionState({ duration: dur, playbackRate: 1, position: pos });
  } catch (e) {}
}

/* ---------- 13. CONTROLLI UI E TASTIERA ---------- */

els.btnPlay.addEventListener("click", togglePlay);
els.btnNext.addEventListener("click", skipNext);
els.btnPrev.addEventListener("click", skipPrev);
els.btnShuffle.addEventListener("click", toggleShuffle);
els.btnRepeat.addEventListener("click", cycleRepeat);
els.btnBack.addEventListener("click", goHome);

/* ---------- RICERCA: pannello, input + cancella ---------- */
if (els.btnSearch) {
  els.btnSearch.addEventListener("click", () => { openSearchView(); haptic(10); });
}

/* ---------- IMPOSTAZIONI: pannello + banner installazione ---------- */
if (els.btnSettings) {
  els.btnSettings.addEventListener("click", () => { openSettingsView(); haptic(10); });
}
if (els.settingsViewClose) {
  els.settingsViewClose.addEventListener("click", closeSettingsView);
}
if (els.settingsView) {
  els.settingsView.addEventListener("click", (e) => {
    if (e.target === els.settingsView) closeSettingsView();   // click fuori
  });
}
if (els.installHide) {
  els.installHide.addEventListener("click", () => {
    storage.set("ssg-install-hide", "1");
    if (els.installBanner) els.installBanner.classList.add("hidden");
  });
}
if (els.installGo) {
  els.installGo.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) {}
    deferredPrompt = null;
    storage.set("ssg-install-hide", "1");
    if (els.installBanner) els.installBanner.classList.add("hidden");
  });
}
maybeShowInstallBanner();
if (els.searchViewClose) {
  els.searchViewClose.addEventListener("click", closeSearchView);
}
if (els.searchView) {
  els.searchView.addEventListener("click", (e) => {
    if (e.target === els.searchView) closeSearchView();   // click fuori
  });
}
if (els.search) {
  els.search.addEventListener("input", () => runSearch(els.search.value));
  els.search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSearchView();
  });
}
if (els.searchClear) {
  els.searchClear.addEventListener("click", () => {
    clearSearch();
    if (els.search) els.search.focus();
  });
}

/* ---------- CUORE nel full player ---------- */
if (els.fpFav) {
  els.fpFav.addEventListener("click", () => {
    const i = currentIndex();
    if (i < 0) return;
    toggleFav(state.songs[i]);
    const on = isFav(state.songs[i]);
    updateFpFav();
    // Reazione pop + onda
    els.fpFav.classList.remove("pop");
    void els.fpFav.offsetWidth;
    if (on) els.fpFav.classList.add("pop");
    haptic(12);
  });
}

/* Copertina album cliccabile -> anteprima a schermo intero */
els.albumCoverWrap.addEventListener("click", openCoverView);
els.coverViewClose.addEventListener("click", closeCoverView);
els.coverView.addEventListener("click", (e) => {
  if (e.target === els.coverView) closeCoverView();   // click fuori dall'immagine
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.coverView && !els.coverView.classList.contains("hidden")) {
    closeCoverView();
  }
});

/* Hard refresh: svuota gli archivi del service worker, lo disinstalla,
   e ricarica su un URL nuovo (così il browser NON può usare la cache).
   Equivale al Ctrl+Shift+R dei browser. */
els.btnRefresh.addEventListener("click", async () => {
  toast("Aggiornamento in corso\u2026");
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (e) {}
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => (reg.unregister ? reg.unregister() : reg.update())));
    }
  } catch (e) {}
  location.replace(location.pathname + "?hard=" + Date.now());
});

function goHome() {
  els.btnBack.classList.add("hidden");
  showView("home");
}

/* Swipe con il dito verso destra nella vista album = torna alla home */
let swipeX = null, swipeY = null;
els.main.addEventListener("touchstart", (e) => {
  if (els.fp && els.fp.classList.contains("open")) return;
  const t = e.changedTouches[0];
  swipeX = t.clientX;
  swipeY = t.clientY;
}, { passive: true });

els.main.addEventListener("touchend", (e) => {
  if (swipeX === null) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipeX;
  const dy = t.clientY - swipeY;
  swipeX = swipeY = null;
  if (dx > 70 && Math.abs(dy) < 50 && els.home.classList.contains("hidden")) {
    goHome();
  }
}, { passive: true });

/* Swipe verso il basso con il full player aperto = lo richiude */
let fpSwipeY = null, fpSwipeX = null;
els.fp.addEventListener("touchstart", (e) => {
  if (!els.fp.classList.contains("open")) return;
  const t = e.changedTouches[0];
  fpSwipeY = t.clientY;
  fpSwipeX = t.clientX;
}, { passive: true });

els.fp.addEventListener("touchend", (e) => {
  if (fpSwipeY === null) return;
  const t = e.changedTouches[0];
  const dy = t.clientY - fpSwipeY;
  const dx = t.clientX - fpSwipeX;
  fpSwipeY = fpSwipeX = null;
  if (dy > 70 && Math.abs(dx) < 90) closeFullPlayer();
}, { passive: true });

/* ---------- 14. FULL PLAYER a tendina ---------- */

function openFullPlayer() {
  if (!els.fp) return;
  els.fp.classList.add("open");
  els.fp.setAttribute("aria-hidden", "false");
  /* Se il video era stato rilasciato alla chiusura (per liberare memoria
     su iOS) lo si ricarica subito qui, prima che l'utente lo veda */
  if (fpHasVideo && fpVideoEl && !fpVideoEl.getAttribute("src") &&
      els.fpVideoToggle && !els.fpVideoToggle.classList.contains("hidden") &&
      currentIndex() >= 0) {
    updateFpVideo(state.songs[currentIndex()]);
  }
  syncFpVideoToAudio();   // il video riprende/se parte insieme alla canzone
}

function closeFullPlayer() {
  if (!els.fp) return;
  els.fp.classList.remove("open");
  els.fp.setAttribute("aria-hidden", "true");
  if (fpVideoEl) {
    fpVideoEl.pause();
    /* NIENTE rilascio del src: la versione con removeAttribute+load()
       su iOS faceva scattare errori fittizi che nascondevano i tasti video
       e disattivava i videoclip per tutta la sessione (segnalato da Marco).
       Il video resta bufferizzato: la riapertura è istantanea. */
  }
}

/* ---------- VIDEOCLIP nel full player ----------
   I brani con un video ufficiale (mappa TRACK_VIDEOS) mostrano nel full
   player il videoclip AL POSTO della copertina, stesse dimensioni del
   riquadro. L'audio resta quello della canzone: il video è muto e
   sincronizzato con play/pausa/seek. Un pulsante "Video" nella barra
   alta permette di tornare alla copertina e viceversa. */
const TRACK_VIDEOS = {
  "Goleador": "assets/video/goleador.mp4?v=3",
  "Gta VI": "assets/video/GTA VI 720p.mp4?v=2"
};

let fpVideoEl = null;     // elemento <video> dentro la copertina del full player
let fpHasVideo = false;   // il brano corrente ha un videoclip?
let fpVideoOn = true;     // preferenza utente: video visibile (true) o copertina (false)
let fpLastDriftSync = 0;  // istante dell'ultima correzione di deriva in fullscreen
let fpStartSyncPending = false; // riallineo al frame in attesa del "playing"
let fpLastRateNudge = 0;  // istante dell'ultimo micro-aggiustamento di velocità
let fpLastVideoTime = -1; // ultimo currentTime del video (per rilevare gli stalli)
let fpStallChecks = 0;    // quanti check di fila il video non è avanzato

/* Ricava il file copertina più vicino possibile allo slug indicato nei JSON:
   i brani salvano "assets/covers/COCONUT_ICE_CR_MIX" (slug accorciato) ma i
   file hanno nomi completi ("..._-_SSG.jpeg"). La copertina va risolta per
   prefisso in runtime, così ogni album trova la sua immagine vera. */
function resolveCover(src) {
  if (!src) return "";
  if (/\.(jpe?g|png|webp)$/i.test(src)) return src;   // già estensione esplicita
  const slug = String(src).split("/").pop();
  const dir = "assets/covers/";
  try {
    const files = [...new Set(
      document.querySelectorAll('link[rel="preload"][as="image"]')
    )].length ? [] : assetCoverFiles;
    const hit = files.find((f) => f.startsWith(slug) || slug.startsWith(f.split("_")[0]));
    if (hit) return dir + hit;
  } catch (e) {}
  return src;   // nessun match: resterà il segnaposto iniziali
}

/* Indice dei file copertina esistenti (caricato via fetch + JSON) */
let assetCoverFiles = null;
let assetCoverFilesLoaded = false;

function ensureFpVideo() {
  if (fpVideoEl || !els.fpCover) return fpVideoEl;
  fpVideoEl = document.createElement("video");
  fpVideoEl.className = "fp-video hidden";
  fpVideoEl.muted = true;               // l'audio arriva dall'elemento audio principale
  fpVideoEl.loop = true;                // se il video è più corto della canzone riparte
  fpVideoEl.playsInline = true;         // iOS: niente fullscreen automatico
  fpVideoEl.setAttribute("playsinline", "");
  fpVideoEl.preload = "metadata";   // niente download dei ~22MB all'apertura: solo l'header, il resto arriva al play
  fpVideoEl.addEventListener("error", () => {
    // Video mancante/non leggibile: torna la copertina e sparisce il pulsante.
    // MA un errore su un elemento SENZA src (o evento fittizio di iOS su un
    // elemento fermo) non è un errore vero: non deve nascondere nulla.
    if (!fpVideoEl.getAttribute("src")) return;
    if (fpVideoEl.readyState === 0 && !fpVideoEl.error) return;
    fpHasVideo = false;
    fpVideoEl.classList.add("hidden");
    if (els.fpVideoToggle) els.fpVideoToggle.classList.add("hidden");
  });
  fpVideoEl.addEventListener("webkitendfullscreen", () => {
    // iOS: usciti dal player nativo il video resta fermo con la decodifica
    // fermata. Prima si riallinea la canzone al video (che fin lì comandava),
    // poi syncFpVideoToAudio lo fa ripartire senza rifare seek immediati
    // (erano loro a bloccare la decodifica e congelare il video)
    fpAlignAudioToVideo();
    syncFpVideoToAudio();
  });
  /* Fullscreen nativo: l'utente sfoglia/pausa il video -> la canzone segue */
  fpVideoEl.addEventListener("seeked", () => {
    if (fpHasVideo && fpVideoFullscreen() && isFinite(audio.duration) && isFinite(fpVideoEl.duration) &&
        Math.abs(fpVideoEl.duration - audio.duration) < 3 &&
        Math.abs((audio.currentTime || 0) - fpVideoEl.currentTime) > 0.25) {
      audio.currentTime = fpVideoEl.currentTime;
    }
  });
  fpVideoEl.addEventListener("pause", () => {
    // Debounce 300ms: iOS in fullscreen emette pause spurie durante lo scrub,
    // fermare subito l'audio su un evento fittizio blocca tutto
    if (!fpHasVideo || !fpVideoFullscreen()) return;
    setTimeout(() => {
      if (fpVideoEl.paused && !audio.paused) audio.pause();
    }, 300);
  });
  fpVideoEl.addEventListener("play", () => {
    if (!fpHasVideo || !fpVideoFullscreen()) return;
    setTimeout(() => {
      if (!fpVideoEl.paused && audio.paused) audio.play().catch(() => {});
    }, 300);
  });
  /* La correzione di deriva e il rilevamento stalli girano sul TIMEUPDATE
     dell'AUDIO (fpDriftCheck): l'audio è il conduttore e i suoi eventi
     arrivano sempre, anche quando il video è congelato: così si riprende. */
  return fpVideoEl;
}

function updateFpVideo(song) {
  if (!els.fp) return;
  const src = TRACK_VIDEOS[song.titolo];
  fpHasVideo = !!src;
  const toggle = els.fpVideoToggle;

  if (!fpHasVideo) {
    if (fpVideoEl) { fpVideoEl.pause(); fpVideoEl.classList.add("hidden"); }
    if (toggle) toggle.classList.add("hidden");
    if (els.fpVideoFs) els.fpVideoFs.classList.add("hidden");
    els.fpCover.classList.remove("playing-video");   // riquadro di nuovo quadrato
    return;
  }

  const v = ensureFpVideo();
  if (!v) return;
    if (toggle) toggle.classList.remove("hidden");
    if (els.fpVideoFs) els.fpVideoFs.classList.remove("hidden");

  // Appende il video dentro il riquadro copertina (buildCover svuota il box)
  if (v.parentElement !== els.fpCover) els.fpCover.appendChild(v);
  // Il tasto "Tutto schermo" galleggia sopra il video (angolo alto destro):
  // buildCover svuota il riquadro a ogni cambio brano, quindi lo riattacco
  if (els.fpVideoFs && els.fpVideoFs.parentElement !== els.fpCover) {
    els.fpCover.appendChild(els.fpVideoFs);
  }
  /* Il src si riscrive SOLO se cambia davvero: prima ogni skip da/verso un
     brano con video ricaricava tutto il clip (22MB) da capo — lento e su
     iOS le corse di caricamento possono rompersi. Tornando sul brano il
     video riparte istantaneo da dov'era. */
  const fullSrc = resolvePath(src);
  if (v.getAttribute("src") !== fullSrc) {
    v.setAttribute("src", fullSrc);
    v.preload = "auto";   // bufferizza il videoclip mentre sei nel full player:
                          // play istantaneo (niente lag iniziale) e seek fluidi
                          // in fullscreen. All'apertura dell'app non scarica
                          // nulla: parte solo quando apri un brano con video.
    try { v.currentTime = 0; } catch (e) {}
  }

  // Riquadro rettangolare quando il video è visibile (classi annidate no-dip)
  els.fpCover.classList.toggle("playing-video", fpVideoOn);
  v.classList.toggle("hidden", !fpVideoOn);
  syncFpVideoToAudio();
}

/* Il video è attualmente a tutto schermo? (API standard o player nativo iOS) */
function fpVideoFullscreen() {
  return !!(document.fullscreenElement ||
    (fpVideoEl && fpVideoEl.webkitDisplayingFullscreen));
}

/* Fa ripartire il video in modo robusto: su iOS, appena usciti dal player
   nativo, il primo play() spesso non basta (la decodifica è ferma). Si
   riprova dopo 250ms e 900ms. MAI se la canzone è in pausa (non si deve
   mai vedere un video che gira da solo senza audio). */
function fpVideoResume() {
  if (!fpVideoEl || audio.paused) return;
  if (!fpVideoEl.paused) return;
  const attempt = () => {
    try {
      fpVideoEl.playbackRate = 1;   // mai ripartire con una velocità di nudge
      const p = fpVideoEl.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  };
  attempt();
  setTimeout(() => { if (fpVideoEl && fpVideoEl.paused && !audio.paused) attempt(); }, 250);
  setTimeout(() => { if (fpVideoEl && fpVideoEl.paused && !audio.paused) attempt(); }, 900);
}

/* Allinea la CANZONE al video (si usa quando il video comandava:
   in fullscreen e appena usciti, così non salta indietro) */
function fpAlignAudioToVideo() {
  if (!fpVideoEl || !fpHasVideo) return;
  try {
    if (isFinite(audio.duration) && isFinite(fpVideoEl.duration) &&
        Math.abs(fpVideoEl.duration - audio.duration) < 3 &&
        Math.abs((audio.currentTime || 0) - fpVideoEl.currentTime) > 0.25) {
      audio.currentTime = fpVideoEl.currentTime;
    }
  } catch (e) {}
}

/* Allinea il VIDEO alla canzone appena il video parte DAVVERO: la decodifica
   introduce un ritardo e senza questo riallineo il video parte indietro.
   Il seek avviene SOLO quando il video sta già girando: rifarlo subito dopo
   play() aborted la decodifica iOS e congelava il video. */
function fpAlignVideoOnPlaying() {
  if (!fpVideoEl) return;
  if (fpStartSyncPending) return;
  fpStartSyncPending = true;
  fpVideoEl.addEventListener("playing", () => {
    fpStartSyncPending = false;
    try {
      if (fpHasVideo && !fpVideoFullscreen() && !audio.paused &&
          isFinite(fpVideoEl.duration) && isFinite(audio.duration) &&
          Math.abs(fpVideoEl.duration - audio.duration) < 3 &&
          Math.abs((audio.currentTime || 0) - fpVideoEl.currentTime) > 0.25) {
        fpVideoEl.playbackRate = 1;
        fpVideoEl.currentTime = audio.currentTime % fpVideoEl.duration;
      }
    } catch (e2) {}
  }, { once: true });
}

/* Il video segue la canzone: parte/pausa con lei e si riallinea ai salti.
   In fullscreen nativo invece il video COMANDA: l'utente lo sfoglia/pausa
   dal player iOS, quindi la canzone segue lui e non si riscrive mai il
   currentTime del video (altrimenti il seek dell'utente verrebbe annullato). */
function syncFpVideoToAudio() {
  if (!fpVideoEl || !fpHasVideo) return;
  if (fpVideoFullscreen()) {
    if (audio.paused !== fpVideoEl.paused) {
      if (fpVideoEl.paused) audio.pause(); else audio.play().catch(() => {});
    }
    return;
  }
  if (audio.paused) {
    fpVideoEl.pause();
    return;
  }
  // Canzone in riproduzione -> il video deve andare e restare sincronizzato
  fpVideoResume();
  fpAlignVideoOnPlaying();
}

/* Correzione di deriva + rilevamento stalli, in OGNI situazione. Gira sul
   timeupdate dell'AUDIO (~4 eventi al secondo finché suona): anche se il
   video è congelato gli eventi arrivano lo stesso e lo si sblocca.
   (Il loop rAF a 60fps era un disastro su iPhone: cambiava la velocità
   troppo spesso e mandava la decodifica in panne: si torna al timeupdate.)
   - Fullscreen: comanda il video -> si corregge la canzone (raro).
   - Fuori dal fullscreen: comanda la canzone ->
       * video fermo/pausa mentre la canzone va -> si fa ripartire;
       * video che non avanza da ~1.2s (stallo) -> si riporta sulla canzone;
       * scarto grande (>1s) -> seek del video (raro, max 1 ogni 3s);
       * scarto piccolo (0.1-1s) -> micro-velocità (1.08x/0.92x) SENZA seek:
         la decodifica non si interrompe mai, il video non scatta e non
         si blocca, e riallinea la deriva in un paio di secondi. */
function fpDriftCheck() {
  if (!fpHasVideo || !fpVideoEl || audio.paused) return;
  if (!isFinite(audio.duration) || !isFinite(fpVideoEl.duration)) return;
  const durMatch = Math.abs(fpVideoEl.duration - audio.duration) < 3;
  const drift = (audio.currentTime || 0) - (fpVideoEl.currentTime || 0);
  const now = Date.now();

  if (fpVideoFullscreen()) {
    // Il video comanda: correzione RARA della canzone, come prima
    if (durMatch && now - fpLastDriftSync >= 10000 && Math.abs(drift) > 1.5) {
      try { audio.currentTime = fpVideoEl.currentTime; } catch (e) {}
      fpLastDriftSync = now;
    }
    fpLastVideoTime = -1;
    fpStallChecks = 0;
    return;
  }

  // Fuori dal fullscreen: comanda la canzone
  if (!durMatch) return;

  if (fpVideoEl.paused) {          // video fermo mentre la canzone va: riparte
    fpStallChecks = 0;
    fpLastVideoTime = -1;
    fpVideoResume();
    return;
  }

  // Rilevamento stallo: il video non avanza (~2s di check di fila).
  // Soglia prudente: con i timeupdate dell'audio e del video non
  // sincronizzati tra loro, pochi check di fila possono sembrare uno stallo
  if (fpLastVideoTime >= 0 && Math.abs(fpVideoEl.currentTime - fpLastVideoTime) < 0.04) {
    fpStallChecks++;
    if (fpStallChecks >= 8) {
      try {
        fpVideoEl.playbackRate = 1;
        fpVideoEl.currentTime = Math.max(0, Math.min(fpVideoEl.duration - 0.05, audio.currentTime));
      } catch (e) {}
      fpStallChecks = 0;
      fpLastVideoTime = -1;
      fpLastDriftSync = now;
      return;
    }
  } else {
    fpStallChecks = 0;
  }
  fpLastVideoTime = fpVideoEl.currentTime;

  if (Math.abs(drift) <= 0.1) {    // sincronizzati: velocità normale
    try { if (fpVideoEl.playbackRate !== 1) fpVideoEl.playbackRate = 1; } catch (e) {}
    return;
  }
  if (Math.abs(drift) > 1.0) {     // scarto grande: seek del video (raro)
    if (now - fpLastDriftSync >= 3000) {
      try {
        fpVideoEl.playbackRate = 1;
        fpVideoEl.currentTime = Math.max(0, Math.min(fpVideoEl.duration - 0.05, audio.currentTime));
      } catch (e) {}
      fpLastDriftSync = now;
    }
  } else if (now - fpLastRateNudge >= 1200) {
    // Scarto piccolo: micro-accelerazione/rallentamento senza seek.
    // GENTILI (1.05x/0.95x): su iOS ogni cambio di velocità può far
    // scattare un attimo la decodifica, più sono piccoli meno si sentono
    try { fpVideoEl.playbackRate = drift > 0 ? 1.05 : 0.95; } catch (e) {}
    fpLastRateNudge = now;
  }
}

/* Fullscreen: l'utente muove/pausa il video dal player nativo -> la canzone
   segue (valgono solo lì: fuori dal fullscreen comanda l'audio). I listener
   stanno dentro ensureFpVideo perché l'elemento video nasce lì. */

audio.addEventListener("play", syncFpVideoToAudio);
audio.addEventListener("pause", syncFpVideoToAudio);

/* La canzone viene sfogliata (seek bar, tastiera, player di sistema):
   il video salta subito al nuovo punto e resta sincronizzato */
audio.addEventListener("seeked", () => {
  if (!fpHasVideo || !fpVideoEl || fpVideoFullscreen()) return;
  if (audio.paused) { syncFpVideoToAudio(); return; }
  fpVideoResume();
  try {
    if (isFinite(fpVideoEl.duration) && isFinite(audio.duration) &&
        Math.abs(fpVideoEl.duration - audio.duration) < 3 &&
        Math.abs((audio.currentTime || 0) - fpVideoEl.currentTime) > 0.25) {
      fpVideoEl.playbackRate = 1;
      fpVideoEl.currentTime = audio.currentTime % fpVideoEl.duration;
    }
  } catch (e) {}
});

/* Rete di sicurezza: deriva, stalli e ripresa controllati dal timeupdate
   dell'audio in OGNI situazione (il loop rAF non gira in scheda nascosta) */
audio.addEventListener("timeupdate", fpDriftCheck);

if (els.fp) {
  // Clic sulla copertina/brano nella barra in basso -> apre il full player
  els.trackInfo.addEventListener("click", openFullPlayer);
  els.fpCollapse.addEventListener("click", closeFullPlayer);
  els.fpPlay.addEventListener("click", togglePlay);
  els.fpNext.addEventListener("click", skipNext);
  els.fpPrev.addEventListener("click", skipPrev);
  els.fpShuffle.addEventListener("click", toggleShuffle);
  els.fpRepeat.addEventListener("click", cycleRepeat);
  els.fpShare.addEventListener("click", toggleShareMenu);
  els.fpShareLink.addEventListener("click", () => { toggleShareMenu(); shareLink(); });
  els.fpShareCover.addEventListener("click", () => { toggleShareMenu(); shareCover(); });
  if (els.fpVideoToggle) {
    els.fpVideoToggle.addEventListener("click", () => {
      if (!fpHasVideo || !fpVideoEl) return;
      fpVideoOn = !fpVideoOn;
      fpVideoEl.classList.toggle("hidden", !fpVideoOn);
      els.fpCover.classList.toggle("playing-video", fpVideoOn);
      if (fpVideoOn) syncFpVideoToAudio(); else fpVideoEl.pause();
      haptic(12);
    });
  }

  // Tasto "Tutto schermo" (e click sul video) per il videoclip: apre il clip
  // in fullscreen; uscendo torna allo stato precedente (copertina o video)
  const fpFsBtn = els.fpVideoFs;
  const goFs = async () => {
    if (!fpHasVideo || !fpVideoEl) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        // Allinea la canzone al video PRIMA di consegnare il controllo
        // all'utente: si entra in fullscreen già sincronizzati
        fpAlignAudioToVideo();
        if (fpVideoEl.requestFullscreen) {
          await fpVideoEl.requestFullscreen();
        } else if (fpVideoEl.webkitEnterFullscreen) {
          // iOS: il player nativo presenta il video solo se è in riproduzione
          if (fpVideoEl.paused) { try { await fpVideoEl.play(); } catch (e3) {} }
          fpVideoEl.webkitEnterFullscreen();
        }
      }
    } catch (e) {}
    haptic(12);
  };
  if (fpFsBtn) fpFsBtn.addEventListener("click", goFs);
  if (fpVideoEl) fpVideoEl.addEventListener("click", () => {
    if (fpHasVideo && fpVideoOn) goFs();   // solo se il video è visibile
  });
  document.addEventListener("fullscreenchange", () => {
    if (fpVideoEl && !document.fullscreenElement) {
      // Usciti dal fullscreen (desktop/Android): la canzone si riallinea al
      // video (che fin lì comandava), poi il video riparte e resta sync
      fpAlignAudioToVideo();
      fpVideoResume();
      syncFpVideoToAudio();
    }
  });

  // Trascina verso il basso sulla zona alta (pillina) -> chiudi la tendina
  let fpDragStart = null;
  els.fpHandle.addEventListener("pointerdown", (e) => {
    if (e.target === els.fpCollapse) return;                 // il chevron gestisce il proprio click
    if (e.target.closest(".fp-share-wrap")) return;          // il menu Condividi gestisce il proprio click
    if (e.target.closest("#fp-video-toggle")) return;        // il tasto Video gestisce il proprio click
    if (e.target.closest("#fp-video-fs")) return;            // il tasto Tutto schermo gestisce il proprio click
    fpDragStart = e.clientY;
    els.fpHandle.setPointerCapture(e.pointerId);
  });
  els.fpHandle.addEventListener("pointermove", (e) => {
    if (fpDragStart === null) return;
    const dy = e.clientY - fpDragStart;
    if (dy > 60) closeFullPlayer();
  });
  els.fpHandle.addEventListener("pointerup", () => { fpDragStart = null; });
}

// Spazio = play/pausa (se un pulsante ha il focus, lo tolgo per non doppio-click).
// Esc: chiude il full player se aperto, altrimenti torna alla home.
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "BUTTON") e.target.blur();
  if (e.code === "Space" && e.target.tagName !== "INPUT") {
    e.preventDefault();
    togglePlay();
  } else if (e.key === "ArrowRight") {
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
  } else if (e.key === "ArrowLeft") {
    audio.currentTime = Math.max(0, audio.currentTime - 5);
  } else if (e.key === "Escape") {
    if (els.settingsView && !els.settingsView.classList.contains("hidden")) closeSettingsView();
    else if (els.searchView && !els.searchView.classList.contains("hidden")) closeSearchView();
    else if (els.fp && els.fp.classList.contains("open")) closeFullPlayer();
    else goHome();
  }
});

/* ---------- CIELO STELLATO IN CANVAS ----------
   Sostituisce i vecchi tasselli CSS (si ripetevano e il brillio era per
   intero strato). Strato STATICo dipinto UNA volta al load/resize:
   3 piani di stelle uniche + Via Lattea con stelle dense + nebulose +
   vignetta notturna. Strato VIVO: stelle che brillano INDIVIDUALMENTE
   (ognuna con fase e ritmo propri) + stelle cadenti vere con scia
   sfumata a intervalli casuali. Il loop si ferma con la scheda nascosta
   (batteria) e con prefers-reduced-motion resta solo lo statico. */
const SKY = (function () {
  const staticC = $("sky-static");
  const liveC = $("sky-live");
  if (!staticC || !liveC || !staticC.getContext) {
    return { resize: function () {} };
  }

  const sctx = staticC.getContext("2d");
  const lctx = liveC.getContext("2d");
  // Connessione lenta o risparmio dati attivo: si alleggerisce il cielo
  // (niente stelle cadenti, poche vive, risoluzione base). Protetto con
  // try/catch: se l'API non esiste non cambia nulla e non si rompe niente.
  let ecoMode = false;
  try {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && (conn.saveData === true ||
        (typeof conn.effectiveType === "string" && conn.effectiveType.indexOf("2g") >= 0))) {
      ecoMode = true;
    }
  } catch (e) {}
  const DPR = ecoMode ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0;
  let rafId = 0;
  let running = false;
  const COUNTS = { far: 150, mid: 75, near: 26 };   // usati da buildStars e drawStatic

  const STARS = [];      // statico
  const TWINKLERS = [];  // le stelle vive
  const SHOOTERS = [];   // le cadenti attive

  const TINTS = [
    [255, 255, 255],
    [236, 232, 255],
    [212, 203, 255],
    [182, 176, 255],
    [190, 214, 255],
    [255, 224, 178]
  ];

  function rand(a, b) { return a + Math.random() * (b - a); }
  function rgb(c) { return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")"; }

  function buildStars() {
    STARS.length = 0;
    TWINKLERS.length = 0;
    // Densità in base allo schermo: un telefono non disegna 800 stelle.
    // I conteggi stanno fuori (li usa anche drawStatic per la Via Lattea:
    // erano dichiarati qui dentro e drawStatic lanciava ReferenceError
    // facendo morire TUTTO lo script: caricamento infinito)
    const k = Math.min(1.6, Math.max(.7, (W * H) / (400 * 800)));
    COUNTS.far = Math.round(150 * k);
    COUNTS.mid = Math.round(75 * k);
    COUNTS.near = Math.round(26 * k);

    for (let i = 0; i < COUNTS.far; i++) {           // lontane: minuscole e tenui
      STARS.push({ x: Math.random() * W, y: Math.random() * H,
        r: rand(.4, .8), a: rand(.25, .5), c: TINTS[(Math.random() * TINTS.length) | 0] });
    }
    for (let i = 0; i < COUNTS.mid; i++) {           // medie
      STARS.push({ x: Math.random() * W, y: Math.random() * H,
        r: rand(.8, 1.3), a: rand(.4, .75), c: TINTS[(Math.random() * TINTS.length) | 0] });
    }
    for (let i = 0; i < COUNTS.near; i++) {          // vicine: brillanti, qualcuna con alone
      STARS.push({ x: Math.random() * W, y: Math.random() * H,
        r: rand(1.3, 2.1), a: rand(.6, .95), c: TINTS[(Math.random() * TINTS.length) | 0],
        halo: Math.random() < .3 });
    }

    const nTw = ecoMode ? 6 : Math.round(20 + COUNTS.near * .7);   // le stelle vive
    for (let i = 0; i < nTw; i++) {
      TWINKLERS.push({ x: Math.random() * W, y: Math.random() * H,
        r: rand(.9, 1.7), base: rand(.45, .85), amp: rand(.2, .45),
        phase: Math.random() * Math.PI * 2, speed: rand(.5, 1.4),
        c: TINTS[(Math.random() * TINTS.length) | 0] });
    }
  }

  function drawStatic() {
    sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    sctx.clearRect(0, 0, W, H);

    // Nebulose pre-renderizzate nel canvas (il CSS non le raddoppia)
    [[W * .12, H * .08, W * .5, "rgba(124,108,255,.2)"],
     [W * .9, H * .88, W * .45, "rgba(79,157,255,.18)"],
     [W * .74, H * .15, W * .35, "rgba(168,148,255,.14)"],
     [W * .26, H * .92, W * .3, "rgba(98,142,255,.13)"]].forEach(function (n) {
      const g = sctx.createRadialGradient(n[0], n[1], 0, n[0], n[1], n[2]);
      g.addColorStop(0, n[3]);
      g.addColorStop(1, "rgba(0,0,0,0)");
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, W, H);
    });

    // VIA LATTEA: fascia diagonale sfumata con stelle dense e tenui
    sctx.save();
    sctx.translate(W / 2, H / 2);
    sctx.rotate(-24 * Math.PI / 180);
    const bandW = Math.max(W, H) * .34;
    const bandH = Math.max(W, H) * 1.5;
    const bg = sctx.createLinearGradient(-bandW / 2, 0, bandW / 2, 0);
    bg.addColorStop(0, "rgba(190,180,255,0)");
    bg.addColorStop(.35, "rgba(190,180,255,.06)");
    bg.addColorStop(.5, "rgba(255,255,255,.09)");
    bg.addColorStop(.65, "rgba(190,180,255,.06)");
    bg.addColorStop(1, "rgba(190,180,255,0)");
    sctx.fillStyle = bg;
    sctx.fillRect(-bandW / 2, -bandH / 2, bandW, bandH);
    const bandStars = Math.round(COUNTS.far * .9);
    for (let i = 0; i < bandStars; i++) {
      const x = rand(-bandW / 2, bandW / 2);
      const y = rand(-bandH / 2, bandH / 2);
      const dens = 1 - Math.abs(x) / (bandW / 2);   // più dense al centro
      if (Math.random() > dens * .9) continue;
      sctx.globalAlpha = rand(.15, .45);
      sctx.fillStyle = rgb(TINTS[(Math.random() * TINTS.length) | 0]);
      sctx.fillRect(x, y, rand(.5, 1), rand(.5, 1));
    }
    sctx.globalAlpha = 1;
    sctx.restore();

    // Stelle statiche (3 piani)
    STARS.forEach(function (s) {
      if (s.halo) {
        const g = sctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5);
        g.addColorStop(0, "rgba(" + s.c[0] + "," + s.c[1] + "," + s.c[2] + ",.28)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        sctx.fillStyle = g;
        sctx.beginPath();
        sctx.arc(s.x, s.y, s.r * 5, 0, 7);
        sctx.fill();
      }
      sctx.globalAlpha = s.a;
      sctx.fillStyle = rgb(s.c);
      sctx.beginPath();
      sctx.arc(s.x, s.y, s.r, 0, 7);
      sctx.fill();
    });
    sctx.globalAlpha = 1;

    // Vignetta notturna: i bordi del cielo più scuri
    const vg = sctx.createRadialGradient(W / 2, H * .42, Math.min(W, H) * .35,
      W / 2, H * .42, Math.max(W, H) * .78);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(2,2,8,.5)");
    sctx.fillStyle = vg;
    sctx.fillRect(0, 0, W, H);
  }

  function spawnShooter() {
    const fromTop = Math.random() < .7;
    SHOOTERS.push({
      x: fromTop ? rand(W * .1, W) : W * rand(1.02, 1.15),
      y: fromTop ? -20 : rand(H * .05, H * .45),
      vx: -rand(320, 520), vy: rand(180, 300),
      life: 0, ttl: rand(.9, 1.5), len: rand(90, 170)
    });
  }

  function drawLive(tSec, dt) {
    lctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    lctx.clearRect(0, 0, W, H);

    // Brillio INDIVIDUALE: ogni stella con la sua fase e il suo ritmo
    TWINKLERS.forEach(function (s) {
      const tw = s.base + Math.sin(tSec * s.speed * 2 + s.phase) * s.amp;
      lctx.globalAlpha = Math.max(.06, Math.min(1, tw));
      lctx.fillStyle = rgb(s.c);
      lctx.beginPath();
      lctx.arc(s.x, s.y, s.r, 0, 7);
      lctx.fill();
    });
    lctx.globalAlpha = 1;

    // Stelle cadenti con scia sfumata
    for (let i = SHOOTERS.length - 1; i >= 0; i--) {
      const sh = SHOOTERS[i];
      sh.life += dt;
      const k = sh.life / sh.ttl;
      if (k >= 1) { SHOOTERS.splice(i, 1); continue; }
      const fade = Math.sin(k * Math.PI);          // entra e esce dolcemente
      const nx = sh.x - sh.vx * (sh.len / 400);
      const ny = sh.y - sh.vy * (sh.len / 400);
      const g = lctx.createLinearGradient(sh.x, sh.y, nx, ny);
      g.addColorStop(0, "rgba(255,255,255," + (.85 * fade).toFixed(3) + ")");
      g.addColorStop(1, "rgba(180,170,255,0)");
      lctx.strokeStyle = g;
      lctx.lineWidth = 1.6;
      lctx.beginPath();
      lctx.moveTo(sh.x, sh.y);
      lctx.lineTo(nx, ny);
      lctx.stroke();
      lctx.globalAlpha = fade;
      lctx.fillStyle = "#fff";
      lctx.beginPath();
      lctx.arc(sh.x, sh.y, 1.5, 0, 7);
      lctx.fill();
      lctx.globalAlpha = 1;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
    }
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(.05, (now - (loop._last || now)) / 1000);
    loop._last = now;
    if (!loop._next || now >= loop._next) {        // una cadente ogni 4-9s
      if (!ecoMode && SHOOTERS.length < 3) spawnShooter();
      loop._next = now + rand(4000, 9000);
    }
    drawLive(now / 1000, dt);
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running || reduce) return;
    running = true;
    loop._last = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    [staticC, liveC].forEach(function (c) {
      c.width = Math.round(W * DPR);
      c.height = Math.round(H * DPR);
      c.style.width = W + "px";
      c.style.height = H + "px";
    });
    buildStars();
    drawStatic();
    if (!reduce) drawLive(0, 0);
  }

  // Scheda nascosta: il loop si ferma (batteria)
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  // Scroll in corso: il loop live si ferma (il telefono non fatica),
  // riparte da solo 220ms dopo l'ultimo scroll. Le stelle fisse restano.
  let scrollT = 0;
  function busyScroll() {
    stop();
    clearTimeout(scrollT);
    scrollT = setTimeout(function () { if (!document.hidden) start(); }, 220);
  }
  [els.main, els.trackList, els.searchResults].forEach(function (el) {
    if (el) el.addEventListener("scroll", busyScroll, { passive: true });
  });

  let rsT = 0;
  window.addEventListener("resize", function () {
    clearTimeout(rsT);
    rsT = setTimeout(resize, 160);
  });

  resize();
  start();

  return { resize: resize };
})();

/* ---------- 14. AVVIO ---------- */

/* Qualunque errore JavaScript: messaggio a comparsa (toast) + console,
   MA la pagina NON viene più cancellata: su iOS gli errori/rejection
   improvvisi (rejection di play, corse di caricamento sugli skip rapidi)
   ricaricavano/svuotavano tutta l'app. Così il messaggio si legge comunque
   e l'app continua a funzionare. */
function fatalError(message) {
  console.error("SSG Universe:", message);
  toast("Errore: " + String(message).slice(0, 90));
}

window.addEventListener("error", (e) => fatalError(e.message));
window.addEventListener("unhandledrejection", (e) => fatalError(
  e.reason && e.reason.message ? e.reason.message : String(e.reason)
));

/* Aggiornamento automatico: il service worker carica sempre la versione
   più recente a ogni apertura, senza che serva il refresh manuale */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("../sw.js").catch(() => {});
}

try {
  renderSkeletons();
  loadPlaylist();
} catch (err) {
  fatalError(err);
}