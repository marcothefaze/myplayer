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

const APP_VERSION = "16";   // cambia l'URL di playlist.json: niente cache stantia
const PLAYLIST_URL = "playlist.json?v=" + APP_VERSION;
const BASE_PATH = "../";          // index.html sta in /src, i file in /
const $ = (id) => document.getElementById(id);

/* localStorage "difeso": in Safari privato o su certi telefoni non è
   accessibile; qui non deve MAI far crashare l'app */
const storage = {
  get(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } },
  set(key, value) { try { window.localStorage.setItem(key, String(value)); } catch (e) {} }
};

/* Su telefono: blocca lo zoom con due dita e il doppio tap (iOS/Android) */
if ("gesturestart" in window) {
  document.addEventListener("gesturestart", (e) => e.preventDefault());
}
document.addEventListener("touchmove", (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

/* ---------- 2. ELEMENTI DEL DOM ---------- */

const audio = $("audio");

const els = {
  home: $("view-home"),
  albumView: $("view-album"),
  albumGrid: $("album-grid"),
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
  fpVolume: $("fp-volume"),
  fpVolumeIcon: $("fp-volume-icon"),
  fpShare: $("fp-share"),
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
  shuffle: storage.get("ssg-shuffle") === "1",
  repeat: storage.get("ssg-repeat") || "off"    // off | all | one
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
    img.onload = () => {
      // Copertine non quadrate (es. LUCCIOLE 770x470): il riquadro si adatta
      // al formato reale dell'immagine così la copertina lo riempie per intero
      if (container === els.fpCover && img.naturalWidth && img.naturalHeight) {
        container.style.setProperty("--fp-ar", String(img.naturalWidth / img.naturalHeight));
      }
    };
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
    const response = await fetch(PLAYLIST_URL);
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
      '<div class="error">Impossibile caricare playlist.json.<br>' +
      "Avvia il server locale (<code>python3 -m http.server</code> nella " +
      "cartella del progetto) e ricarica la pagina.</div>";
    console.error("Errore nel caricamento della playlist:", err);
  }
}

/* Deep link da link condiviso: ?track=<percorso file> -> avvia quel brano */
function handleDeepLink() {
  const track = new URLSearchParams(location.search).get("track");
  if (!track) return;
  const i = state.songs.findIndex((s) => s.file === track);
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
  const base = String(file || "").split("/").pop().replace(/\.[^.]+$/, "");
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

/* Ordine di visualizzazione degli album richiesto */
const ALBUM_ORDER = [
  "Non è SSG",
  "Testamento - ssg",
  "Giorni Migliori - SSG",
  "SINGOLI : EXTRA - SSG",
  "SOLO AVANZI - SSG",
  "COCONUT ICE CREAM - SSG",
  "LUCCIOLE - SSG",
  "D.A.M.S. - SSG"
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
    els.fpVolume.value = savedVolume;
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
    state.songs.length + " brani · " + state.albums.length + " album";
}

/* ---------- 6. HOME: griglia album ---------- */

function renderHome() {
  els.albumGrid.innerHTML = "";

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

  const home = els.home;
  const cs = getComputedStyle(home);
  const avail = home.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
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
  els.albumTitle.textContent = album.title;
  els.albumMeta.textContent =
    album.songs.length + " brani · " + formatMinutes(album.totalSec) +
    (isRealArtist(album.artist) ? " · " + album.artist : "");
  currentAlbum = album;

  buildCover(els.albumCoverWrap, album.cover, album.title);

  // Sfondo sfocato dell'intestazione: usa la stessa copertina
  if (album.cover) {
    els.heroBg.style.backgroundImage = 'url("' + resolvePath(album.cover) + '")';
  } else {
    els.heroBg.style.backgroundImage = "";
  }

  // Lista brani dell'album
  els.trackList.innerHTML = "";
  album.songs.forEach((songIdx, pos) => {
    const song = state.songs[songIdx];

    const row = document.createElement("button");
    row.className = "track-row";
    row.dataset.idx = songIdx;

    const num = document.createElement("span");
    num.className = "track-num";
    num.textContent = pos + 1;

    const title = document.createElement("span");
    title.className = "track-title";
    title.textContent = song.titolo || fileTitle(song.file);

    const artist = document.createElement("span");
    artist.className = "track-artist";
    artist.textContent = isRealArtist(song.artista) ? song.artista : "";

    const dur = document.createElement("span");
    dur.className = "track-dur";
    dur.textContent = formatTime(song.durata);

    row.appendChild(num);
    row.appendChild(title);
    row.appendChild(artist);
    row.appendChild(dur);
    row.addEventListener("click", () => playSong(songIdx, true));

    els.trackList.appendChild(row);
  });

  els.btnBack.classList.remove("hidden");
  showView("album");
  highlightActive();
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
   richiesto (solo il suo retry può partire), audioPauseSeen distingue una
   pausa VOLUTA dall'utente (evento "pause") da una play rifiutata da iOS
   (nessun evento: il brano non è mai partito). */
let playToken = 0;
let audioPauseSeen = false;
let audioErrorRetried = false;

async function playSong(songIdx, openFull) {
  if (songIdx < 0) return;
  const pos = state.queue.indexOf(songIdx);
  state.queuePos = pos >= 0 ? pos : 0;
  if (pos < 0) state.queue[0] = songIdx;

  const song = state.songs[songIdx];
  document.body.classList.add("has-track");   // fa comparire il miniplayer
  audio.src = resolvePath(song.file);
  /* NIENTE await: il vecchio codice aspettava che audio.play() si risolvesse
     (cioè finché il brano bufferizzava e partiva DAVVERO) prima di aggiornare
     titolo/copertina e aprire il full player: cliccando una canzone la UI
     restava congelata e sembrava lenta. Ora la UI si aggiorna all'istante
     mentre l'audio bufferizza in background. */
  const myToken = ++playToken;      // anti-corsa: solo l'ULTIMO skip comanda
  audioErrorRetried = false;        // nuovo brano: di nuovo un tentativo su errore
  audio.play().catch((err) => console.warn("Riproduzione bloccata dal browser:", err));
  /* Skip rapidissimi: iOS può rifiutare il play mentre il cambio traccia è
     ancora in corsa -> player congelato. Si riprova una volta dopo 400ms ma
     SOLO se: è ancora l'ultimo skip, il brano non è mai partito e l'utente
     non ha messo in pausa (la pausa voluta emette l'evento "pause",
     una play rifiutata no: così non si combatte mai con l'utente). */
  setTimeout(() => {
    if (myToken !== playToken || !audio.paused || audioPauseSeen) return;
    audio.play().catch(() => {});
  }, 400);
  updatePlayerInfo(song);
  highlightActive();
  if (openFull) openFullPlayer();   // selezione esplicita -> full player automatico
}

function updatePlayerInfo(song) {
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
  updateMediaSession(song);
}

function togglePlay() {
  if (currentIndex() < 0) {
    playSong(state.queue[0], true);
    return;
  }
  if (audio.paused) {
    audio.play().catch(() => {});
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
  storage.set("ssg-shuffle", state.shuffle ? "1" : "0");
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
  storage.set("ssg-repeat", state.repeat);
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
  if (els.fpVolume) els.fpVolume.value = v;
  storage.set("mp-volume", v);
  if (v > 0) lastVolume = v;
}

els.volume.addEventListener("input", () => setVolume(els.volume.value));
if (els.fpVolume) els.fpVolume.addEventListener("input", () => setVolume(els.fpVolume.value));

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
if (els.fpVolumeIcon) els.fpVolumeIcon.addEventListener("click", toggleMute);

/* ---------- 12. EVENTI <audio> ---------- */

audio.addEventListener("play", () => {
  setPlayIcons(true);
  document.body.classList.add("is-playing");
  audioPauseSeen = false;
  syncPlaybackState();
});
audio.addEventListener("pause", () => {
  setPlayIcons(false);
  document.body.classList.remove("is-playing");
  audioPauseSeen = true;    // pausa voluta: i retry del play non devono riprendere
  syncPlaybackState();
});

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
  syncFpVideoToAudio();   // il video riprende/se parte insieme alla canzone
}

function closeFullPlayer() {
  if (!els.fp) return;
  els.fp.classList.remove("open");
  els.fp.setAttribute("aria-hidden", "true");
  if (fpVideoEl) fpVideoEl.pause();
}

/* ---------- VIDEOCLIP nel full player ----------
   I brani con un video ufficiale (mappa TRACK_VIDEOS) mostrano nel full
   player il videoclip AL POSTO della copertina, stesse dimensioni del
   riquadro. L'audio resta quello della canzone: il video è muto e
   sincronizzato con play/pausa/seek. Un pulsante "Video" nella barra
   alta permette di tornare alla copertina e viceversa. */
const TRACK_VIDEOS = {
  "Goleador": "assets/video/goleador.mp4"
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
    // Video mancante/non leggibile: torna la copertina e sparisce il pulsante
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

  // Rilevamento stallo: il video non avanza (~1.2s di check di fila)
  if (fpLastVideoTime >= 0 && Math.abs(fpVideoEl.currentTime - fpLastVideoTime) < 0.04) {
    fpStallChecks++;
    if (fpStallChecks >= 5) {
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
    // Scarto piccolo: micro-accelerazione/rallentamento senza seek
    try { fpVideoEl.playbackRate = drift > 0 ? 1.08 : 0.92; } catch (e) {}
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

/* Cuore del fix: deriva, stalli e ripresa del video controllati dal
   timeupdate dell'audio in OGNI situazione (non solo in fullscreen) */
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
    if (els.fp && els.fp.classList.contains("open")) closeFullPlayer();
    else goHome();
  }
});

/* ---------- 14. AVVIO ---------- */

/* Qualunque errore JavaScript viene mostrato a schermo, così da poterlo
   leggere anche dal telefono invece di un generico "Caricamento..." */
function fatalError(message) {
  const grid = els.albumGrid;
  if (grid) {
    grid.innerHTML = '<div class="error"><b>Errore nella pagina:</b><br>' +
      "<code>" + String(message).replace(/</g, "&lt;") + "</code><br>" +
      "Ricarica la pagina, se possibile in una scheda privata.</div>";
  }
  if (els.brandCount) els.brandCount.textContent = "Errore di caricamento";
  console.error("SSG Universe:", message);
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
  loadPlaylist();
} catch (err) {
  fatalError(err);
}