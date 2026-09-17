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

const PLAYLIST_URL = "playlist.json";
const BASE_PATH = "../";          // index.html sta in /src, i file in /
const $ = (id) => document.getElementById(id);

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
  main: $("main")
};

/* ---------- 3. STATO ---------- */

const state = {
  songs: [],        // brani letti da playlist.json (già ordinati per album/titolo)
  albums: [],       // [{ title, artist, cover, totalSec, songs:[indici] }]
  queue: [],        // ordine di riproduzione corrente (indici in songs[])
  queuePos: -1,     // posizione corrente dentro queue
  shuffle: localStorage.getItem("ssg-shuffle") === "1",
  repeat: localStorage.getItem("ssg-repeat") || "off"    // off | all | one
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
  if (src) {
    const img = document.createElement("img");
    img.src = resolvePath(src);
    img.alt = "";
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
  } catch (err) {
    els.albumGrid.innerHTML =
      '<div class="error">Impossibile caricare playlist.json.<br>' +
      "Avvia il server locale (<code>python3 -m http.server</code> nella " +
      "cartella del progetto) e ricarica la pagina.</div>";
    console.error("Errore nel caricamento della playlist:", err);
  }
}

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

  state.flat = [];
  state.albums.forEach((album) => album.songs.forEach((i) => state.flat.push(i)));
}

/* Ripristina shuffle/repeat salvati e volume */
function applySavedState() {
  els.btnShuffle.classList.toggle("on", state.shuffle);
  els.btnRepeat.classList.toggle("on", state.repeat !== "off");
  els.btnRepeat.classList.toggle("one", state.repeat === "one");
  els.repBadge.classList.toggle("hidden", state.repeat !== "one");

  const savedVolume = localStorage.getItem("mp-volume");
  if (savedVolume !== null) {
    els.volume.value = savedVolume;
    audio.volume = Number(savedVolume);
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
}

/* ---------- 7. SCHERMATA ALBUM ---------- */

function openAlbum(album) {
  els.albumTitle.textContent = album.title;
  els.albumMeta.textContent =
    album.songs.length + " brani · " + formatMinutes(album.totalSec) +
    (isRealArtist(album.artist) ? " · " + album.artist : "");

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
    row.addEventListener("click", () => playSong(songIdx));

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
  els.main.scrollTop = 0;
}

/* ---------- 9. RIPRODUZIONE ---------- */

function currentIndex() {
  return state.queuePos >= 0 ? state.queue[state.queuePos] : -1;
}

async function playSong(songIdx) {
  if (songIdx < 0) return;
  const pos = state.queue.indexOf(songIdx);
  state.queuePos = pos >= 0 ? pos : 0;
  if (pos < 0) state.queue[0] = songIdx;

  const song = state.songs[songIdx];
  audio.src = resolvePath(song.file);
  try {
    await audio.play();
  } catch (err) {
    console.warn("Riproduzione bloccata dal browser:", err);
  }
  updatePlayerInfo(song);
  highlightActive();
}

function updatePlayerInfo(song) {
  els.songTitle.textContent = song.titolo || fileTitle(song.file);
  els.songArtist.textContent = isRealArtist(song.artista)
    ? song.artista
    : (song.album || "Senza album");

  buildCover(els.cover, song.copertina, song.album);

  if (isFinite(song.durata)) {
    els.timeDuration.textContent = formatTime(song.durata);
  }
}

function togglePlay() {
  if (currentIndex() < 0) {
    playSong(state.queue[0]);
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
  localStorage.setItem("ssg-shuffle", state.shuffle ? "1" : "0");
  els.btnShuffle.classList.toggle("on", state.shuffle);

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
  localStorage.setItem("ssg-repeat", state.repeat);

  els.btnRepeat.classList.toggle("on", state.repeat !== "off");
  els.btnRepeat.classList.toggle("one", state.repeat === "one");
  els.repBadge.classList.toggle("hidden", state.repeat !== "one");
}

/* ---------- 11. AVANZAMENTO, SEEK, VOLUME ---------- */

function updateProgress() {
  const duration = audio.duration || 0;
  const current = audio.currentTime || 0;
  els.seekFill.style.width = duration ? (current / duration * 100) + "%" : "0%";
  els.timeCurrent.textContent = formatTime(current);
  if (isFinite(duration)) {
    els.timeDuration.textContent = formatTime(duration);
  }
}

els.seek.addEventListener("click", (e) => {
  if (!isFinite(audio.duration)) return;
  const rect = els.seek.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration;
  updateProgress();
});

let lastVolume = null;

function setVolume(value) {
  const v = Math.max(0, Math.min(1, Number(value)));
  audio.volume = v;
  els.volume.value = v;
  localStorage.setItem("mp-volume", v);
  if (v > 0) lastVolume = v;
}

els.volume.addEventListener("input", () => setVolume(els.volume.value));

// Click sull'icona: silenzia / ripristina il volume
els.volumeIcon.addEventListener("click", () => {
  if (audio.volume > 0) {
    lastVolume = audio.volume;
    setVolume(0);
  } else {
    setVolume(lastVolume !== null ? lastVolume : 0.8);
  }
});

/* ---------- 12. EVENTI <audio> ---------- */

audio.addEventListener("play", () => {
  els.iconPlay.style.display = "none";
  els.iconPause.style.display = "block";
});

audio.addEventListener("pause", () => {
  els.iconPlay.style.display = "block";
  els.iconPause.style.display = "none";
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

/* ---------- 13. CONTROLLI UI E TASTIERA ---------- */

els.btnPlay.addEventListener("click", togglePlay);
els.btnNext.addEventListener("click", skipNext);
els.btnPrev.addEventListener("click", skipPrev);
els.btnShuffle.addEventListener("click", toggleShuffle);
els.btnRepeat.addEventListener("click", cycleRepeat);
els.btnBack.addEventListener("click", goHome);

function goHome() {
  els.btnBack.classList.add("hidden");
  showView("home");
}

// Spazio = play/pausa (se un pulsante ha il focus, lo tolgo per non doppio-click)
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
    goHome();
  }
});

/* ---------- 14. AVVIO ---------- */

loadPlaylist();