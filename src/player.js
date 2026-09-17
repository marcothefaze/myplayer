"use strict";

/* =========================================================
   MyPlayer - logica del player musicale
   Ragionamento generale (leggi in ordine):
     1) CARICAMENTO: fetch di playlist.json
     2) DISEGNO:     costruisce dinamicamente la lista canzoni nel DOM
     3) RIPRODUZIONE: play / pausa / avanti / indietro + avanzamento auto
     4) AGGIORNAMENTO: barra di avanzamento, seek cliccabile, volume
   ========================================================= */


/* ---------- 1. CONFIGURAZIONE ---------- */

// Percorso di playlist.json, RELATIVO alla pagina (index.html è in /src)
const PLAYLIST_URL = "playlist.json";

// I percorsi dentro playlist.json sono relativi alla radice del progetto
// (es. "assets/audio/brano.mp3"). Siccome index.html sta in /src, per
// raggiungerli serve risalire di una cartella -> prefisso "../"
const BASE_PATH = "../";


/* ---------- 2. RIFERIMENTI AGLI ELEMENTI DEL DOM ---------- */
/* Raccogliamo qui tutti gli elementi della pagina che ci servono, così
   il resto del codice è più leggibile. */

const audio = document.getElementById("audio");

const playlistEl  = document.getElementById("playlist");
const songCountEl = document.getElementById("song-count");

const btnPlay = document.getElementById("btn-play");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");

const iconPlay  = document.getElementById("icon-play");
const iconPause = document.getElementById("icon-pause");

const coverEl       = document.getElementById("cover");
const songTitleEl   = document.getElementById("song-title");
const songArtistEl  = document.getElementById("song-artist");

const seekEl         = document.getElementById("seek");
const seekFillEl     = document.getElementById("seek-fill");
const timeCurrentEl  = document.getElementById("time-current");
const timeDurationEl = document.getElementById("time-duration");

const volumeEl = document.getElementById("volume");


/* ---------- 3. STATO DELL'APP ---------- */

let songs = [];          // array delle canzoni lette da playlist.json
let currentIndex = 0;    // indice della canzone attualmente selezionata
let isPlaying = false;   // comodità: "stiamo riproducendo?" (aggiornato dagli eventi)


/* ---------- 4. FUNZIONI DI SUPPORTO ---------- */

// Converte i secondi nel formato "m:ss" (es. 205 -> "3:25")
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return min + ":" + String(sec).padStart(2, "0");
}

// Rende "assoluto" un percorso relativo alla radice del progetto
function resolvePath(file) {
  if (!file) return "";
  // Già assoluto (URL completo, percorso "/..." o immagine in data:)
  if (file.startsWith("http") || file.startsWith("/") || file.startsWith("data:")) {
    return file;
  }
  return BASE_PATH + file;    // antepone "../"
}

// Se nel JSON manca il titolo, usa il nome del file senza estensione
function fileTitle(file) {
  const parts = String(file).split("/");
  const name = parts[parts.length - 1] || file;
  return name.replace(/\.[^.]+$/, "");
}


/* ---------- 5. CARICAMENTO DELLA PLAYLIST ---------- */

async function loadPlaylist() {
  try {
    const response = await fetch(PLAYLIST_URL);
    if (!response.ok) throw new Error("HTTP " + response.status);
    songs = await response.json();       // [{id, titolo, artista, album, durata, file, copertina}, ...]
    renderPlaylist();
  } catch (err) {
    // Caso tipico: pagina aperta direttamente da doppio click (protocollo file://)
    // -> il browser blocca il fetch dei file locali. Serve un server locale.
    playlistEl.innerHTML =
      '<li class="error">Impossibile caricare playlist.json.<br>' +
      "Avvia un server locale (<code>python3 -m http.server</code> nella cartella " +
      "del progetto) e apri la pagina da lì.</li>";
    console.error("Errore nel caricamento della playlist:", err);
  }
}


/* ---------- 6. DISEGNO DELLA LISTA ---------- */

function renderPlaylist() {
  playlistEl.innerHTML = "";             // svuoto la lista

  // Raggruppo le canzoni per album mantenendo l'ordine di apparizione.
  // La mappa ha come chiave il nome dell'album e come valore la lista
  // degli indici (dentro `songs`) delle canzoni che vi appartengono.
  const groups = new Map();
  songs.forEach((song, index) => {
    const album = song.album || "Senza album";
    if (!groups.has(album)) groups.set(album, []);
    groups.get(album).push(index);
  });

  // Aggiorno i contatori nella sidebar: canzoni totali e album
  songCountEl.textContent = songs.length + " canzoni · " + groups.size + " album";

  // Disegno ogni album: prima l'intestazione, poi le sue canzoni
  groups.forEach((indexes, albumName) => {
    const firstSong = songs[indexes[0]];

    // ---- Intestazione dell'album (riga NON cliccabile) ----
    const header = document.createElement("li");
    header.className = "song section";

    const headerThumb = document.createElement("div");
    headerThumb.className = "section-thumb";
    if (firstSong.copertina) {
      const img = document.createElement("img");
      img.src = resolvePath(firstSong.copertina);
      img.alt = albumName;
      img.onerror = () => { headerThumb.classList.add("placeholder"); img.remove(); };
      headerThumb.appendChild(img);
    } else {
      headerThumb.classList.add("placeholder");
    }

    const headerText = document.createElement("div");
    headerText.className = "song-text";

    const headerTitle = document.createElement("div");
    headerTitle.className = "section-title";
    headerTitle.textContent = albumName;

    const headerCount = document.createElement("div");
    headerCount.className = "section-count";
    headerCount.textContent = indexes.length + " canzoni";
    if (firstSong.artista) {
      headerCount.textContent += " · " + firstSong.artista;
    }

    headerText.appendChild(headerTitle);
    headerText.appendChild(headerCount);

    header.appendChild(headerThumb);
    header.appendChild(headerText);
    playlistEl.appendChild(header);

    // ---- Canzoni di questo album ----
    indexes.forEach((index, posInAlbum) => {
      const song = songs[index];

      const li = document.createElement("li");
      li.className = "song";
      li.dataset.index = index;          // salvo l'indice "reale" in songs[]

      // Numero progressivo DENTRO l'album (1, 2, 3, ...)
      const num = document.createElement("span");
      num.className = "song-index";
      num.textContent = posInAlbum + 1;

      // Mini-copertina (o gradiente placeholder se assente)
      const thumb = document.createElement("div");
      thumb.className = "thumb";
      if (song.copertina) {
        const img = document.createElement("img");
        img.src = resolvePath(song.copertina);
        img.alt = "Copertina";
        // Se l'immagine non esiste, sostituisci col placeholder
        img.onerror = () => { thumb.classList.add("placeholder"); img.remove(); };
        thumb.appendChild(img);
      } else {
        thumb.classList.add("placeholder");
      }

      // Blocco con titolo + artista
      const text = document.createElement("div");
      text.className = "song-text";

      const title = document.createElement("div");
      title.className = "song-title";
      title.textContent = song.titolo || fileTitle(song.file);

      const artist = document.createElement("div");
      artist.className = "song-artist";
      artist.textContent = song.artista || "Artista sconosciuto";

      text.appendChild(title);
      text.appendChild(artist);

      // Durata sulla destra
      const dur = document.createElement("span");
      dur.className = "song-duration";
      dur.textContent = formatTime(song.durata);

      // Compongo la riga: numero, copertina, testo, durata
      li.appendChild(num);
      li.appendChild(thumb);
      li.appendChild(text);
      li.appendChild(dur);

      // Click sulla riga -> riproduci quella canzone
      li.addEventListener("click", () => playIndex(index));

      playlistEl.appendChild(li);
    });
  });
}


/* ---------- 7. RIPRODUZIONE ---------- */

// Evidenzia la riga "attiva" nella lista (solo quella in riproduzione)
function updateActiveRow() {
  document.querySelectorAll(".playlist .song").forEach((li) => {
    li.classList.toggle("active", Number(li.dataset.index) === currentIndex);
  });
}

// Avvia la canzone con l'indice dato
async function playIndex(index) {
  if (index < 0 || index >= songs.length) return;

  currentIndex = index;
  const song = songs[currentIndex];

  // Imposta la sorgente audio e prova a partire
  audio.src = resolvePath(song.file);
  try {
    await audio.play();
  } catch (err) {
    // I browser possono bloccare la riproduzione automatica; qui partiamo
    // sempre da un click, ma l'errore va comunque gestito con calma.
    console.warn("Riproduzione bloccata dal browser:", err);
  }

  // Aggiorna la scheda del brano e la riga evidenziata
  loadTrackInfo(song);
  updateActiveRow();
}

// Compila la zona "info brano" del player
function loadTrackInfo(song) {
  songTitleEl.textContent  = song.titolo || fileTitle(song.file);
  songArtistEl.textContent = song.artista || "Artista sconosciuto";

  // Copertina grande: immagine o placeholder
  coverEl.innerHTML = "";
  coverEl.classList.remove("placeholder");
  if (song.copertina) {
    const img = document.createElement("img");
    img.src = resolvePath(song.copertina);
    img.alt = "Copertina";
    img.onerror = () => { coverEl.innerHTML = ""; coverEl.classList.add("placeholder"); };
    coverEl.appendChild(img);
  } else {
    coverEl.classList.add("placeholder");
  }

  // Mostra subito la durata dal JSON; verrà raffinata dal browser
  // quando carica i metadati del file (evento loadedmetadata).
  if (isFinite(song.durata)) {
    timeDurationEl.textContent = formatTime(song.durata);
  }
}

// Play / pausa (usato dal pulsante centrale)
function togglePlay() {
  // Nessuna canzone ancora scelta: parte dalla prima della lista
  if (audio.src === "") {
    playIndex(0);
    return;
  }
  if (audio.paused) {
    audio.play();
  } else {
    audio.pause();
  }
}

// Passa alla canzone successiva (con "giro" se si è all'ultima)
function nextSong() {
  playIndex((currentIndex + 1) % songs.length);
}

// Precedente: se il brano è appena iniziato torna all'inizio,
// altrimenti salta al brano precedente.
function prevSong() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
  } else {
    playIndex((currentIndex - 1 + songs.length) % songs.length);
  }
}


/* ---------- 8. AGGIORNAMENTO DELLA BARRA DI AVANZAMENTO ---------- */

// Viene chiamata continuamente dal tag <audio> mentre suona
function updateProgress() {
  const duration = audio.duration || 0;
  const current  = audio.currentTime || 0;

  // La larghezza del riempimento verde è la percentuale ascoltata
  seekFillEl.style.width = duration ? (current / duration * 100) + "%" : "0%";

  timeCurrentEl.textContent  = formatTime(current);
  if (isFinite(duration)) {
    timeDurationEl.textContent = formatTime(duration);
  }
}

// Clic sulla barra = seek (salta in quel punto del brano)
seekEl.addEventListener("click", (e) => {
  if (!isFinite(audio.duration)) return;     // durata non ancora nota

  // Posizione del click rapportata alla larghezza della barra
  const rect = seekEl.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const ratioClamped = Math.max(0, Math.min(1, ratio));

  audio.currentTime = ratioClamped * audio.duration;
  updateProgress();
});


/* ---------- 9. EVENTI DEL TAG <audio> ---------- */

// Avanzamento automatico: a fine brano passa al successivo
audio.addEventListener("ended", () => {
  if (currentIndex < songs.length - 1) {
    playIndex(currentIndex + 1);
  }
  // Se era l'ultima, ci si ferma (nessun loop)
});

// Sincronizza lo stato e l'icona del pulsante play
audio.addEventListener("play", () => {
  isPlaying = true;
  setPlayIcon(true);
});

audio.addEventListener("pause", () => {
  isPlaying = false;
  setPlayIcon(false);
});

// Mostra o nasconde l'icona play/pausa
function setPlayIcon(playing) {
  iconPlay.style.display  = playing ? "none" : "block";
  iconPause.style.display = playing ? "block" : "none";
}


/* ---------- 10. CONTROLLI UI ---------- */

// Pulsanti del player
btnPlay.addEventListener("click", togglePlay);
btnNext.addEventListener("click", nextSong);
btnPrev.addEventListener("click", prevSong);

// Volume: aggiorna l'audio e salva il valore, così resta al prossimo avvio
volumeEl.addEventListener("input", () => {
  audio.volume = Number(volumeEl.value);
  localStorage.setItem("mp-volume", volumeEl.value);
});

// Ripristino del volume salvato in un precedente avvio
const savedVolume = localStorage.getItem("mp-volume");
if (savedVolume !== null) {
  volumeEl.value = savedVolume;
  audio.volume = Number(savedVolume);
}

// Bonus: barra spaziatrice per play/pausa (ignorata quando digiti in un input)
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target.tagName !== "INPUT") {
    e.preventDefault();
    togglePlay();
  }
});


/* ---------- 11. AVVIO ---------- */

// Lo script è in fondo al body, quindi il DOM è già pronto: partiamo subito
loadPlaylist();