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

const APP_VERSION = "54";   // cambia l'URL di playlist.json: niente cache stantia
const APP_BUILD = "v144";   // versione in console (brand-sub nascosto): bumpare a ogni release
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
  setAudioLog: $("set-audio-log"),
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
  fpEq: $("fp-eq"),
  fpEqSheet: $("fp-eq-sheet"),
  fpEqClose: $("fp-eq-close"),
  fpEqBody: $("fp-eq-body"),
  fpQueueBtn: $("fp-queue-btn"),
  fpQueueSheet: $("fp-queue-sheet"),
  fpQueueClose: $("fp-queue-close"),
  setNet: $("set-net"),
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
  "Giorni Migliori":   { c1: "40, 190, 255",  c2: "185, 240, 255" },
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

/* ---------- POPUP CONSIGLIATI (rotazione ogni 5 minuti) ----------
   Mini card in stile storia -> al tocco si espande col video YouTube
   (audio ATTIVO, musica in pausa) oppure col profilo Instagram.
   Master in Impostazioni -> Popup. Mai sopra altre modali/fullscreen. */
const POPUP_VIDEOS = [
  { id: "PGhF7FyTE_E", titolo: "GUARDA IL VIDEO MIGLIORE DI SEMPRE" },
  { id: "MqtqN_o7YUs", titolo: "OCCHIO SEMPRE SULLE SCALE MOBILI!" },
  { id: "zyL2Tp6vLEI", titolo: "THE PEOPLE VS 2 INTEGRALE" },
  { id: "8EVTdhU5iFk", titolo: "JOHN CENA ALLA PIETÁ ??" },
  { id: "hYdKaZajCs8", titolo: "PUMP IT UP 1" },
  { id: "lEE5eTUbJrU", titolo: "PUMP IT UP 2" },
  { id: "5wXGH0bg1xI", titolo: "THE PEOPLE VS L'ORIGINALE" }
];
const IG_HANDLE = "ssg_ufficiale";
const IG_URL = "https://www.instagram.com/ssg_ufficiale/";
const POP_EVERY_MS = 5 * 60 * 1000;   // un consiglio ogni 5 minuti
let popLastKind = "";
let popTimer = 0;
let popYtPlayer = null;
let popYtToken = 0;
let popMusicWasPlaying = false;

function popupsEnabled() {
  return storage.get("ssg-popups") !== "off";   // attivi di default
}
/* Suono caratteristico all'apertura: campanello sintetizzato, zero file.
   Il trucco è il contesto "scaldato" al primo gesto dell'utente (i browser
   partono muti fuori dai gesti): se non c'è si prova con quello dell'EQ,
   altrimenti un contesto nuovo (sticky activation) con riprova a 300ms.
   Se tutto è bloccato si apre muto, senza errori. */
let sfxCtx = null;
function sfxWarm() {
  try {
    if (sfxCtx && sfxCtx.state === "closed") sfxCtx = null;   // buttato dal browser: si ricrea
    if (!sfxCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      sfxCtx = new AC();
    }
    if (sfxCtx.state === "suspended" && sfxCtx.resume) sfxCtx.resume().catch(() => {});
  } catch (e) {}
}
/* Riscaldamento CONTINUO (non once): ogni gesto e ogni ritorno in primo
   piano risveglia il contesto. Costa uno stato-letto a tocco, e fa sì che
   il campanello suoni sempre, non solo la prima volta (i browser
   sospendono l'audio in background/lock e i listener once non tornano) */
["pointerdown", "keydown", "touchend"].forEach((t) => {
  try { window.addEventListener(t, sfxWarm); } catch (e) {}
});
document.addEventListener("visibilitychange", () => {
  try {
    if (document.hidden) return;
    sfxWarm();
    /* Rientro in app: se l'elemento suona ma il grafo EQ è sospeso (iOS lo
       sospende in background) si sente silenzio con la canzone che avanza:
       si risveglia il grafo, MAI l'elemento (niente autoplay indesiderati) */
    if (typeof eqCtx !== "undefined" && eqCtx && eqCtx.state === "suspended" && eqCtx.resume) {
      eqCtx.resume().catch(() => {});
    }
    /* Desync reale: la UI dice che suona ma l'elemento è fermo (sospensione
       OS senza evento pausa): un tentativo di play; se il browser lo vieta
       non succede niente, resta il tasto play nativo */
    try {
      if (audio.paused && document.body.classList.contains("is-playing")) {
        audio.play().catch(() => {});
      }
    } catch (e) {}
  } catch (e) {}
});
/* Stesso risveglio al ritorno dal background su iOS (back-forward cache) */
window.addEventListener("pageshow", () => {
  try {
    if (typeof eqCtx !== "undefined" && eqCtx && eqCtx.state === "suspended" && eqCtx.resume) {
      eqCtx.resume().catch(() => {});
    }
  } catch (e) {}
});
/* Rete per iPhone: finché suona, ogni 5s si controlla che il grafo non sia
   sospeso (l'OS lo sospende in background/lock senza avvisare: canzone che
   avanza muta). Costa una lettura di stato. */
setInterval(() => {
  try {
    if (document.hidden || !audio || audio.paused) return;
    if (typeof eqCtx !== "undefined" && eqCtx && eqCtx.state === "suspended" && eqCtx.resume) {
      eqCtx.resume().catch(() => {});
    }
  } catch (e) {}
}, 5000);
function popChimeNow(ctx, own) {
  try {
    const t = ctx.currentTime + 0.02;
    /* Arpeggio in levare, onda triangolare: buca il mix anche a musica alta */
    [[880, 0], [1174.66, 0.1], [1567.98, 0.2]].forEach(([f, dt]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.35, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.3);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t + dt);
      o.stop(t + dt + 0.34);
    });
    if (own) setTimeout(() => { try { ctx.close(); } catch (e) {} }, 1100);
  } catch (e) {}
}
/* Campanello OSTINATO: un tentativo solo non basta (contesto che si sveglia
   in ritardo, gesto arrivato dopo il popup). Riprova a 300ms/1s/2s finché
   non suona davvero; se è fisicamente impossibile (mai un gesto: i browser
   lo vietano), su Android vibra. Così suona SEMPRE quando si può. */
let popChimeToken = 0;
function popChime() {
  const tk = ++popChimeToken;
  let fired = false;
  const attempt = () => {
    if (fired || tk !== popChimeToken) return;
    if (popChimeTry()) fired = true;
  };
  attempt();
  [300, 1000, 2000].forEach((ms) => setTimeout(attempt, ms));
  setTimeout(() => {
    if (!fired && tk === popChimeToken) haptic([30, 50, 30]);
  }, 2200);
}
function popChimeTry() {
  try {
    if (sfxCtx && sfxCtx.state === "closed") sfxCtx = null;
    /* Si svegliano tutti i candidati (condiviso + EQ): il resume è async,
       quindi si guarda lo stato DOPO averlo chiesto */
    const cand = [];
    if (sfxCtx) cand.push(sfxCtx);
    try {
      if (typeof eqCtx !== "undefined" && eqCtx && eqCtx !== sfxCtx) cand.push(eqCtx);
    } catch (e) {}
    cand.forEach((c) => {
      try { if (c.state === "suspended" && c.resume) c.resume().catch(() => {}); } catch (e) {}
    });
    const run = cand.find((c) => {
      try { return c.state === "running"; } catch (e) { return false; }
    });
    if (run) { popChimeNow(run, false); return true; }
    /* Nessun contesto pronto: se ne crea uno (sticky activation dopo un
       gesto); se non parte subito ci pensano i retry del chiamante */
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    if (ctx.state === "suspended" && ctx.resume) ctx.resume().catch(() => {});
    /* Se non c'era un condiviso diventa lui (mai chiuso); altrimenti è un
       usa-e-getta che si richiude da solo dopo aver suonato */
    let own = false;
    if (!sfxCtx) { sfxCtx = ctx; } else { own = true; }
    if (ctx.state === "running") { popChimeNow(ctx, own); return true; }
    return false;
  } catch (e) { return false; }
}
/* C'è già qualcosa sopra? (modali, pannelli, fullscreen, mini già fuori) */
function popBlocked() {
  try {
    if (document.fullscreenElement) return true;
    const ids = ["confirm-modal", "settings-view", "search-view",
      "fp-eq-sheet", "fp-queue-sheet", "fp-share-menu", "pop-sheet", "pop-mini"];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains("hidden")) return true;
    }
  } catch (e) {}
  return false;
}
function popPick() {
  let pool = ["ig"];
  POPUP_VIDEOS.forEach((v, i) => pool.push("v" + i));
  try { if (navigator.onLine === false) pool = ["ig"]; } catch (e) {}   // offline: solo Instagram
  const alt = pool.filter((k) => k !== popLastKind);
  if (alt.length) pool = alt;   // mai due volte lo stesso di fila
  const pick = pool[Math.floor(Math.random() * pool.length)];
  popLastKind = pick;
  return pick;
}
function popMaybeShow() {
  if (!popupsEnabled() || document.hidden) return;
  if (popBlocked()) return;
  showPopMini(popPick());
}
function popMiniEl(id) {
  try { return document.getElementById(id); } catch (e) { return null; }
}
function showPopMini(kind) {
  const mini = popMiniEl("pop-mini"), k = popMiniEl("pop-mini-kind"), t = popMiniEl("pop-mini-title");
  if (!mini || !k || !t) return;
  popLastKind = kind;
  if (kind === "ig") {
    k.textContent = "INSTAGRAM";
    t.textContent = "@" + IG_HANDLE;
  } else {
    const v = POPUP_VIDEOS[Number(kind.slice(1))];
    if (!v) return;
    k.textContent = "VIDEO";
    t.textContent = v.titolo;
  }
  mini.dataset.kind = kind;
  mini.classList.remove("hidden");
  popChime();
  /* Preriscalda l'API YouTube se il consiglio è un video: al tocco il player
     nasce subito e l'autoplay (col gesto ancora vicino) parte con l'audio */
  try {
    if (kind !== "ig" && navigator.onLine !== false) ensureYTApi();
  } catch (e) {}
}
/* Timer a catena (niente sovrapposizioni): scatta, poi riparte da solo;
   chiudere un popup fa ripartire i 2 minuti da quel momento */
function popSchedule() {
  try {
    clearTimeout(popTimer);
    if (!popupsEnabled()) return;
    popTimer = setTimeout(() => {
      try { popMaybeShow(); } catch (e) {}
      popSchedule();
    }, POP_EVERY_MS);
  } catch (e) {}
}
function hidePopMini() {
  try {
    const mini = popMiniEl("pop-mini");
    if (mini) mini.classList.add("hidden");
  } catch (e) {}
  popSchedule();
}
function popPauseMusic() {
  popMusicWasPlaying = false;
  try { if (!audio.paused) { popMusicWasPlaying = true; audio.pause(); } } catch (e) {}
}
function popResumeMusic() {
  if (!popMusicWasPlaying) return;
  popMusicWasPlaying = false;
  try { const p = audio.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}
function popSheetOpen() {
  try {
    const s = popMiniEl("pop-sheet");
    return !!(s && !s.classList.contains("hidden"));
  } catch (e) { return false; }
}
/* Espande il consiglio: video con AUDIO (musica in pausa) oppure Instagram */
function expandPop(kind) {
  hidePopMini();
  if (!kind) return;
  const sheet = popMiniEl("pop-sheet"), title = popMiniEl("pop-title"),
    body = popMiniEl("pop-body"), video = popMiniEl("pop-video"), ig = popMiniEl("pop-ig");
  if (!sheet || !title || !body || !video || !ig) return;
  video.innerHTML = "";
  body.innerHTML = "";
  ig.classList.add("hidden");
  popDestroyYt();
  if (kind === "ig") {
    title.textContent = "Instagram";
    body.innerHTML =
      '<div class="ig-logo" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="44" height="44" fill="one" stroke="currentColor" stroke-width="1.8">' +
      '<rect x="3" y="3" width="18" height="18" rx="5"/>' +
      '<circle cx="12" cy="12" r="4"/>' +
      '<circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" stroke="none"/></svg></div>' +
      '<div class="pop-ig-name">@' + IG_HANDLE + "</div>" +
      '<div class="confirm-msg">Backstage, anteprime e date live.</div>';
    ig.classList.remove("hidden");
  } else {
    const v = POPUP_VIDEOS[Number(kind.slice(1))];
    if (!v) return;
    title.textContent = v.titolo;
    if (navigator.onLine === false) {
      body.innerHTML = '<div class="confirm-msg">Serve connessione per vedere il video.</div>';
    } else {
      popPauseMusic();
      popPlayYt(v.id);
    }
  }
  sheet.classList.remove("hidden");
  sheet.setAttribute("aria-hidden", "false");
}
function popDestroyYt() {
  popYtToken++;
  popWatchStop();
  popYtStarted = false;
  try { if (popYtPlayer && popYtPlayer.destroy) popYtPlayer.destroy(); } catch (e) {}
  popYtPlayer = null;
}
function popYtState() {
  try { return popYtPlayer ? popYtPlayer.getPlayerState() : -99; }
  catch (e) { return -99; }
}
/* Sorveglianza avvio: finché il video non è partito DAVVERO si riprova
   (l'autoplay con audio fuori dal gesto viene spesso bloccato al primo
   colpo: prima si sentiva l'audio o niente e il video restava fermo).
   Dopo il primo PLAYING comanda l'utente (niente lotte sul pausa). */
let popWatchTimer = 0;
let popYtStarted = false;
function popTick() {
  try {
    if (!popSheetOpen() || popYtStarted || !popYtPlayer) return;
    if (popYtState() === 1) { popYtStarted = true; return; }
    popYtPlayer.unMute();
    try { popYtPlayer.setVolume(100); } catch (e) {}
    popYtPlayer.playVideo();
  } catch (e) {}
}
function popWatchStart() {
  try {
    if (popWatchTimer) clearInterval(popWatchTimer);
    popWatchTimer = setInterval(() => {
      try {
        if (!popSheetOpen() || popYtStarted) {
          if (popWatchTimer) clearInterval(popWatchTimer);
          popWatchTimer = 0;
          return;
        }
        popTick();
      } catch (e) {}
    }, 1500);
  } catch (e) {}
}
function popWatchStop() {
  try { if (popWatchTimer) clearInterval(popWatchTimer); } catch (e) {}
  popWatchTimer = 0;
}
/* Codici errore YouTube in parole (testabile): 101/150 = incorporamento
   vietato dal proprietario, 100 = non trovato/privato */
function ytErrorText(code) {
  if (code === 101 || code === 150) return "Questo video non si può incorporare (bloccato dal proprietario).";
  if (code === 100) return "Video non trovato o privato.";
  if (typeof code !== "undefined" && code !== -1) return "Video non disponibile (errore " + code + ").";
  return "Video non disponibile.";
}
function popPlayYt(videoId) {
  const video = popMiniEl("pop-video");
  if (!video) return;
  /* Come nel full player: l'iframe rimpiazza il bersaglio, quindi gli si dà
     un contenitore interno sacrificale e il box con le dimensioni resta */
  video.innerHTML = '<div id="pop-yt-frame"></div>';
  const tk = ++popYtToken;
  ensureYTApi().then((ok) => {
    if (tk !== popYtToken) return;
    if (!ok || !ytApiLoaded() || !popSheetOpen()) {
      const b = popMiniEl("pop-body");
      if (popSheetOpen() && b) b.innerHTML = '<div class="confirm-msg">Video non disponibile.</div>';
      return;
    }
    try {
      popYtPlayer = new window.YT.Player("pop-yt-frame", {
        videoId: videoId,
        width: "100%",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 1, iv_load_policy: 3, cc_load_policy: 0 },
        events: {
          onReady: (ev) => {
            if (tk !== popYtToken) return;
            popYtStarted = false;
            try { ev.target.setPlaybackQualityRange("hd1080", "hd1080"); } catch (e2) {}
            try { ev.target.setOption("captions", "track", {}); } catch (e3) {}
            try { ev.target.unloadModule("captions"); } catch (e5) {}
            popTick();
            popWatchStart();
          },
          onStateChange: (ev) => {
            if (tk !== popYtToken || !ev) return;
            if (ev.data === 1) {
              popYtStarted = true;   // partito: da qui comanda l'utente
              try { popYtPlayer.unloadModule("captions"); } catch (e6) {}
            }
          },
          onError: (ev) => {
            if (tk !== popYtToken) return;
            const code = ev && typeof ev.data !== "undefined" ? ev.data : -1;
            const b = popMiniEl("pop-body");
            if (b) b.innerHTML = '<div class="confirm-msg">' + ytErrorText(code) + "</div>";
          }
        }
      });
    } catch (e) {
      if (tk === popYtToken) {
        const b = popMiniEl("pop-body");
        if (b) b.innerHTML = '<div class="confirm-msg">Video non disponibile.</div>';
      }
    }
  });
}
function closePop() {
  popDestroyYt();
  try {
    const sheet = popMiniEl("pop-sheet");
    if (sheet) {
      sheet.classList.add("hidden");
      sheet.setAttribute("aria-hidden", "true");
    }
    const video = popMiniEl("pop-video");
    if (video) video.innerHTML = "";
  } catch (e) {}
  popResumeMusic();
  popSchedule();
}
(function bindPopups() {
  /* Apertura anti-proiettile: touchend (con preventDefault anti-zoom) + click
     di riserva, con rete anti-doppio. Su alcuni browser il tap sulla card
     veniva "mangiato" (zoom/selezione) e il video non si apriva mai. */
  let popMiniBusy = false;
  const miniActivate = (e) => {
    try {
      if (e && e.target && e.target.closest && e.target.closest("#pop-mini-x")) return;
    } catch (err) {}
    if (popMiniBusy) return;
    popMiniBusy = true;
    setTimeout(() => { popMiniBusy = false; }, 600);
    const mini = popMiniEl("pop-mini");
    expandPop(mini ? mini.dataset.kind : "");
    haptic(10);
  };
  const mini = popMiniEl("pop-mini");
  if (mini) {
    try {
    mini.addEventListener("touchend", (e) => {
      try {
        if (e.target.closest && e.target.closest("#pop-mini-x")) return;  // la X usa il suo click: niente preventDefault
      } catch (err) {}
      try { e.preventDefault(); } catch (err) {}
      miniActivate(e);
    }, { passive: false });
    } catch (e) {
      try { mini.addEventListener("touchend", (e2) => { miniActivate(e2); }); } catch (e2) {}
    }
    mini.addEventListener("click", (e) => { miniActivate(e); });
  }
  const x = popMiniEl("pop-mini-x");
  if (x) x.addEventListener("click", (e) => {
    try { e.stopPropagation(); } catch (err) {}
    hidePopMini();
    closePop();   // la ✕ chiude tutto (anche la scheda se aperta)
  });
  const close = popMiniEl("pop-close");
  if (close) close.addEventListener("click", () => { closePop(); haptic(10); });
  const sheet = popMiniEl("pop-sheet");
  if (sheet) sheet.addEventListener("click", (e) => {
    if (e.target === sheet) closePop();   // click fuori
  });
  try {
    popSchedule();   // primo giro tra 2 minuti; poi riparte a ogni chiusura
  } catch (e) {}
})();
/* ---------- RIPRODUZIONE: pulsante coda on/off + popup consigli ---------- */
function syncPopupsChips() {
  const cur = storage.get("ssg-popups") || "on";
  document.querySelectorAll("#set-popups .chip").forEach((c) => {
    c.classList.toggle("on", c.dataset.popups === cur);
  });
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
/* Il grafo WebAudio serve solo se l'EQ colora davvero il suono: con preset
   piatto l'elemento audio suona NATIVO (background e lock-screen solidi su
   iPhone, zero batteria). Si crea al primo gesto utile che lo richiede. */
function eqNeedsGraph() {
  try {
    const g = eqGainsFor(storage.get("ssg-eq") || "piatto");
    return g.some((v) => Number(v) !== 0);
  } catch (e) { return false; }
}
const EQ_FREQS = [60, 250, 1000, 4000, 12000];
const EQ_PRESETS = {
  piatto:    { label: "Piatto",    gains: [0, 0, 0, 0, 0] },
  bassi:     { label: "Bassi",     gains: [6, 3, 0, 0, -1] },
  voci:      { label: "Voci",      gains: [-2, 1, 4, 3, 0] },
  brillante: { label: "Brillante", gains: [0, 0, 1, 4, 6] },
  rock:      { label: "Rock",      gains: [5, 2, -2, 3, 5] },
  pop:       { label: "Pop",       gains: [2, 3, 0, 1, 4] },
  dance:     { label: "Dance",     gains: [6, 4, 0, 1, 3] }
};
const EQ_LABELS = ["60", "250", "1k", "4k", "12k"];

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
    /* Analyser per il visualizzatore, in SERIE in coda al grafo
       (filtri -> analyser -> casse): costo quasi zero quando nessuno
       legge i dati, e niente doppio audio */
    eqAnalyser = eqCtx.createAnalyser();
    eqAnalyser.fftSize = 64;              // 32 bande: bastano per 28 barre
    eqAnalyser.smoothingTimeConstant = 0.72;
    node.connect(eqAnalyser);
    eqAnalyser.connect(eqCtx.destination);
    eqReady = true;
    applyEQPreset(storage.get("ssg-eq") || "piatto", true);
    return true;
  } catch (e) { return false; }
}

function eqGainsFor(name) {
  if (name === "custom") {
    try {
      const g = JSON.parse(storage.get("ssg-eq-gains") || "[]");
      if (Array.isArray(g) && g.length === EQ_FREQS.length) return g.map(Number);
    } catch (e) {}
    return [0, 0, 0, 0, 0];
  }
  const p = EQ_PRESETS[name] || EQ_PRESETS.piatto;
  return p.gains.slice();
}

function applyEQPreset(name, silent) {
  const key = (name === "custom" || name in EQ_PRESETS) ? name : "piatto";
  const gains = eqGainsFor(key);
  if (eqReady && eqFilters) {
    eqFilters.forEach((flt, i) => { flt.gain.value = gains[i] || 0; });
  }
  storage.set("ssg-eq", key);
  syncEQControls();
  // niente toast: il preset attivo si vede già evidenziato nei chip
}

function applyEQGains(gains) {
  storage.set("ssg-eq-gains", JSON.stringify(gains));
  if (eqReady && eqFilters) {
    eqFilters.forEach((flt, i) => { flt.gain.value = gains[i] || 0; });
  }
  storage.set("ssg-eq", "custom");
  syncEQControls();
}

function fmtDb(v) { return (v > 0 ? "+" : "") + v + " dB"; }

/* Costruisce preset + slider in un contenitore (usato sia nelle
   impostazioni che nel pannello del full player) */
function buildEQControls(container) {
  if (!container) return;
  container.innerHTML = "";
  const chips = document.createElement("div");
  chips.className = "chip-row";
  Object.keys(EQ_PRESETS).concat(["custom"]).forEach((name) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.dataset.eq = name;
    b.textContent = name === "custom" ? "Custom" : EQ_PRESETS[name].label;
    b.addEventListener("click", () => {
      if (!ensureEQ()) { toast("Equalizzatore non supportato qui"); return; }
      applyEQPreset(name);
      haptic(10);
    });
    chips.appendChild(b);
  });
  container.appendChild(chips);
  const sliders = document.createElement("div");
  sliders.className = "eq-sliders";
  EQ_FREQS.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "eq-band";
    const lab = document.createElement("span");
    lab.textContent = EQ_LABELS[i] || (f >= 1000 ? (f / 1000) + "k" : String(f));
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = "-12";
    inp.max = "12";
    inp.step = "1";
    inp.dataset.band = String(i);
    inp.setAttribute("aria-label", "Banda " + lab.textContent + " Hz");
    const out = document.createElement("output");
    out.textContent = "0 dB";
    inp.addEventListener("input", () => {
      if (!ensureEQ()) { toast("Equalizzatore non supportato qui"); return; }
      const gains = eqGainsFor(storage.get("ssg-eq") || "piatto");
      gains[i] = Number(inp.value) || 0;
      applyEQGains(gains);
      out.textContent = fmtDb(gains[i]);
    });
    row.appendChild(lab);
    row.appendChild(inp);
    row.appendChild(out);
    sliders.appendChild(row);
  });
  container.appendChild(sliders);
  syncEQControls();
}

function syncEQControls() {
  const cur = storage.get("ssg-eq") || "piatto";
  const gains = eqGainsFor(cur);
  document.querySelectorAll(".chip[data-eq]").forEach((c) => {
    c.classList.toggle("on", c.dataset.eq === cur);
  });
  document.querySelectorAll(".eq-band input[type=range]").forEach((inp) => {
    const i = Number(inp.dataset.band || 0);
    const v = gains[i] || 0;
    if (Number(inp.value) !== v) inp.value = String(v);
    const out = inp.closest(".eq-band").querySelector("output");
    if (out) out.textContent = fmtDb(v);
  });
}

/* ---------- VISUALIZZATORE AUDIO (full player, barre neon) ----------
   Usa un AnalyserNode nello stesso grafo dell'equalizzatore (una sola
   MediaElementSource per l'elemento audio). Gira solo a full player
   aperto + brano in corso + opzione attiva: zero costo il resto del tempo. */
const VIZ_BARS = 28;
let eqAnalyser = null;
let vizRaf = 0;
let vizFreq = null;
const vizLvl = new Float32Array(VIZ_BARS);

function vizEnabled() {
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  } catch (e) {}
  return storage.get("ssg-viz") !== "off";   // attivo di default: si spegne in Impostazioni → Effetti
}
function vizBox() {
  try { return document.getElementById("fp-viz"); }
  catch (e) { return null; }
}
function vizBuild() {
  const box = vizBox();
  if (!box || !box.children || box.children.length) return;
  for (let i = 0; i < VIZ_BARS; i++) {
    try { box.appendChild(document.createElement("i")); }
    catch (e) { return; }
  }
}
function vizFlat() {
  const box = vizBox();
  if (!box || !box.children) return;
  const kids = box.children;
  for (let i = 0; i < kids.length; i++) {
    try { kids[i].style.transform = "scaleY(.06)"; } catch (e) {}
    vizLvl[i] = 0;
  }
}
function vizTick() {
  vizRaf = 0;
  if (!vizEnabled() || document.hidden || audio.paused || !eqAnalyser) return vizStop(true);
  try {
    if (!els.fp || !els.fp.classList.contains("open")) return vizStop(true);
  } catch (e) { return vizStop(true); }
  try {
    eqAnalyser.getByteFrequencyData(vizFreq);
    const box = vizBox();
    const kids = box ? box.children : [];
    const n = Math.min(kids.length, VIZ_BARS);
    for (let i = 0; i < n; i++) {
      const v = (vizFreq[i + 1] || 0) / 255;   // salta la bin 0 (componente continua)
      const lv = Math.max(v, (vizLvl[i] || 0) - 0.06);   // attacco rapido, caduta morbida
      vizLvl[i] = lv;
      kids[i].style.transform = "scaleY(" + Math.max(.06, lv).toFixed(3) + ")";
    }
  } catch (e) {}
  vizRaf = requestAnimationFrame(vizTick);
}
function vizStart() {
  if (vizRaf) return;
  if (!vizEnabled()) return;
  /* Senza gesto attivo non si crea il grafo: un AudioContext nato sospeso
     ammutolirebbe l'audio (l'elemento viene instradato nel grafo). Si aspetta
     il primo tap vero; i cambi brano automatici usano il grafo esistente */
  try {
    if (!eqReady && navigator.userActivation && navigator.userActivation.isActive === false) return;
  } catch (e) {}
  /* Niente grafo solo per un visualizzatore invisibile: se il full player è
     chiuso e l'EQ è piatto, l'audio resta nativo (background solido) */
  try {
    if (!eqReady && !eqNeedsGraph() && els.fp && !els.fp.classList.contains("open")) return;
  } catch (e) {}
  try { if (!ensureEQ()) return; } catch (e) { return; }   // crea il grafo (con analyser) se manca
  if (!eqAnalyser) return;
  /* Se il contesto nasce sospeso (play partito fuori da un gesto diretto,
     es. cambio brano automatico su browser severi), si prova a svegliarlo
     subito e al primo tocco: finché dorme le barre restano piatte */
  try {
    if (eqCtx && eqCtx.state === "suspended") {
      eqCtx.resume().catch(() => {});
      document.addEventListener("pointerdown", function vizWake() {
        try { if (eqCtx && eqCtx.state === "suspended") eqCtx.resume().catch(() => {}); }
        catch (e) {}
      }, { once: true });
    }
  } catch (e) {}
  if (!vizFreq || vizFreq.length !== eqAnalyser.frequencyBinCount) {
    try { vizFreq = new Uint8Array(eqAnalyser.frequencyBinCount); }
    catch (e) { return; }
  }
  vizBuild();
  const box = vizBox();
  if (box) box.classList.remove("hidden");
  vizRaf = requestAnimationFrame(vizTick);
}
function vizStop(silent) {
  if (vizRaf) { try { cancelAnimationFrame(vizRaf); } catch (e) {} vizRaf = 0; }
  const box = vizBox();
  if (box) box.classList.add("hidden");
  if (!silent) vizFlat();
}

/* Stato connessione nelle impostazioni (si aggiorna da solo) */
function updateNetStatus() {
  if (!els.setNet) return;
  const on = navigator.onLine !== false;
  els.setNet.innerHTML = "";
  const dot = document.createElement("span");
  dot.className = "net-dot " + (on ? "on" : "off");
  const t = document.createElement("span");
  t.textContent = on ? "Online" : "Offline — solo brani scaricati";
  els.setNet.appendChild(dot);
  els.setNet.appendChild(t);
}
window.addEventListener("online", updateNetStatus);
window.addEventListener("offline", updateNetStatus);

/* Modale di conferma elegante: resolve(true/false), una sola alla volta */
let confirmResolve = null;
function askConfirm(title, msg, okLabel) {
  return new Promise((resolve) => {
    const m = document.getElementById("confirm-modal");
    if (!m) { resolve(false); return; }
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-msg").textContent = msg;
    document.getElementById("confirm-ok").textContent = okLabel || "Elimina";
    confirmResolve = resolve;
    m.classList.remove("hidden");
  });
}
function closeConfirm(v) {
  const m = document.getElementById("confirm-modal");
  if (m) m.classList.add("hidden");
  if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(v); }
}

/* ---------- PANNELLO IMPOSTAZIONI ---------- */
function openSettingsView() {
  if (!els.settingsView) return;
  renderSettings();
  updateNetStatus();
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
  syncSkyChips();
  syncVizChips();
  syncQueueChips();
  syncPopupsChips();
  if (els.setAudioLog) els.setAudioLog.textContent = audioLog.join("\n") || "—";
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
        return { title: s ? (s.titolo || fileTitle(s.file)) : "Brano", n: e.n };
      });
    const byAlbum = {};
    entries.forEach((k) => {
      const s = state.songs.find((x) => x.file === k);
      const a = s ? (s.album || "Senza album") : null;
      if (a) byAlbum[a] = (byAlbum[a] || 0) + (st.plays[k] || 0);
    });
    const topAlbum = Object.keys(byAlbum).sort((a, b) => byAlbum[b] - byAlbum[a])[0];
    els.setStats.innerHTML = "";
    if (!totalPlays && !topAlbum) {
      const d = document.createElement("div");
      d.className = "set-empty";
      d.textContent = "Ascolta qualcosa e qui vedrai le tue statistiche.";
      els.setStats.appendChild(d);
    } else {
      const grid = document.createElement("div");
      grid.className = "stat-grid";
      const tiles = [
        [String(totalPlays), totalPlays === 1 ? "brano avviato" : "brani avviati"],
        [fmtMin(st.seconds || 0), "di ascolto"]
      ];
      if (topAlbum) tiles.push([topAlbum, "album preferito"]);
      tiles.forEach(([v, l]) => {
        const t = document.createElement("div");
        t.className = "stat-tile";
        const vv = document.createElement("div");
        vv.className = "stat-num";
        vv.textContent = v;
        const ll = document.createElement("div");
        ll.className = "stat-label";
        ll.textContent = l;
        t.appendChild(vv);
        t.appendChild(ll);
        grid.appendChild(t);
      });
      els.setStats.appendChild(grid);
      top.forEach((e, i) => {
        const r = document.createElement("div");
        r.className = "stat-top-row";
        const rank = document.createElement("span");
        rank.className = "stat-rank";
        rank.textContent = String(i + 1);
        const name = document.createElement("span");
        name.className = "stat-top-name";
        name.textContent = e.title;
        const cnt = document.createElement("span");
        cnt.className = "stat-top-count";
        cnt.textContent = e.n + "×";
        r.appendChild(rank);
        r.appendChild(name);
        r.appendChild(cnt);
        els.setStats.appendChild(r);
      });
    }
  }
  // Equalizzatore
  buildEQControls(els.setEq);
  // Brani offline
  renderDlList();
  updateDlInfo();
}

async function updateDlInfo(followUp) {
  if (!els.setDlInfo) return;
  /* Diagnostica visibile: quanti brani offline + quante voci nelle cache
     (audio vs resto dell'app), così si vede subito dove sta la memoria */
  let n = 0, others = 0;
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      for (const name of names) {
        try {
          const c = await caches.open(name);
          const k = await c.keys();
          if (name === AUDIO_CACHE) n = k.length;
          else others += k.length;
        } catch (e) {}
      }
    }
  } catch (e) {}
  let txt = n ? (n + (n === 1 ? " brano offline." : " brani offline.")) : "Nessun album scaricato.";
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const mb = ((est.usage || 0) / 1048576).toFixed(0);
      txt += " Spazio usato dall'app: circa " + mb + " MB (voci in cache: " + n + " audio, " + others + " app).";
    } else {
      txt += " (voci in cache: " + n + " audio, " + others + " app).";
    }
  } catch (e) {}
  els.setDlInfo.textContent = txt;
  /* Il browser aggiorna la quota in differita: subito dopo una cancellazione
     estimate() può ancora mostrare il valore vecchio. Due riletture (5s e
     15s) se il pannello è ancora aperto, così il numero scende davvero */
  if (!followUp) {
    try {
      clearTimeout(updateDlInfo._t);
      updateDlInfo._t = setTimeout(() => {
        try {
          if (els.settingsView && !els.settingsView.classList.contains("hidden")) updateDlInfo(true);
        } catch (e) {}
      }, 5000);
      clearTimeout(updateDlInfo._t2);
      updateDlInfo._t2 = setTimeout(() => {
        try {
          if (els.settingsView && !els.settingsView.classList.contains("hidden")) updateDlInfo(true);
        } catch (e) {}
      }, 15000);
    } catch (e) {}
  }
}

const dlExpanded = new Set();   // album con lista brani aperta nelle impostazioni

/* URL assoluti dei file audio effettivamente in cache offline */
async function dlCachedFiles() {
  try {
    if (!("caches" in window)) return [];
    const cache = await caches.open(AUDIO_CACHE);
    const keys = await cache.keys();
    return keys.map((r) => r.url);
  } catch (e) { return []; }
}

function dlUrlFor(songIdx) {
  try {
    return new URL(resolvePath(state.songs[songIdx].file), location.href).href;
  } catch (e) { return ""; }
}

/* Ricalcola il flag album: "1" solo se ci sono TUTTI i brani */
function refreshDlFlag(album, cachedSet) {
  const all = album.songs.every((i) => cachedSet.has(dlUrlFor(i)));
  storage.set("ssg-dl-" + album.title, all ? "1" : "0");
}

/* Confronto normalizzato tra URL in cache (niente query/hash/encoding):
   due URL uguali nella sostanza corrispondono sempre, anche se uno è
   stato salvato con ?v= o con gli spazi codificati diversamente */
function dlNorm(u) {
  try {
    let s = String((u && u.url) || u || "");
    s = s.split("?")[0].split("#")[0];
    try { s = decodeURI(s); } catch (e) {}
    return s;
  } catch (e) { return ""; }
}

/* Cancella URL audio da TUTTE le cache e VERIFICA che siano spariti:
   restituisce true solo se non resta nessuna copia (niente più
   eliminazioni "a vuoto" che lasciano brani e memoria occupata) */
async function dlDeleteUrls(urls) {
  const want = new Set(urls.map(dlNorm).filter(Boolean));
  if (!want.size) return true;
  try {
    if (!("caches" in window)) return false;
    const wipe = async () => {
      const names = await caches.keys();
      for (const name of names) {
        try {
          const cache = await caches.open(name);
          const keys = await cache.keys();
          await Promise.all(keys.map((r) => {
            if (!want.has(dlNorm(r.url))) return Promise.resolve(false);
            try { return cache.delete(r).catch(() => false); }
            catch (e) { return Promise.resolve(false); }
          }));
        } catch (e) {}
      }
    };
    await wipe();
    const names = await caches.keys();
    for (const name of names) {
      try {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        for (const r of keys) if (want.has(dlNorm(r.url))) return false;
      } catch (e) {}
    }
    return true;
  } catch (e) { return false; }
}

/* Dopo un'eliminazione dai download, il tasto nuvola dell'album APERTO
   va risincronizzato (renderHome ridisegna solo la griglia home, la
   pagina album restava con la vecchia spunta) */
function refreshHeroDl() {
  try {
    if (!currentAlbum) return;
    const btn = document.querySelector(".hero-dl");
    if (!btn) return;
    const done = isAlbumDownloaded(currentAlbum);
    btn.classList.toggle("done", done);
    btn.innerHTML = done ? DL_ICON_DONE : DL_ICON_DOWN;
    btn.title = done ? "Scaricato: tocca per rimuovere" : "Scarica per l'ascolto offline";
  } catch (e) {}
}

async function removeAlbumDl(album) {
  const gone = await dlDeleteUrls(album.songs.map(dlUrlFor));
  if (gone) storage.set("ssg-dl-" + album.title, "0");
  refreshHeroDl();
  return gone;
}

async function removeTrackDl(songIdx) {
  const gone = await dlDeleteUrls([dlUrlFor(songIdx)]);
  const song = state.songs[songIdx];
  const album = state.albums.find((a) => a.title === song.album);
  if (album) refreshDlFlag(album, new Set(await dlCachedFiles()));
  refreshHeroDl();
  return gone;
}

async function deleteAllDownloads() {
  const ok = await askConfirm("Eliminare tutti i download?",
    "Verranno rimossi tutti i brani scaricati per l'ascolto offline.", "Elimina tutto");
  if (!ok) return;
  const all = [];
  state.albums.forEach((a) => a.songs.forEach((i) => all.push(dlUrlFor(i))));
  const gone = await dlDeleteUrls(all);
  try { await caches.delete(AUDIO_CACHE); } catch (e) {}
  if (gone) {
    state.albums.forEach((a) => storage.set("ssg-dl-" + a.title, "0"));
    dlExpanded.clear();
    toast("Download eliminati");
  } else {
    toast("Eliminazione non riuscita: premi refresh e riprova");
  }
  renderDlList();
  renderHome();
  refreshHeroDl();
  updateDlInfo();
}

function renderDlList() {
  if (!els.setDlList) return;
  dlCachedFiles().then((list) => {
    if (!els.setDlList) return;
    const cached = new Set(list);
    const withDl = state.albums.map((album) => {
      const idxs = album.songs.filter((i) => cached.has(dlUrlFor(i)));
      return { album, idxs };
    }).filter((x) => x.idxs.length > 0);
    els.setDlList.innerHTML = "";
    /* Cestino SEMPRE visibile (richiesta di Marco): se non c'è niente
       da eliminare è disabilitato, così il controllo si trova sempre */
    const allBtn = document.createElement("button");
    allBtn.className = "dl-btn danger dl-trash";
    allBtn.innerHTML = DL_ICON_TRASH + "<span>Elimina tutti i download</span>";
    if (!withDl.length) {
      allBtn.disabled = true;
      allBtn.title = "Niente da eliminare: scarica prima un album";
    } else {
      allBtn.addEventListener("click", deleteAllDownloads);
    }
    els.setDlList.appendChild(allBtn);
    if (!withDl.length) {
      const d = document.createElement("div");
      d.className = "set-sub";
      d.textContent = "Scarica un album dal tasto freccia nella sua pagina: qui vedrai gli album con l'elenco dei brani.";
      els.setDlList.appendChild(d);
      return;
    }
    withDl.forEach(({ album, idxs }) => {
      const row = document.createElement("div");
      row.className = "dl-row";
      const name = document.createElement("span");
      name.textContent = album.title + " · " + idxs.length + "/" + album.songs.length;
      const tog = document.createElement("button");
      tog.className = "dl-toggle";
      const open = dlExpanded.has(album.title);
      tog.textContent = open ? "Brani ▾" : "Brani ▸";
      tog.addEventListener("click", () => {
        if (dlExpanded.has(album.title)) dlExpanded.delete(album.title);
        else dlExpanded.add(album.title);
        renderDlList();
      });
      const btn = document.createElement("button");
      btn.className = "dl-btn";
      btn.textContent = "Rimuovi";
      btn.addEventListener("click", async () => {
        const ok = await askConfirm("Rimuovere l'album?",
          "Verranno eliminati i brani scaricati di \"" + album.title + "\".", "Rimuovi");
        if (!ok) return;
        const gone = await removeAlbumDl(album);
        if (!gone) toast("Eliminazione non riuscita: premi refresh e riprova");
        dlExpanded.delete(album.title);
        renderDlList();
        renderHome();
        updateDlInfo();
      });
      row.appendChild(name);
      row.appendChild(tog);
      row.appendChild(btn);
      els.setDlList.appendChild(row);
      if (open) {
        const box = document.createElement("div");
        box.className = "dl-tracks";
        idxs.forEach((i) => {
          const t = document.createElement("div");
          t.className = "dl-track";
          const tn = document.createElement("span");
          const s = state.songs[i];
          tn.textContent = s.titolo || fileTitle(s.file);
          const x = document.createElement("button");
          x.className = "dl-x";
          x.textContent = "✕";
          x.setAttribute("aria-label", "Elimina brano scaricato");
          x.addEventListener("click", async () => {
            const s0 = state.songs[i];
            const ok = await askConfirm("Rimuovere il brano?",
              "Verrà eliminato \"" + (s0.titolo || fileTitle(s0.file)) + "\" dai download.", "Rimuovi");
            if (!ok) return;
            const gone = await removeTrackDl(i);
            if (!gone) toast("Eliminazione non riuscita: premi refresh e riprova");
            renderDlList();
            renderHome();
            updateDlInfo();
          });
          t.appendChild(tn);
          t.appendChild(x);
          box.appendChild(t);
        });
        els.setDlList.appendChild(box);
      }
    });
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
    // Rimuovi dalla cache offline (solo se sparisce davvero)
    const gone = await removeAlbumDl(album);
    if (gone) {
      if (btn) { btn.classList.remove("done"); btn.innerHTML = DL_ICON_DOWN; }
      toast("Album rimosso dall'ascolto offline");
    } else {
      if (btn) { btn.classList.add("done"); btn.innerHTML = DL_ICON_DONE; }
      toast("Eliminazione non riuscita: premi refresh e riprova");
    }
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
    if (btn) { btn.classList.add("done"); btn.innerHTML = DL_ICON_DONE; }
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
  const done = isAlbumDownloaded(album);
  b.className = "hero-dl" + (done ? " done" : "");
  b.setAttribute("aria-label", "Ascolto offline");
  b.title = done
    ? "Scaricato: tocca per rimuovere" : "Scarica per l'ascolto offline";
  b.innerHTML = done ? DL_ICON_DONE : DL_ICON_DOWN;
  b.addEventListener("click", () => downloadAlbum(album, b));
  return b;
}

/* Icona download (nuvola) e spunta di conferma per album scaricato */
const DL_ICON_DOWN =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4c-1.48 0-2.85.43-4.01 1.17l1.46 1.46C10.21 6.23 11.08 6 12 6c3.04 0 5.5 2.46 5.5 5.5v.5H19c1.66 0 3 1.34 3 3 0 1.66-1.34 3-3 3H8.41c-.24 0-.47.1-.64.27-.13.13-.22.3-.25.48-.02.1-.03.2-.03.31 0 .24.07.48.2.68.52.8 1.55 1.26 2.72 1.26h8.07c2.76 0 5-2.24 5-5 0-2.65-2.05-4.81-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>';
const DL_ICON_DONE =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
/* Icona cestino per "Elimina tutti i download" nelle impostazioni */
const DL_ICON_TRASH =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

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
let stallRetried = false;   // un solo recupero a brano anche per gli stalli di rete

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
  try { if (eqNeedsGraph()) ensureEQ(); } catch (e) {}   // grafo solo se l'EQ colora: sennò audio nativo
  /* NIENTE await: il vecchio codice aspettava che audio.play() si risolvesse
     (cioè finché il brano bufferizzava e partiva DAVVERO) prima di aggiornare
     titolo/copertina e aprire il full player: cliccando una canzone la UI
     restava congelata e sembrava lenta. Ora la UI si aggiorna all'istante
     mentre l'audio bufferizza in background. */
  const myToken = ++playToken;      // anti-corsa: solo l'ULTIMO skip comanda
  audioErrorRetried = false;        // nuovo brano: di nuovo un tentativo su errore
  stallRetried = false;             // idem per gli stalli
  audioStarted = false;             // nuovo brano: non è ancora partito
  audio.play().catch((err) => console.warn("Riproduzione bloccata dal browser:", err));
  /* Skip rapidissimi / rete lenta: iOS può rifiutare il play mentre il
     cambio traccia è ancora in corsa -> player congelato e servivano due
     click. La rete di sicurezza riprova a 400ms e 1s finché il brano non
     parte DAVVERO: un solo click/skip basta sempre. */
  riprovaPlay(myToken);
  updatePlayerInfo(song);
  highlightActive();
  refreshQueueIfOpen();
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
    if (audio.volume === 0) toast("Volume a zero: alzalo dal cursore");
    try { if (eqNeedsGraph()) ensureEQ(); } catch (e) {}   // gesto utente: contesto audio ok (solo se serve)
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
  refreshQueueIfOpen();
}

function cycleRepeat() {
  const order = ["off", "all", "one"];
  state.repeat = order[(order.indexOf(state.repeat) + 1) % order.length];
  updateModeButtons();
  refreshQueueIfOpen();
}

/* ---------- 11. AVANZAMENTO, SEEK, VOLUME ---------- */

function updateProgress() {
  const duration = audio.duration || 0;
  const current = audio.currentTime || 0;
  const pct = duration ? (current / duration * 100) + "%" : "0%";
  els.seekFill.style.width = pct;
  const cur = formatTime(current);
  /* Le scritte cambiano 1 volta al secondo ma il tick arriva ~4 volte:
     si riscrive solo quando cambia davvero (niente layout inutili) */
  if (cur !== updateProgress._c) {
    updateProgress._c = cur;
    els.timeCurrent.textContent = cur;
    if (els.fpTimeCurrent) els.fpTimeCurrent.textContent = cur;
  }
  if (els.fpSeekFill) els.fpSeekFill.style.width = pct;
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
  vizStart();
});
audio.addEventListener("pause", () => {
  setPlayIcons(false);
  document.body.classList.remove("is-playing");
  syncPlaybackState();
  vizStop();
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

/* Diario audio (diagnostica nelle impostazioni): ogni play/pausa/stallo/
   errore con orario e stato del grafo. Così se la musica si ferma da sola
   si legge il perché esatto invece di tirare a indovinare. */
const audioLog = [];
function audioLogAdd(ev, extra) {
  try {
    let ctxSt = "nativo";
    try {
      if (typeof eqCtx !== "undefined" && eqCtx) ctxSt = eqCtx.state;
    } catch (e) {}
    audioLog.push(new Date().toLocaleTimeString() + " " + ev +
      " t=" + Math.floor(audio.currentTime || 0) + "s " + ctxSt +
      " vol=" + audio.volume + (audio.muted ? " MUTED" : "") +
      " eq=" + (storage.get("ssg-eq") || "piatto") +
      (extra ? " " + extra : ""));
    if (audioLog.length > 15) audioLog.shift();
    const el = document.getElementById("set-audio-log");
    if (el) el.textContent = audioLog.join("\n") || "—";
  } catch (e) {}
}
["play", "pause", "playing", "waiting", "stalled", "error", "ended", "suspend"].forEach((t) => {
  try { audio.addEventListener(t, () => audioLogAdd(t)); } catch (e) {}
});
/* Stallo di rete (parte ma non prosegue): un solo recupero a brano —
   ricarica e riparte da dove era; se la rete è davvero morta ci si ferma */
audio.addEventListener("stalled", () => {
  if (stallRetried || audio.paused) return;
  stallRetried = true;
  setTimeout(() => {
    try {
      if (audio.paused) return;
      const t = audio.currentTime || 0;
      const onMeta = () => {
        try { audio.removeEventListener("loadedmetadata", onMeta); } catch (e) {}
        try { audio.currentTime = t; } catch (e2) {}
        audio.play().catch(() => {});
      };
      audio.addEventListener("loadedmetadata", onMeta);
      audio.load();
    } catch (e) {}
  }, 2000);
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
/* Scelta sfondo: Auto (orario) oppure fase fissa, applicata subito */
document.querySelectorAll("#set-sky .chip").forEach((b) => {
  b.addEventListener("click", () => {
    storage.set("ssg-sky", b.dataset.sky || "auto");
    syncSkyChips();
    try { SKY.resize(); } catch (e) {}
    haptic(10);
  });
});
function syncSkyChips() {
  const cur = storage.get("ssg-sky") || "auto";
  document.querySelectorAll("#set-sky .chip").forEach((c) => {
    c.classList.toggle("on", c.dataset.sky === cur);
  });
}
/* ---------- EFFETTI: visualizzatore audio on/off ---------- */
function syncVizChips() {
  const cur = storage.get("ssg-viz") || "on";
  document.querySelectorAll("#set-viz .chip").forEach((c) => {
    c.classList.toggle("on", c.dataset.viz === cur);
  });
}
document.querySelectorAll("#set-viz .chip").forEach((b) => {
  b.addEventListener("click", () => {
    storage.set("ssg-viz", b.dataset.viz === "off" ? "off" : "on");
    syncVizChips();
    try { if (vizEnabled() && !audio.paused) vizStart(); else vizStop(); }
    catch (e) {}
    haptic(10);
  });
});
/* ---------- RIPRODUZIONE: pulsante coda nel full player on/off ---------- */
function syncQueueChips() {
  const cur = storage.get("ssg-queue") || "on";
  document.querySelectorAll("#set-queue .chip").forEach((c) => {
    c.classList.toggle("on", c.dataset.queue === cur);
  });
}
function applyQueueVisibility() {
  try {
    const on = queueEnabled();
    if (els.fpQueueBtn) els.fpQueueBtn.classList.toggle("hidden", !on);
    if (!on) closeQueue();
  } catch (e) {}
}
document.querySelectorAll("#set-queue .chip").forEach((b) => {
  b.addEventListener("click", () => {
    storage.set("ssg-queue", b.dataset.queue === "off" ? "off" : "on");
    syncQueueChips();
    applyQueueVisibility();
    haptic(10);
  });
});
/* ---------- POPUP consigliati on/off (master) ---------- */
document.querySelectorAll("#set-popups .chip").forEach((b) => {
  b.addEventListener("click", () => {
    storage.set("ssg-popups", b.dataset.popups === "off" ? "off" : "on");
    syncPopupsChips();
    try { if (!popupsEnabled()) { hidePopMini(); closePop(); } else { popSchedule(); } } catch (e) {}
    haptic(10);
  });
});
if (els.settingsViewClose) {
  els.settingsViewClose.addEventListener("click", closeSettingsView);
}
if (els.settingsView) {
  els.settingsView.addEventListener("click", (e) => {
    if (e.target === els.settingsView) closeSettingsView();   // click fuori
  });
}
(function bindConfirmModal() {
  const m = document.getElementById("confirm-modal");
  if (!m) return;
  const cancel = document.getElementById("confirm-cancel");
  const ok = document.getElementById("confirm-ok");
  if (cancel) cancel.addEventListener("click", () => closeConfirm(false));
  if (ok) ok.addEventListener("click", () => closeConfirm(true));
  m.addEventListener("click", (e) => {
    if (e.target === m) closeConfirm(false);   // click fuori
  });
})();

/* RESET DEFINITIVO della memoria locale (richiesta di Marco): azzera
   tutto ciò che l'app ha salvato sul dispositivo — tutte le cache,
   service worker, localStorage e IndexedDB — poi ricarica da zero.
   Se qualche archivio resiste, lo dice invece di fingere di aver pulito. */
async function resetLocalMemory() {
  if (navigator.onLine === false) {
    toast("Serve connessione: il reset ricarica l'app da zero");
    return;
  }
  const ok = await askConfirm("Reset totale della memoria?",
    "Elimina TUTTO ciò che l'app ha salvato qui: brani offline, cache e dati locali (statistiche, preferiti, equalizzatore). Poi l'app si ricarica da zero.",
    "Resetta tutto");
  if (!ok) return;
  toast("Pulizia memoria in corso\u2026");
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      for (const name of names) {
        try {
          const cache = await caches.open(name);
          const keys = await cache.keys();
          for (const r of keys) {
            try { await cache.delete(r); } catch (e) {}
          }
          try { await caches.delete(name); } catch (e) {}
        } catch (e) {}
      }
    }
  } catch (e) {}
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        try { await reg.unregister(); } catch (e) {}
      }
    }
  } catch (e) {}
  try {
    if (window.indexedDB && indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const d of dbs) {
        if (!d || !d.name) continue;
        try {
          await new Promise((res) => {
            const q = indexedDB.deleteDatabase(d.name);
            q.onsuccess = q.onerror = q.onblocked = () => res();
          });
        } catch (e) {}
      }
    }
  } catch (e) {}
  try { window.localStorage.clear(); } catch (e) {}
  let left = -1;
  try { left = (await caches.keys()).length; } catch (e) {}
  if (left === 0) toast("Memoria azzerata: ricarico");
  else if (left > 0) toast("Restano " + left + " archivi: chiudi e riapri l'app");
  else toast("Pulizia fatta: ricarico");
  setTimeout(() => { try { location.reload(); } catch (e) {} }, 900);
}
(function bindMemoryReset() {
  const b = document.getElementById("btn-memory-reset");
  if (!b) return;
  b.addEventListener("click", resetLocalMemory);
})();
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
  // Coda aperta: il tocco serve a scorrerla, non ad armare la chiusura
  try { if (e.target.closest && e.target.closest("#fp-queue-sheet")) return; } catch (err) {}
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
  if (dy > 70 && Math.abs(dx) < 90) {
    // Coda aperta: niente chiusura del player (rete di sicurezza)
    try { if (els.fpQueueSheet && !els.fpQueueSheet.classList.contains("hidden")) return; } catch (err) {}
    closeFullPlayer();
  }
}, { passive: true });

function closeFpEq() {
  if (!els.fpEqSheet) return;
  els.fpEqSheet.classList.add("hidden");
  els.fpEqSheet.setAttribute("aria-hidden", "true");
}

/* ---------- CODA UP NEXT (pulsante nel full player) ----------
   Prossimi brani in ordine di coda: tocca per saltare, ✕ per togliere.
   Con repeat/shuffle attivi si ricomincia da capo (segnato "Poi"). */
function queueEnabled() {
  return storage.get("ssg-queue") !== "off";   // attiva di default: si spegne in Impostazioni → Riproduzione
}
function queueUpcoming() {
  const q = state.queue, pos = state.queuePos, out = [];
  if (!q.length || pos < 0) return out;
  for (let k = pos + 1; k < q.length && out.length < 40; k++) out.push({ idx: q[k], qp: k });
  if ((state.repeat !== "off" || state.shuffle) && out.length < 40) {
    for (let k = 0; k < pos && out.length < 40; k++) out.push({ idx: q[k], qp: k, wrapped: true });
  }
  return out;
}
function removeQueueAt(qp) {
  if (qp < 0 || qp >= state.queue.length || qp === state.queuePos) return;
  state.queue.splice(qp, 1);
  if (qp < state.queuePos) state.queuePos--;
  renderQueue();
}
function renderQueue() {
  const list = document.getElementById("fp-queue-list");
  const now = document.getElementById("fp-queue-now");
  if (!list || !now) return;
  list.innerHTML = "";
  now.innerHTML = "";
  const cur = currentIndex();
  if (cur < 0 || !state.songs[cur]) {
    const d = document.createElement("div");
    d.className = "fp-q-empty";
    d.textContent = "Niente in riproduzione: scegli un brano e qui vedrai i prossimi.";
    now.appendChild(d);
    return;
  }
  const s = state.songs[cur];
  const lab = document.createElement("div");
  lab.className = "qn-label";
  lab.textContent = "IN RIPRODUZIONE";
  const t = document.createElement("div");
  t.className = "qn-title";
  t.textContent = s.titolo || fileTitle(s.file);
  const sub = document.createElement("div");
  sub.className = "qn-sub";
  sub.textContent = s.album || "";
  now.appendChild(lab);
  now.appendChild(t);
  now.appendChild(sub);
  const up = queueUpcoming();
  if (!up.length) {
    const d = document.createElement("div");
    d.className = "fp-q-empty";
    d.textContent = state.repeat !== "off" || state.shuffle
      ? "Ultimo brano: poi si ricomincia."
      : "Fine della coda: attiva Ripeti per continuare.";
    list.appendChild(d);
    return;
  }
  let sepDone = false;
  up.forEach((e, n) => {
    if (e.wrapped && !sepDone) {
      sepDone = true;
      const sep = document.createElement("div");
      sep.className = "fp-q-sep";
      sep.textContent = "POI SI RICOMINCIA";
      list.appendChild(sep);
    }
    const song = state.songs[e.idx];
    if (!song) return;
    const row = document.createElement("button");
    row.className = "fp-q-row";
    const num = document.createElement("span");
    num.className = "fp-q-num";
    num.textContent = String(n + 1);
    const meta = document.createElement("div");
    meta.className = "fp-q-meta";
    const tt = document.createElement("div");
    tt.className = "fp-q-title";
    tt.textContent = song.titolo || fileTitle(song.file);
    const ss = document.createElement("div");
    ss.className = "fp-q-sub";
    ss.textContent = song.album || "";
    meta.appendChild(tt);
    meta.appendChild(ss);
    const x = document.createElement("span");
    x.className = "fp-q-x";
    x.textContent = "✕";
    x.setAttribute("role", "button");
    x.setAttribute("aria-label", "Togli dalla coda");
    x.addEventListener("click", (ev) => {
      ev.stopPropagation();
      removeQueueAt(e.qp);
      haptic(8);
    });
    row.appendChild(num);
    row.appendChild(meta);
    row.appendChild(x);
    row.addEventListener("click", () => {
      playSong(e.idx);
      haptic(12);
    });
    list.appendChild(row);
  });
}
/* Ridisegna la coda solo se il pannello è aperto (playSong la chiama sempre) */
function refreshQueueIfOpen() {
  try {
    const sh = document.getElementById("fp-queue-sheet");
    if (sh && !sh.classList.contains("hidden")) renderQueue();
  } catch (e) {}
}
function openQueue() {
  if (!els.fpQueueSheet || !queueEnabled()) return;
  renderQueue();
  els.fpQueueSheet.classList.remove("hidden");
  els.fpQueueSheet.setAttribute("aria-hidden", "false");
}
function closeQueue() {
  if (!els.fpQueueSheet) return;
  els.fpQueueSheet.classList.add("hidden");
  els.fpQueueSheet.setAttribute("aria-hidden", "true");
}

/* ---------- 14. FULL PLAYER a tendina ---------- */

function openFullPlayer() {
  if (!els.fp) return;
  els.fp.classList.add("open");
  els.fp.setAttribute("aria-hidden", "false");
  try { if (!audio.paused) vizStart(); } catch (e) {}
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
  closeFpEq();   // il pannello EQ segue sempre il player: niente stati fantasma
  closeQueue();    // idem per la coda
  try { if (fpYtPlayer && fpYtReady) fpYtPlayer.pauseVideo(); } catch (e) {}   // YT in pausa col player
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
  "Gta VI": "assets/video/GTA VI 720p.mp4?v=2",
  "CACAO ACUSTIC LIVE": "yt:U7ZogUlSHMM",
  "5- Puozzo Car": "yt:4c7BdquPEqE",
  "6- Torna da me": "yt:0yeqH3oK9BY"
};

let fpVideoEl = null;     // elemento <video> dentro la copertina del full player
let fpHasVideo = false;   // il brano corrente ha un videoclip?
let fpVideoKind = "file";   // "file" (mp4 locale) oppure "yt" (YouTube, yt:ID)
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
    if (!fpHasVideo || !fpVideoFullscreen() || !fpSameContent()) return;
    setTimeout(() => {
      if (fpVideoEl.paused && !audio.paused) audio.pause();
    }, 300);
  });
  fpVideoEl.addEventListener("play", () => {
    if (!fpHasVideo || !fpVideoFullscreen() || !fpSameContent()) return;
    setTimeout(() => {
      if (!fpVideoEl.paused && audio.paused) audio.play().catch(() => {});
    }, 300);
  });
  /* Metadati pronti in ritardo (rete lenta): si riallinea e si fa partire
     subito, senza aspettare il prossimo timeupdate */
  fpVideoEl.addEventListener("canplay", () => {
    if (fpHasVideo && fpVideoOn && !audio.paused) syncFpVideoToAudio();
  });
  /* Il video resta in buffering mentre la canzone va: dopo 1.2s lo si
     riporta sul punto della canzone e lo si fa ripartire */
  fpVideoEl.addEventListener("waiting", () => {
    if (!fpHasVideo || !fpVideoOn || audio.paused) return;
    setTimeout(() => {
      try {
        if (!fpHasVideo || !fpVideoOn || audio.paused || fpVideoEl.paused) return;
        if (fpVideoEl.readyState >= 3) return;   // si è ripreso da solo
        if (isFinite(fpVideoEl.duration) && isFinite(audio.duration) &&
            Math.abs(fpVideoEl.duration - audio.duration) < 3) {
          fpVideoEl.playbackRate = 1;
          fpVideoEl.currentTime = audio.currentTime % fpVideoEl.duration;
        }
        const p = fpVideoEl.play();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {}
    }, 1200);
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
  fpVideoKind = (typeof src === "string" && src.indexOf("yt:") === 0) ? "yt" : "file";
  /* Nuovo brano: si ri-armano i flag di sync (con gli skip rapidissimi il
     "playing" del brano prima non scatta e il riallineo resterebbe
     disattivato per il brano dopo, che partirebbe fuori sync) */
  fpStartSyncPending = false;
  fpStallChecks = 0;
  fpLastVideoTime = -1;
  fpLastDriftSync = 0;
  fpLastRateNudge = 0;
  const toggle = els.fpVideoToggle;

  if (!fpHasVideo) {
    if (fpVideoEl) { fpVideoEl.pause(); fpVideoEl.classList.add("hidden"); }
    if (toggle) toggle.classList.add("hidden");
    if (els.fpVideoFs) els.fpVideoFs.classList.add("hidden");
    els.fpCover.classList.remove("playing-video");   // riquadro di nuovo quadrato
    hideYt();
    return;
  }

  if (fpVideoKind === "yt") {
    if (fpVideoEl) {
      try { fpVideoEl.pause(); } catch (e) {}
      fpVideoEl.classList.add("hidden");
    }
    updateYtTrack(src.slice(3));
    return;
  }

  hideYt();
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
    /* Niente currentTime = 0 forzato: il src nuovo parte da zero da solo,
       e il seek a metà caricamento rischiava di impallare la decodifica */
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
   in fullscreen e appena usciti, così non salta indietro).
   MAI se il video non è mai partito davvero (fermo a 0): altrimenti
   aprendo il fullscreen la canzone ripartirebbe dall'inizio. */
function fpAlignAudioToVideo() {
  if (!fpVideoEl || !fpHasVideo) return;
  try {
    if ((fpVideoEl.currentTime || 0) < 1 && fpVideoEl.paused) return;
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
/* Stesso contenuto audio/video? Solo allora il video può comandare (in
   fullscreen la canzone lo segue); sennò comanda sempre la canzone */
function fpSameContent() {
  try {
    return fpVideoEl && isFinite(fpVideoEl.duration) && isFinite(audio.duration) &&
      Math.abs(fpVideoEl.duration - audio.duration) < 3;
  } catch (e) { return false; }
}
function syncFpVideoToAudio() {
  if (!fpHasVideo) return;
  if (fpVideoKind === "yt") { syncYtToAudio(); return; }
  if (!fpVideoEl) return;
  if (!fpVideoOn) { try { fpVideoEl.pause(); } catch (e) {} return; }   // video nascosto: mai farlo girare
  if (fpVideoFullscreen() && fpSameContent()) {
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
       * scarto piccolo (0.1-1s) -> micro-velocità (1.05x/0.95x) SENZA seek:
         la decodifica non si interrompe mai, il video non scatta e non
         si blocca, e riallinea la deriva in un paio di secondi. */
function fpDriftCheck() {
  if (!fpHasVideo || audio.paused) return;
  if (fpVideoKind === "yt") { fpYtDrift(); return; }
  if (!fpVideoEl || !fpVideoOn) return;
  if (!isFinite(audio.duration) || !isFinite(fpVideoEl.duration)) return;
  const durMatch = Math.abs(fpVideoEl.duration - audio.duration) < 3;
  const drift = (audio.currentTime || 0) - (fpVideoEl.currentTime || 0);
  const now = Date.now();

  if (fpVideoFullscreen() && fpSameContent()) {
    // Il video comanda: correzione RARA della canzone, come prima
    if (durMatch && now - fpLastDriftSync >= 10000 && Math.abs(drift) > 1.5) {
      try { audio.currentTime = fpVideoEl.currentTime; } catch (e) {}
      fpLastDriftSync = now;
    }
    fpLastVideoTime = -1;
    fpStallChecks = 0;
    return;
  }

  // Fuori dal fullscreen (o contenuti diversi): comanda la canzone, anche
  // con durate diverse (timeline parallele come per YouTube)

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
        fpVideoEl.currentTime = audio.currentTime % fpVideoEl.duration;
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
        fpVideoEl.currentTime = audio.currentTime % fpVideoEl.duration;
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

/* ---------- VIDEO DA YOUTUBE (niente download, solo streaming) ----------
   TRACK_VIDEOS accetta "yt:<ID>": stesso riquadro, stessa sync dell'mp4.
   L'API si carica solo al primo brano YT online; il player è unico e si
   ricrea al cambio brano. Sempre muto: l'audio resta l'mp3 della canzone.
   Offline, API bloccata o embed disabilitato -> copertina, nessun errore. */
let fpYtPlayer = null;    // player YT unico (ricreato a ogni brano YT)
let fpYtId = "";          // videoId caricato nel player
let fpYtReady = false;    // onReady scattato per il brano corrente
let fpYtToken = 0;        // anti-corsa: solo l'ultimo brano comanda
let fpYtSeekAt = 0;       // ultimo seek chiesto da noi (anti-liti col buffering)
/* Seek YT centralizzato: registra l'istante così la deriva non corregge
   mentre il player sta ancora caricando il salto (evita raffiche di seek) */
function ytSeek(t) {
  try {
    fpYtSeekAt = Date.now();
    fpYtPlayer.seekTo(t, true);
  } catch (e) {}
}
let fpYtAligned = false;  // riallineo iniziale già fatto per il brano
let ytApiPromise = null;  // promessa di caricamento API (una sola volta)

function ytApiLoaded() {
  try { return !!(window.YT && window.YT.Player); } catch (e) { return false; }
}
function ensureYTApi() {
  if (ytApiLoaded()) return Promise.resolve(true);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(ytApiLoaded()); } };
    try {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { try { if (prev) prev(); } catch (e) {} fin(); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.onerror = fin;
      document.head.appendChild(s);
      setTimeout(fin, 8000);   // rete di sicurezza: mai appesi
    } catch (e) { fin(); }
  });
  return ytApiPromise;
}
function destroyYtPlayer() {
  fpYtReady = false;
  try { if (fpYtPlayer && fpYtPlayer.destroy) fpYtPlayer.destroy(); } catch (e) {}
  fpYtPlayer = null;
}
/* Nasconde il box YT e mette in pausa (cambio brano, video nascosto) */
function hideYt() {
  try {
    const box = document.getElementById("fp-yt");
    if (box) box.classList.add("hidden");
  } catch (e) {}
  try { if (fpYtPlayer && fpYtReady) fpYtPlayer.pauseVideo(); } catch (e) {}
}
/* Copertina al posto del video YT (offline, API bloccata, embed vietato) */
function ytFallbackCover() {
  fpYtReady = false;
  hideYt();
  try { els.fpCover.classList.remove("playing-video"); } catch (e) {}
}
/* Fa ripartire il video YT in modo robusto (stessi retry dell'mp4).
   Il player è unico e contiene sempre il brano corrente, quindi i retry
   non possono mai far partire un video vecchio sopra una canzone nuova. */
function fpYtResume() {
  if (!fpYtPlayer || !fpYtReady || audio.paused) return;
  if (fpVideoKind !== "yt" || !fpHasVideo || !fpVideoOn) return;
  if (fpYtState() === 1) return;
  const attempt = () => {
    try {
      if (fpVideoKind !== "yt" || !fpHasVideo || audio.paused) return;
      fpYtPlayer.mute();
      fpYtPlayer.setPlaybackRate(1);
      fpYtPlayer.playVideo();
    } catch (e) {}
  };
  attempt();
  setTimeout(() => { if (fpYtPlayer && fpYtState() !== 1 && !audio.paused) attempt(); }, 400);
  setTimeout(() => { if (fpYtPlayer && fpYtState() !== 1 && !audio.paused) attempt(); }, 1200);
}
function fpYtState() {
  try { return fpYtPlayer ? fpYtPlayer.getPlayerState() : -99; }
  catch (e) { return -99; }
}
/* Il video YT segue la canzone (chiamato al posto della sync mp4) */
function syncYtToAudio() {
  if (!fpYtPlayer || !fpYtReady || !fpHasVideo || fpVideoKind !== "yt") return;
  if (!fpVideoOn) { try { fpYtPlayer.pauseVideo(); } catch (e) {} return; }
  if (audio.paused) { try { fpYtPlayer.pauseVideo(); } catch (e) {} return; }
  fpYtResume();
}
/* Deriva YT sul timeupdate dell'audio (specchio semplificato del drift mp4:
   restart se fermo, seek sui distacchi grandi; niente micro-velocità) */
function fpYtDrift() {
  if (!fpYtPlayer || !fpYtReady || audio.paused) return;
  let dur = NaN, cur = NaN;
  try { dur = fpYtPlayer.getDuration(); cur = fpYtPlayer.getCurrentTime(); }
  catch (e) { return; }
  if (!isFinite(dur) || !isFinite(audio.duration)) return;
  if (fpYtState() !== 1) { fpYtResume(); return; }
  if (Date.now() - fpYtSeekAt < 1500) return;   // salta in atterraggio: non correggere
  const drift = (audio.currentTime || 0) - (cur || 0);
  if (Math.abs(drift) <= 0.2) return;
  const now = Date.now();
  if (Math.abs(drift) > 1.2 && now - fpLastDriftSync >= 3000) {
    ytSeek(Math.max(0, audio.currentTime % dur));
    fpLastDriftSync = now;
  }
}
function onYtState(st) {
  if (!fpHasVideo || fpVideoKind !== "yt") return;
  if (st === 1) {
    if (!fpYtAligned) {
      fpYtAligned = true;
      /* Timeline parallele: il video segue il punto della canzone anche se
         dura di più o di meno (i videoclip non sono il master audio) */
      try {
        const d = fpYtPlayer.getDuration();
        if (isFinite(d) && isFinite(audio.duration) &&
            Math.abs((audio.currentTime || 0) - fpYtPlayer.getCurrentTime()) > 0.3) {
          ytSeek(audio.currentTime % d);
        }
      } catch (e) {}
    }
    try { fpYtPlayer.setPlaybackQualityRange("hd1080", "hd1080"); } catch (e) {}   // resta in 1080p
    try { fpYtPlayer.unloadModule("captions"); } catch (e2) {}   // niente sottotitoli
  } else if (st === 0) {
    // Finito prima della canzone: loop come l'mp4
    if (!audio.paused && fpVideoOn) {
      try { ytSeek(0); fpYtPlayer.playVideo(); } catch (e) {}
    }
  }
}
/* Prepara il brano YT nel riquadro: riusa il player se è già quello giusto,
   altrimenti lo ricrea (la buildCover precedente ha svuotato il riquadro) */
function updateYtTrack(videoId) {
  if (!els.fpCover || !videoId) return;
  const prevId = fpYtId;
  fpYtId = videoId;
  fpYtAligned = false;
  if (els.fpVideoToggle) els.fpVideoToggle.classList.remove("hidden");
  if (els.fpVideoFs) els.fpVideoFs.classList.remove("hidden");
  const boxNow = document.getElementById("fp-yt");
  const same = prevId === videoId && fpYtPlayer && fpYtReady && boxNow &&
    boxNow.parentElement === els.fpCover;
  if (same) {
    boxNow.classList.toggle("hidden", !fpVideoOn);
    els.fpCover.classList.toggle("playing-video", fpVideoOn);
    /* Riuso (es. riapertura player): riallinea subito, l'audio potrebbe
       essere ripartito da zero mentre il video era avanti */
    try {
      const d0 = fpYtPlayer.getDuration();
      if (fpVideoOn && isFinite(d0) && isFinite(audio.duration) &&
          Math.abs((audio.currentTime || 0) - fpYtPlayer.getCurrentTime()) > 0.3) {
        ytSeek(audio.currentTime % d0);
      }
    } catch (e) {}
    syncYtToAudio();
    return;
  }
  destroyYtPlayer();
  /* L'API YouTube SOSTITUISCE l'elemento bersaglio con l'iframe: se gli dessimo
     il box, sparirebbero dimensioni e stili (si sentiva l'audio senza video).
     Dentro c'è un contenitore sacrificale che viene rimpiazzato al suo posto */
  let box = document.getElementById("fp-yt");
  if (!box || box.parentElement !== els.fpCover) {
    try { if (box && box.parentElement) box.parentElement.removeChild(box); } catch (e) {}
    box = document.createElement("div");
    box.id = "fp-yt";
    box.className = "fp-video fp-yt" + (fpVideoOn ? "" : " hidden");
    els.fpCover.appendChild(box);
  }
  box.innerHTML = '<div id="fp-yt-inner"></div>';
  if (els.fpVideoFs && els.fpVideoFs.parentElement !== els.fpCover) els.fpCover.appendChild(els.fpVideoFs);
  els.fpCover.classList.toggle("playing-video", fpVideoOn);
  if (!fpVideoOn) return;   // nascosto dall'utente: niente caricamento
  if (navigator.onLine === false) { ytFallbackCover(); return; }
  const tk = ++fpYtToken;
  ensureYTApi().then((ok) => {
    if (tk !== fpYtToken) return;
    if (!ok || !ytApiLoaded() || !document.getElementById("fp-yt")) {
      ytFallbackCover();
      return;
    }
    let origin = null;
    try { origin = (location.origin || "").indexOf("http") === 0 ? location.origin : null; } catch (e) {}
    const vars = { rel: 0, modestbranding: 1, playsinline: 1, controls: 0, disablekb: 1, iv_load_policy: 3, mute: 1, cc_load_policy: 0 };
    if (origin) vars.origin = origin;
    try {
      fpYtPlayer = new window.YT.Player("fp-yt-inner", {
        videoId: videoId,
        playerVars: vars,
        events: {
          onReady: (ev) => {
            if (tk !== fpYtToken) return;
            fpYtReady = true;
            try { ev.target.mute(); } catch (e) {}
            try { ev.target.setPlaybackQualityRange("hd1080", "hd1080"); } catch (e) {}   // 1080p se la banda regge
            try { ev.target.setOption("captions", "track", {}); } catch (e) {}          // niente sottotitoli
            try { ev.target.unloadModule("captions"); } catch (e2) {}                   // cintura di sicurezza
            fpYtAligned = false;
            syncYtToAudio();
          },
          onStateChange: (ev) => { if (tk === fpYtToken && ev) onYtState(ev.data); },
          onError: () => { if (tk === fpYtToken) ytFallbackCover(); }
        }
      });
    } catch (e) { if (tk === fpYtToken) ytFallbackCover(); }
  });
}

/* Fullscreen: l'utente muove/pausa il video dal player nativo -> la canzone
   segue (valgono solo lì: fuori dal fullscreen comanda l'audio). I listener
   stanno dentro ensureFpVideo perché l'elemento video nasce lì. */

audio.addEventListener("play", syncFpVideoToAudio);
audio.addEventListener("pause", syncFpVideoToAudio);

/* La canzone viene sfogliata (seek bar, tastiera, player di sistema):
   il video salta subito al nuovo punto e resta sincronizzato */
audio.addEventListener("seeked", () => {
  if (!fpHasVideo || fpVideoFullscreen()) return;
  if (fpVideoKind === "yt") {
    try {
      if (fpYtPlayer && fpYtReady && !audio.paused) {
        const d = fpYtPlayer.getDuration();
        if (isFinite(d) && isFinite(audio.duration)) {
          ytSeek(Math.max(0, audio.currentTime % d));
        }
      }
    } catch (e) {}
    return;
  }
  if (!fpVideoEl) return;
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
  els.fpEq.addEventListener("click", () => {
    if (!els.fpEqSheet) return;
    if (els.fpEqSheet.classList.contains("hidden")) {
      if (!ensureEQ()) { toast("Equalizzatore non supportato qui"); return; }
      buildEQControls(els.fpEqBody);
      els.fpEqSheet.classList.remove("hidden");
      els.fpEqSheet.setAttribute("aria-hidden", "false");
    } else {
      closeFpEq();
    }
    haptic(10);
  });
  if (els.fpEqClose) els.fpEqClose.addEventListener("click", closeFpEq);
  if (els.fpQueueBtn) els.fpQueueBtn.addEventListener("click", () => {
    if (!els.fpQueueSheet) return;
    if (els.fpQueueSheet.classList.contains("hidden")) openQueue();
    else closeQueue();
    haptic(10);
  });
  if (els.fpQueueClose) els.fpQueueClose.addEventListener("click", closeQueue);
  if (els.fpQueueSheet) {
    els.fpQueueSheet.addEventListener("click", (e) => {
      if (e.target === els.fpQueueSheet) closeQueue();   // click fuori dalla card
    });
  }
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
      if (!fpHasVideo) return;
      fpVideoOn = !fpVideoOn;
      if (fpVideoKind === "yt") {
        const box = document.getElementById("fp-yt");
        if (box) box.classList.toggle("hidden", !fpVideoOn);
        els.fpCover.classList.toggle("playing-video", fpVideoOn);
        if (fpVideoOn) {
          const cur = currentIndex();
          const s = cur >= 0 ? state.songs[cur] : null;
          const src = s ? TRACK_VIDEOS[s.titolo] : null;
          if (src && src.indexOf("yt:") === 0) updateYtTrack(src.slice(3));
        } else hideYt();
        haptic(12);
        return;
      }
      if (!fpVideoEl) return;
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
    if (!fpHasVideo) return;
    if (fpVideoKind === "yt") {
      try {
        const box = document.getElementById("fp-yt");
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (box && box.requestFullscreen) await box.requestFullscreen();
      } catch (e) {}
      haptic(12);
      return;
    }
    if (!fpVideoEl) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        /* Entrata: se il video è fermo all'inizio è LUI a mettersi sulla
           canzone (allineare la canzone al video qui la farebbe ripartire
           da zero: era il bug del fullscreen su PC) */
        const vt = fpVideoEl.currentTime || 0;
        if (fpVideoEl.paused || vt < 1 || !isFinite(vt)) {
          try {
            fpVideoEl.playbackRate = 1;
            if (isFinite(fpVideoEl.duration)) {
              fpVideoEl.currentTime = (audio.currentTime || 0) % fpVideoEl.duration;
            }
          } catch (e2) {}
        } else {
          fpAlignAudioToVideo();
        }
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
    if (fpVideoKind === "yt" && fpHasVideo && !document.fullscreenElement) {
      syncYtToAudio();   // usciti dal fullscreen YT: l'audio ha sempre comandato
      return;
    }
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
    if (e.target === els.fpEq) return;                 // il tasto EQ gestisce il proprio click
    if (e.target.closest(".fp-share-wrap")) return;          // il menu Condividi gestisce il proprio click
    if (e.target.closest("#fp-video-toggle")) return;        // il tasto Video gestisce il proprio click
    if (e.target.closest("#fp-video-fs")) return;            // il tasto Tutto schermo gestisce il proprio click
    if (e.target.closest("#fp-queue-btn")) return;            // il tasto Coda gestisce il proprio click
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
    if (!closeTopLayer()) goHome();
  }
});

/* Chiude UN solo livello (il più alto): la stessa catena la usano Esc e il
   tasto Indietro di sistema. Ritorna true se ha chiuso qualcosa. */
function closeTopLayer() {
  try {
    const cm = document.getElementById("confirm-modal");
    if (cm && !cm.classList.contains("hidden")) { closeConfirm(false); return true; }
    if (popSheetOpen()) { closePop(); return true; }
    const pm = document.getElementById("pop-mini");
    if (pm && !pm.classList.contains("hidden")) { hidePopMini(); return true; }
    if (els.settingsView && !els.settingsView.classList.contains("hidden")) { closeSettingsView(); return true; }
    if (els.searchView && !els.searchView.classList.contains("hidden")) { closeSearchView(); return true; }
    if (els.fpEqSheet && !els.fpEqSheet.classList.contains("hidden")) { closeFpEq(); return true; }
    if (els.fpQueueSheet && !els.fpQueueSheet.classList.contains("hidden")) { closeQueue(); return true; }
    if (els.fp && els.fp.classList.contains("open")) { closeFullPlayer(); return true; }
  } catch (e) {}
  return false;
}

/* Tasto Indietro di sistema (Android: swipe da entrambi i bordi): chiude un
   livello alla volta invece di uscire dall'app. Una sola voce di guardia:
   se non c'era niente da chiudere non si ri-arma e il Back dopo esce. */
try {
  if (!history.state || !history.state.trap) history.pushState({ trap: true }, "");
  window.addEventListener("popstate", () => {
    try {
      if (closeTopLayer()) history.pushState({ trap: true }, "");
    } catch (e) {}
  });
} catch (e) {}

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
  // Anche hardware modesto (pochi core / poca RAM): stesso trattamento
  // leggero. Soglie conservative: solo telefoni davvero deboli, mai i medi.
  try {
    if (!ecoMode && typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4) ecoMode = true;
    if (!ecoMode && typeof navigator.deviceMemory === "number" && navigator.deviceMemory <= 2) ecoMode = true;
  } catch (e) {}
  const DPR = ecoMode ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Fase giorno/notte dall'ora locale (leggera: non stravolge il look).
  // day: 0 = notte fonda, 1 = giorno soft. dusk: toni caldi bassi
  // solo attorno ad alba e tramonto. Transizioni morbide (smoothstep).
  let PH = { day: 0, dusk: 0 };
  function skyPhase() {
    // Scelta manuale dalle impostazioni: Auto (orario) oppure fase fissa
    try {
      const mode = storage.get("ssg-sky") || "auto";
      if (mode === "giorno") return { h: 12, day: 1, dusk: 0 };
      if (mode === "notte") return { h: 0, day: 0, dusk: 0 };
      if (mode === "alba") return { h: 7, day: 0.26, dusk: 1 };
      if (mode === "tramonto") return { h: 19, day: 0.26, dusk: 1 };
    } catch (e) {}
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60;
    const ramp = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    return {
      h: h,
      day: ramp(h, 6, 9) * (1 - ramp(h, 17, 20)),
      dusk: Math.max(ramp(h, 5, 6.5) * (1 - ramp(h, 8, 9.5)),
                     ramp(h, 16.5, 18) * (1 - ramp(h, 19.5, 21)))
    };
  }
  function mix3(a, b, t) { return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)); }
  function applySkyBg() {
    try {
      let c = mix3([10, 10, 16], [38, 50, 74], PH.day);   // notte -> blu soft
      c = mix3(c, [46, 28, 44], PH.dusk * 0.7);           // caldo ad alba/tramonto
      document.documentElement.style.setProperty("--bg",
        "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")");
      applyBrandPhase();   // il titolo segue il cielo
    } catch (e) {}
  }
  /* Il titolo SSG Universe cambia tinta col cielo (stessa logica dello
     sfondo): neon vivo di notte, più profondo di giorno per il contrasto,
     caldo ad alba/tramonto. Di notte i valori sono identici a prima. */
  function applyBrandPhase() {
    try {
      let g1 = mix3([143, 134, 255], [90, 79, 224], PH.day);
      let g2 = mix3([94, 162, 255], [47, 111, 228], PH.day);
      let g3 = mix3([201, 188, 255], [122, 111, 240], PH.day);
      let gl = mix3([124, 108, 255], [90, 79, 224], PH.day);
      const w = PH.dusk * 0.6;
      g1 = mix3(g1, [255, 150, 110], w);
      g2 = mix3(g2, [240, 120, 180], w);
      g3 = mix3(g3, [255, 214, 165], w);
      gl = mix3(gl, [255, 150, 110], w);
      const st = document.documentElement.style;
      st.setProperty("--brand-g1", "rgb(" + g1[0] + "," + g1[1] + "," + g1[2] + ")");
      st.setProperty("--brand-g2", "rgb(" + g2[0] + "," + g2[1] + "," + g2[2] + ")");
      st.setProperty("--brand-g3", "rgb(" + g3[0] + "," + g3[1] + "," + g3[2] + ")");
      st.setProperty("--brand-glow", "rgba(" + gl[0] + "," + gl[1] + "," + gl[2] + ",.35)");
    } catch (e) {}
  }

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

    // Nebulose pre-renderizzate nel canvas (il CSS non le raddoppia).
    // Di giorno si attenuano (resta un accenno, niente stravolgimenti).
    sctx.globalAlpha = 1 - 0.45 * PH.day;
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
    sctx.globalAlpha = 1;

    // Alba/tramonto: velo caldo basso
    if (PH.dusk > 0.02) {
      const dw = sctx.createRadialGradient(W / 2, H * 1.02, 0, W / 2, H * 1.02, W * .75);
      dw.addColorStop(0, "rgba(255,150,90," + (0.16 * PH.dusk).toFixed(3) + ")");
      dw.addColorStop(1, "rgba(0,0,0,0)");
      sctx.fillStyle = dw;
      sctx.fillRect(0, 0, W, H);
    }

    // Nebulose di fase: magenta/arancio ad alba e tramonto, azzurrino tenue di giorno
    if (PH.dusk > 0.02) {
      [[W * .3, H * .7, W * .4, "255,120,80"],
       [W * .75, H * .6, W * .38, "200,80,160"]].forEach(function (n) {
        const g = sctx.createRadialGradient(n[0], n[1], 0, n[0], n[1], n[2]);
        g.addColorStop(0, "rgba(" + n[3] + "," + (0.2 * PH.dusk).toFixed(3) + ")");
        g.addColorStop(1, "rgba(0,0,0,0)");
        sctx.fillStyle = g;
        sctx.fillRect(0, 0, W, H);
      });
    }
    if (PH.day > 0.02) {
      const cw = sctx.createRadialGradient(W * .5, H * .3, 0, W * .5, H * .3, W * .6);
      cw.addColorStop(0, "rgba(150,190,255," + (0.1 * PH.day).toFixed(3) + ")");
      cw.addColorStop(1, "rgba(0,0,0,0)");
      sctx.fillStyle = cw;
      sctx.fillRect(0, 0, W, H);
    }

    // Fascia luminosa all'orizzonte: calda ad alba/tramonto, azzurrina di giorno
    (function () {
      const hw = Math.max(PH.dusk, PH.day * 0.55);
      if (hw <= 0.02) return;
      const hc = PH.dusk >= PH.day * 0.55 ? [255, 141, 74] : mix3([122, 168, 255], [255, 200, 130], PH.day * 0.45);
      const hg = sctx.createLinearGradient(0, H * .66, 0, H);
      hg.addColorStop(0, "rgba(0,0,0,0)");
      hg.addColorStop(1, "rgba(" + hc[0] + "," + hc[1] + "," + hc[2] + "," + (0.16 * hw).toFixed(3) + ")");
      sctx.fillStyle = hg;
      sctx.fillRect(0, H * .66, W, H * .34);
    })();

    // SOLE: disco + alone. Sale col giorno (alto a mezzogiorno), basso e
    // caldo ad alba/tramonto (percorre il cielo da sinistra a destra).
    // Di notte resta spento: la notte non si tocca.
    (function () {
      const sunA = Math.max(PH.day, PH.dusk);
      if (sunA <= 0.02 || W < 10 || H < 10) return;
      const dp = Math.min(1, Math.max(0, ((PH.h || 12) - 6) / 14));
      const sx = W * (0.28 + 0.44 * dp);
      const sy = H * (1.0 - 0.78 * PH.day);
      const warm = Math.max(PH.dusk, 1 - PH.day, PH.day * 0.25);
      const glow = mix3([200, 220, 255], [255, 170, 95], warm);
      const R = Math.min(W, H) * 0.042 * (1 + 0.3 * (1 - PH.day));
      const gg = sctx.createRadialGradient(sx, sy, 0, sx, sy, Math.min(W, H) * 0.5);
      gg.addColorStop(0, "rgba(" + glow[0] + "," + glow[1] + "," + glow[2] + "," + (0.5 * sunA).toFixed(3) + ")");
      gg.addColorStop(1, "rgba(0,0,0,0)");
      sctx.fillStyle = gg;
      sctx.fillRect(0, 0, W, H);
      const disc = mix3([235, 242, 255], [255, 236, 210], warm);
      sctx.fillStyle = "rgba(" + disc[0] + "," + disc[1] + "," + disc[2] + "," + (0.95 * sunA).toFixed(3) + ")";
      sctx.beginPath();
      sctx.arc(sx, sy, Math.max(1, R), 0, 7);
      sctx.fill();
    })();

    // CIRRI SOTTILI di giorno: 3 strisce chiare alte, quasi impercettibili
    (function () {
      const ca = Math.max(PH.day * 0.7, PH.dusk * 0.4);
      if (ca <= 0.02) return;
      const cc = mix3([170, 200, 240], [255, 200, 150], Math.min(1, PH.dusk * 1.2));
      [[0.18, 0.05], [0.3, 0.035], [0.42, 0.045]].forEach(function (c) {
        const y0 = H * c[0], hh = Math.max(8, H * c[1]);
        const cg = sctx.createLinearGradient(0, y0 - hh, 0, y0 + hh);
        const a = (0.05 * ca).toFixed(3);
        cg.addColorStop(0, "rgba(0,0,0,0)");
        cg.addColorStop(0.5, "rgba(" + cc[0] + "," + cc[1] + "," + cc[2] + "," + a + ")");
        cg.addColorStop(1, "rgba(0,0,0,0)");
        sctx.fillStyle = cg;
        sctx.fillRect(0, y0 - hh, W, hh * 2);
      });
    })();

    // VIA LATTEA: fascia diagonale sfumata con stelle dense e tenui
    sctx.save();
    sctx.translate(W / 2, H / 2);
    sctx.rotate(-24 * Math.PI / 180);
    sctx.globalAlpha = 1 - 0.9 * PH.day;   // di giorno quasi sparisce
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
      sctx.globalAlpha = rand(.15, .45) * (1 - 0.9 * PH.day);
      sctx.fillStyle = rgb(mix3(TINTS[(Math.random() * TINTS.length) | 0], [255, 196, 130], PH.dusk * 0.45));
      sctx.fillRect(x, y, rand(.5, 1), rand(.5, 1));
    }
    sctx.globalAlpha = 1;
    sctx.restore();

    // Stelle statiche (3 piani). Di giorno restano accennate, mai sparite del tutto.
    // Ad alba/tramonto prendono una tinta ambrata.
    STARS.forEach(function (s) {
      const sc = mix3(s.c, [255, 196, 130], PH.dusk * 0.45);
      if (s.halo) {
        sctx.globalAlpha = 1 - 0.85 * PH.day;
        const g = sctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5);
        g.addColorStop(0, "rgba(" + sc[0] + "," + sc[1] + "," + sc[2] + ",.28)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        sctx.fillStyle = g;
        sctx.beginPath();
        sctx.arc(s.x, s.y, s.r * 5, 0, 7);
        sctx.fill();
      }
      sctx.globalAlpha = s.a * (1 - 0.85 * PH.day);
      sctx.fillStyle = rgb(sc);
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
      lctx.globalAlpha = Math.max(.02, Math.min(1, tw)) * (1 - 0.8 * PH.day);
      lctx.fillStyle = rgb(mix3(s.c, [255, 196, 130], PH.dusk * 0.45));
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
      const tail = mix3([180, 170, 255], [255, 170, 110], PH.dusk);
      g.addColorStop(1, "rgba(" + tail[0] + "," + tail[1] + "," + tail[2] + ",0)");
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
      if (PH.day < 0.5 && SHOOTERS.length < 3) spawnShooter();   // di giorno niente cadenti
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
    PH = skyPhase();
    applySkyBg();
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
  // In più si alza body.scrolling: il CSS congela animazioni infinite,
  // nasconde la tela live e toglie il blur della barra (lo scroll sul
  // telefono resta fluido, tutto riparte da solo a dito fermo).
  let scrollT = 0;
  function busyScroll() {
    stop();
    document.body.classList.add("scrolling");
    clearTimeout(scrollT);
    scrollT = setTimeout(function () {
      document.body.classList.remove("scrolling");
      if (!document.hidden) start();
    }, 220);
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

  // Se l'app resta aperta per ore e si attraversa alba/tramonto,
  // si ricalcola la fase (ridisegno statico, niente reshuffle).
  setInterval(function () {
    const p = skyPhase();
    if (Math.abs(p.day - PH.day) > 0.02 || Math.abs(p.dusk - PH.dusk) > 0.02) {
      PH = p;
      applySkyBg();
      drawStatic();
    }
  }, 10 * 60 * 1000);

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
  vizBuild();     // barre del visualizzatore (nascoste finché non serve)
  applyQueueVisibility();   // pulsante coda visibile salvo disattivazione
  renderSkeletons();
  loadPlaylist();
} catch (err) {
  fatalError(err);
}